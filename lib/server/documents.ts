import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {uid,validateNoteBody,bindLinks,type Note} from '../study';
import {MAX_ASSETS,MAX_ASSET_BYTES,MAX_ASSET_TOTAL,type DocumentBase,type DocumentAsset,type ConversionInfo} from '../documents';
import {getBucket,getDatabase,HttpError,readNote,readWorkspace,saveWorkspace,readSnapshot,digest} from './workspace-store';
import type {StoredImportJob} from './import-jobs';

const uuid=z.string().uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/);
const geometry=z.object({mediaBox:z.array(z.number().finite()).length(4),cropBox:z.array(z.number().finite()).length(4),rotation:z.number().int(),userUnit:z.number().positive()});
const assetSchema=z.object({id:uuid,mediaType:z.enum(['image/png','image/jpeg']),size:z.number().int().positive().max(MAX_ASSET_BYTES),sha256:sha,width:z.number().int().positive().max(20000),height:z.number().int().positive().max(20000),page:z.number().int().min(1).max(100).optional(),bbox:z.array(z.number().finite()).length(4).optional(),alt:z.string().max(1000).optional()});
const resultSchema=z.object({markdown:z.string(),ocr:z.boolean(),preview:z.literal(true),base:z.object({sha256:sha,size:z.number().int().positive().max(40*1024*1024),kind:z.enum(['pdf','searchable-pdf','office-pdf','text-pdf']),pages:z.array(geometry).min(1).max(100)}),assets:z.array(assetSchema).max(MAX_ASSETS),conversion:z.object({engine:z.string().max(100),warnings:z.array(z.string().max(2000)).max(200)}),metrics:z.object({seconds:z.number(),peakMemoryBytes:z.number()}).optional()});
export type RichResult=z.infer<typeof resultSchema>;
export type BaseRow={id:string;workspace:string;note:string;job:string;object_key:string;data:string;published:number};

export async function documentJobId(parts:unknown[]){const hash=await digest(JSON.stringify(parts));return`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;}
export async function ownedSource(workspace:string,note:string){const row=await getDatabase().prepare('SELECT s.* FROM note_sources s JOIN notes n ON n.workspace=s.workspace AND n.id=s.note WHERE s.workspace=? AND s.note=?').bind(workspace,note).first<any>();if(!row)throw new HttpError(404,'Source document unavailable.');return row;}
export async function readBase(workspace:string,note:string){return getDatabase().prepare('SELECT b.* FROM document_bases b JOIN notes n ON n.workspace=b.workspace AND n.id=b.note WHERE b.workspace=? AND b.note=? AND b.published=1').bind(workspace,note).first<BaseRow>();}
export function baseDTO(row:BaseRow):DocumentBase{return{...JSON.parse(row.data),id:row.id};}
export async function readAssets(workspace:string,note:string){const rows=await getDatabase().prepare('SELECT data FROM document_assets WHERE workspace=? AND note=? AND published=1').bind(workspace,note).all<{data:string}>();return rows.results.map(r=>JSON.parse(r.data) as DocumentAsset);}

async function active(job:StoredImportJob){const row=await getDatabase().prepare("SELECT id FROM import_jobs WHERE id=? AND status='processing' AND lease_token=?").bind(job.id,job.token).first();if(!row)throw new HttpError(409,'This operation was cancelled or superseded.');}
export async function trackFile(job:StoredImportJob,note:string,key:string,kind:string,expires=0){await active(job);await getDatabase().prepare('INSERT OR IGNORE INTO document_files(object_key,workspace,note,job,kind,expires) VALUES(?,?,?,?,?,?)').bind(key,job.workspace,note,job.id,kind,expires).run();}
export async function verifyDocumentFile(job:StoredImportJob,key:string){try{await active(job);}catch(e){await getBucket().delete(key);throw e;}}
export async function cleanupStaged(jobId:string,keepInputs=false){const db=getDatabase();const filter=keepInputs?" AND kind!='export-snapshot'":'';const rows=await db.prepare('SELECT object_key FROM document_files WHERE job=? AND published=0'+filter).bind(jobId).all<{object_key:string}>();for(let i=0;i<rows.results.length;i+=100)await getBucket().delete(rows.results.slice(i,i+100).map(r=>r.object_key));await db.batch([db.prepare('DELETE FROM document_assets WHERE job=? AND published=0').bind(jobId),db.prepare('DELETE FROM document_bases WHERE job=? AND published=0').bind(jobId),db.prepare('DELETE FROM document_files WHERE job=? AND published=0'+filter).bind(jobId)]);}

type Part={name:string;filename:string;type:string;body:ReadableStream<Uint8Array>};
function multipart(parts:Part[]){
 const boundary='studysprint-'+uid(),encoder=new TextEncoder();
 async function* chunks(){for(const part of parts){yield encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename.replace(/["\\\r\n]/g,'_')}"\r\nContent-Type: ${part.type}\r\n\r\n`);const reader=part.body.getReader();let done=false;try{for(;;){const next=await reader.read();if(next.done){done=true;break;}yield next.value;}}finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();}yield encoder.encode('\r\n');}yield encoder.encode(`--${boundary}--\r\n`);}
 const iterator=chunks();return{body:new ReadableStream<Uint8Array>({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(e){controller.error(e);}},async cancel(){await iterator.return(undefined);}}),type:`multipart/form-data; boundary=${boundary}`};
}
export async function callConverter(job:StoredImportJob,mode:'convert'|'prepare'|'export',sourceKey=job.originalKey,baseKey?:string,annotationKey?:string){
 if(!env.CONVERTER_URL||!env.CONVERTER_SECRET)throw new HttpError(503,'The private document service is not configured.');
 const source=await getBucket().get(sourceKey);if(!source)throw new HttpError(410,'The source document is unavailable.');
 const extension=mode==='export'?'pdf':job.name.split('.').pop()!.toLowerCase();const parts:Part[]=[{name:'file',filename:'source.'+extension,type:mode==='export'?'application/pdf':job.mediaType,body:source.body}];
 for(const [name,key] of [['base',baseKey],['annotations',annotationKey]] as const){if(!key)continue;const object=await getBucket().get(key);if(!object)throw new HttpError(410,'The staged document part is unavailable.');parts.push({name,filename:name==='base'?'base.pdf':'annotations.json',type:name==='base'?'application/pdf':'application/json',body:object.body});}
 const form=multipart(parts);let response:Response;
 try{response=await fetch(`${env.CONVERTER_URL.replace(/\/$/,'')}/${mode}/${job.id}`,{method:'POST',headers:{Authorization:`Bearer ${env.CONVERTER_SECRET}`,'Content-Type':form.type},body:form.body,signal:AbortSignal.timeout(610000)});}catch{throw new HttpError(503,'The document service is unavailable or timed out. Retry this operation.');}
 if(!response.ok){let message='The document could not be processed. Retry with a fresh copy.';try{const data:any=await response.json();if(typeof data.detail==='string')message=data.detail;}catch{}throw new HttpError(response.status===503?503:400,message);}
 const text=await response.text();if(new TextEncoder().encode(text).length>2*1024*1024)throw new HttpError(502,'The document service returned an oversized result.');return JSON.parse(text);
}
export async function converterArtifact(job:StoredImportJob,path:string){const response=await fetch(`${env.CONVERTER_URL!.replace(/\/$/,'')}/artifacts/${job.id}/${path}`,{headers:{Authorization:`Bearer ${env.CONVERTER_SECRET}`},signal:AbortSignal.timeout(60000)});if(!response.ok||!response.body)throw new HttpError(502,'A required document artifact could not be saved. Retry this operation.');return response;}

export async function stageRichResult(job:StoredImportJob,note:string,value:unknown){
 const result=resultSchema.parse(value);if(result.assets.reduce((sum,a)=>sum+a.size,0)>MAX_ASSET_TOTAL)throw new HttpError(413,'The extracted images exceed 40 MiB.');
 const ids=new Set(result.assets.map(a=>a.id));if(ids.size!==result.assets.length)throw new HttpError(502,'The converter returned duplicate image identifiers.');
 for(const match of result.markdown.matchAll(/asset:([a-f0-9-]{36})/gi))if(!ids.has(match[1]))throw new HttpError(502,'The converted note references a missing image.');
 const db=getDatabase(),bucket=getBucket();let base=await readBase(job.workspace,note);
 if(!base){
  const id=uid(),key=`documents/${job.workspace}/${note}/${id}/base.pdf`;await trackFile(job,note,key,'base');
  const response=await converterArtifact(job,'preview');if(Number(response.headers.get('content-length'))!==result.base.size)throw new HttpError(502,'The annotation base is incomplete.');
  await bucket.put(key,response.body!,{httpMetadata:{contentType:'application/pdf'}});await verifyDocumentFile(job,key);
  await db.prepare('INSERT INTO document_bases(id,workspace,note,job,object_key,data) VALUES(?,?,?,?,?,?)').bind(id,job.workspace,note,job.id,key,JSON.stringify(result.base)).run();
  base={id,workspace:job.workspace,note,job:job.id,object_key:key,data:JSON.stringify(result.base),published:0};
 }
 for(const asset of result.assets){
  const key=`documents/${job.workspace}/${note}/assets/${asset.id}.png`;await trackFile(job,note,key,'asset');const response=await converterArtifact(job,'files/'+asset.id);
  if(Number(response.headers.get('content-length'))!==asset.size)throw new HttpError(502,'An extracted image is incomplete.');
  const bytes=await response.arrayBuffer();const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==asset.size||checksum!==asset.sha256)throw new HttpError(502,'An extracted image failed its integrity check.');
  await bucket.put(key,bytes,{httpMetadata:{contentType:asset.mediaType}});await verifyDocumentFile(job,key);await db.prepare('INSERT INTO document_assets(id,workspace,note,job,object_key,data) VALUES(?,?,?,?,?,?)').bind(asset.id,job.workspace,note,job.id,key,JSON.stringify(asset)).run();
 }
 return{result,base};
}

export function publicationStatements(workspace:string,note:string,job:string,condition:string,args:unknown[]):D1PreparedStatement[]{
 const db=getDatabase();return[
  db.prepare(`UPDATE document_assets SET published=1 WHERE workspace=? AND note=? AND job=? AND ${condition}`).bind(workspace,note,job,...args),
  db.prepare(`UPDATE document_bases SET published=1 WHERE workspace=? AND note=? AND job=? AND ${condition}`).bind(workspace,note,job,...args),
  db.prepare(`UPDATE document_files SET published=1 WHERE workspace=? AND note=? AND job=? AND kind IN ('asset','base') AND ${condition}`).bind(workspace,note,job,...args),
  db.prepare(`INSERT OR IGNORE INTO annotation_sets(base,workspace,note) SELECT id,workspace,note FROM document_bases WHERE workspace=? AND note=? AND published=1 AND ${condition}`).bind(workspace,note,...args),
 ];
}

export async function prepareDocument(job:StoredImportJob){
 const note=String(job.payload.noteId);const source=await ownedSource(job.workspace,note),existing=await readBase(job.workspace,note);if(existing)return;
 await cleanupStaged(job.id);const value=await callConverter(job,'prepare',source.original_key,source.preview_key||undefined);
 const {base}=await stageRichResult(job,note,value);const db=getDatabase(),condition="EXISTS(SELECT 1 FROM import_jobs WHERE id=? AND status='processing' AND lease_token=?) AND EXISTS(SELECT 1 FROM notes WHERE workspace=? AND id=?)";const args=[job.id,job.token,job.workspace,note];
 if(source.preview_key&&source.preview_key!==base.object_key)await db.prepare("INSERT OR IGNORE INTO document_files(object_key,workspace,note,job,kind,published) VALUES(?,?,?,?,'legacy-preview',1)").bind(source.preview_key,job.workspace,note,job.id).run();
 await db.batch([...publicationStatements(job.workspace,note,job.id,condition,args),db.prepare(`UPDATE note_sources SET preview_key=?,preview_type='pdf' WHERE workspace=? AND note=? AND ${condition}`).bind(base.object_key,job.workspace,note,...args)]);
}

export async function reconvertDocument(job:StoredImportJob){
 const note=String(job.payload.noteId),source=await ownedSource(job.workspace,note);if(!await readBase(job.workspace,note))await prepareDocument(job);const base=await readBase(job.workspace,note);await cleanupStaged(job.id);
 const value=await callConverter(job,'convert',source.original_key,base?.object_key||source.preview_key||undefined);const {result}=await stageRichResult(job,note,value);validateNoteBody(result.markdown);
 const key=`documents/${job.workspace}/${note}/results/${job.id}.md`;await trackFile(job,note,key,'result');await getBucket().put(key,result.markdown,{httpMetadata:{contentType:'text/markdown'}});await verifyDocumentFile(job,key);
 await active(job);await getDatabase().prepare('INSERT OR REPLACE INTO reconversions(job,workspace,note,expected_updated,body_key,conversion) VALUES(?,?,?,?,?,?)').bind(job.id,job.workspace,note,String(job.payload.expectedUpdated),key,JSON.stringify(result.conversion)).run();
}

export async function reviewReconversion(workspace:string,note:string,jobId:string){
 const row=await getDatabase().prepare("SELECT r.* FROM reconversions r JOIN import_jobs j ON j.id=r.job WHERE r.workspace=? AND r.note=? AND r.job=? AND j.status='ready'").bind(workspace,note,jobId).first<any>();if(!row)throw new HttpError(404,'The improved conversion is not ready.');
 const current=await readNote(workspace,note);if(row.applied_version)return{appliedVersion:row.applied_version,note:current};const object=await getBucket().get(row.body_key);if(!object)throw new HttpError(410,'The conversion preview has expired. Run Improve conversion again.');
 return{body:await object.text(),conversion:JSON.parse(row.conversion) as ConversionInfo,current,jobId};
}
export async function applyReconversion(workspace:string,note:string,jobId:string,expectedUpdated:string){
 const review=await reviewReconversion(workspace,note,jobId);if(review.appliedVersion)return readSnapshot(workspace);
 if(!expectedUpdated||review.current!.updated!==expectedUpdated)throw new HttpError(409,'This note changed after your review. Review the current note before applying.');
 const {workspace:w,version}=await readWorkspace(workspace);const current=review.current!;if(!w.notes.some(n=>n.id===note))throw new HttpError(404,'Note unavailable.');
 const next:Note={...current,body:validateNoteBody(review.body!),conversion:review.conversion,version:current.version+1,updated:new Date().toISOString(),versions:[...(current.versions||[]),{version:current.version,body:current.body,at:current.updated}]};
 w.notes[w.notes.findIndex(n=>n.id===note)]=next;w.notes.forEach(n=>bindLinks(w,n));
 await saveWorkspace(workspace,w,version,{documentJob:{id:jobId,note},reconversion:{id:jobId,note,expectedUpdated,version:next.version}});
 await cleanupStaged(jobId);return readSnapshot(workspace);
}

export async function startDocumentJob(workspace:string,note:string,kind:'prepare'|'reconvert'){
 const source=await ownedSource(workspace,note),db=getDatabase();
 const existing=await db.prepare("SELECT id FROM import_jobs WHERE workspace=? AND note_id=? AND kind=? AND (status IN ('queued','processing') OR (status='ready' AND kind='reconvert' AND json_extract(payload,'$.appliedVersion') IS NULL)) ORDER BY created DESC LIMIT 1").bind(workspace,note,kind).first<{id:string}>();
 const jobs=await import('./import-jobs');if(existing)return jobs.getImportJob(existing.id,workspace);
 const current=await readNote(workspace,note);const id=await documentJobId([workspace,note,kind,source.id,kind==='reconvert'?current.updated:'stable-base','docling-2.140.0/studysprint-1']);const job=await jobs.createImportJob(workspace,{id,kind,name:source.name,title:current.title,originalKey:source.original_key,mediaType:source.media_type,size:source.size,payload:{noteId:note,expectedUpdated:current.updated},noteId:note});
 try{await jobs.enqueueImportJob(job.id);}catch(e){await jobs.failImport(job.id,(e as Error).message);}return jobs.getImportJob(job.id,workspace);
}

export async function maintainDocumentFiles(){const db=getDatabase(),now=Date.now();const rows=await db.prepare('SELECT object_key FROM document_files WHERE expires>0 AND expires<? LIMIT 100').bind(now).all<{object_key:string}>();if(rows.results.length){await getBucket().delete(rows.results.map(r=>r.object_key));for(const row of rows.results)await db.prepare('DELETE FROM document_files WHERE object_key=?').bind(row.object_key).run();}await db.prepare('DELETE FROM annotation_operations WHERE created<?').bind(now-7*86400000).run();}
