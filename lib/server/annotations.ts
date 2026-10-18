import {z} from 'zod';
import {uid} from '../study';
import {validateAnnotation,MAX_ANNOTATIONS,MAX_ANNOTATION_TOTAL,type Annotation,type AnnotationSnapshot} from '../documents';
import {getBucket,getDatabase,HttpError,digest} from './workspace-store';
import {baseDTO,readBase,ownedSource,callConverter,converterArtifact,trackFile,verifyDocumentFile,documentJobId} from './documents';
import type {StoredImportJob} from './import-jobs';

export async function boundedJSON(req:Request,max=36*1024){if(!req.body)throw new HttpError(400,'Request is empty.');if(Number(req.headers.get('content-length'))>max)throw new HttpError(413,'Request exceeds its supported size.');const reader=req.body.getReader(),parts:Uint8Array[]=[];let size=0;try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>max){await reader.cancel();throw new HttpError(413,'Request exceeds its supported size.');}parts.push(next.value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
function annotationDTO(row:any):Annotation{return{id:row.id,version:row.version,data:JSON.parse(row.data),updated:row.updated};}
export async function annotationSnapshot(workspace:string,note:string):Promise<AnnotationSnapshot>{
 await ownedSource(workspace,note);const base=await readBase(workspace,note);if(!base)return{base:null,version:0,count:0,annotations:[]};
 const db=getDatabase(),[sets,rows]=await db.batch<any>([db.prepare('SELECT version,count FROM annotation_sets WHERE base=? AND workspace=?').bind(base.id,workspace),db.prepare('SELECT id,data,version,updated FROM annotations WHERE base=? AND workspace=? ORDER BY id').bind(base.id,workspace)]);
 return{base:baseDTO(base),version:sets.results[0]?.version||0,count:sets.results[0]?.count||0,annotations:rows.results.map(annotationDTO)};
}
const mutationSchema=z.object({baseId:z.string().uuid(),operationId:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),data:z.unknown().optional()}).strict();
export async function mutateAnnotation(workspace:string,note:string,annotationId:string,value:unknown,remove=false){
 z.string().uuid().parse(annotationId);const input=mutationSchema.parse(value),base=await readBase(workspace,note);if(!base||base.id!==input.baseId)throw new HttpError(409,'The annotation document changed. Reload its current preview.');
 const data=remove?null:validateAnnotation(input.data,baseDTO(base).pages),stored=data?JSON.stringify(data):'',bytes=new TextEncoder().encode(stored).length;
 const hash=await digest(JSON.stringify({annotationId,baseId:input.baseId,expectedVersion:input.expectedVersion,data})),db=getDatabase();
 const replay=await db.prepare('SELECT hash,result FROM annotation_operations WHERE id=? AND workspace=? AND note=?').bind(input.operationId,workspace,note).first<any>();
 if(replay){if(replay.hash!==hash)throw new HttpError(409,'This annotation operation was already used for another change.');return JSON.parse(replay.result);}
 for(let attempt=0;attempt<5;attempt++){
  const [setResult,oldResult]=await db.batch<any>([db.prepare('SELECT * FROM annotation_sets WHERE base=? AND workspace=?').bind(base.id,workspace),db.prepare('SELECT * FROM annotations WHERE id=? AND workspace=? AND note=? AND base=?').bind(annotationId,workspace,note,base.id)]);
  const set=setResult.results[0],old=oldResult.results[0];if(!set)throw new HttpError(404,'Annotation document unavailable.');
  if((old?.version||0)!==input.expectedVersion||remove&&!old){const committed=await db.prepare('SELECT hash,result FROM annotation_operations WHERE id=? AND workspace=? AND note=?').bind(input.operationId,workspace,note).first<any>();if(committed?.hash===hash)return JSON.parse(committed.result);throw new HttpError(409,'This annotation changed in another tab. Your local change is preserved; reload the saved annotation before retrying.');}
  const deltaCount=remove?-1:old?0:1,deltaBytes=(remove?0:bytes)-(old?.bytes||0);
  if(set.count+deltaCount>MAX_ANNOTATIONS||set.bytes+deltaBytes>MAX_ANNOTATION_TOTAL)throw new HttpError(413,'This document has reached the 1,000 annotation or 2 MiB annotation limit. Remove a mark or shorten its comment first.');
  const mutation=uid(),version=set.version+1,updated=new Date().toISOString();
  const result={annotation:remove?null:{id:annotationId,version,data,updated},version:set.version+1,count:set.count+deltaCount};
  const condition='EXISTS(SELECT 1 FROM annotation_sets WHERE base=? AND mutation=?)';
  const statements=[db.prepare('UPDATE annotation_sets SET version=version+1,count=count+?,bytes=bytes+?,mutation=? WHERE base=? AND workspace=? AND version=? AND EXISTS(SELECT 1 FROM notes WHERE workspace=? AND id=?)').bind(deltaCount,deltaBytes,mutation,base.id,workspace,set.version,workspace,note)];
  if(remove)statements.push(db.prepare(`DELETE FROM annotations WHERE id=? AND workspace=? AND ${condition}`).bind(annotationId,workspace,base.id,mutation));
  else statements.push(db.prepare(`INSERT INTO annotations(id,workspace,note,base,data,version,bytes,updated) SELECT ?,?,?,?,?,?,?,? WHERE ${condition} ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,bytes=excluded.bytes,updated=excluded.updated`).bind(annotationId,workspace,note,base.id,stored,version,bytes,updated,base.id,mutation));
  statements.push(db.prepare(`INSERT INTO annotation_operations(id,workspace,note,hash,result,created) SELECT ?,?,?,?,?,? WHERE ${condition}`).bind(input.operationId,workspace,note,hash,JSON.stringify(result),Date.now(),base.id,mutation));
  try{const responses=await db.batch(statements);if(responses[0].meta.changes)return result;}catch(e){const committed=await db.prepare('SELECT hash,result FROM annotation_operations WHERE id=? AND workspace=? AND note=?').bind(input.operationId,workspace,note).first<any>();if(committed?.hash===hash)return JSON.parse(committed.result);throw e;}
  const committed=await db.prepare('SELECT hash,result FROM annotation_operations WHERE id=? AND workspace=? AND note=?').bind(input.operationId,workspace,note).first<any>();if(committed?.hash===hash)return JSON.parse(committed.result);
 }
 throw new HttpError(409,'Annotations changed in another tab. Reload before retrying your saved draft.');
}

export async function startAnnotatedExport(workspace:string,note:string,value:unknown){
 const input=z.object({baseId:z.string().uuid(),version:z.number().int().nonnegative()}).parse(value),snapshot=await annotationSnapshot(workspace,note);
 if(!snapshot.base||snapshot.base.id!==input.baseId||snapshot.version!==input.version)throw new HttpError(409,'Annotations changed. Refresh the saved annotations before downloading.');if(!snapshot.count)throw new HttpError(400,'Add and save an annotation before downloading.');
 const source=await ownedSource(workspace,note),base=await readBase(workspace,note),jobs=await import('./import-jobs'),db=getDatabase();
 const cached=await db.prepare("SELECT id FROM import_jobs WHERE workspace=? AND note_id=? AND kind='export' AND status IN ('queued','processing','ready') AND json_extract(payload,'$.baseId')=? AND json_extract(payload,'$.annotationVersion')=? AND json_extract(payload,'$.expires')>? ORDER BY created DESC LIMIT 1").bind(workspace,note,input.baseId,input.version,Date.now()).first<{id:string}>();if(cached)return jobs.getImportJob(cached.id,workspace);
 const id=await documentJobId([workspace,note,input.baseId,input.version,Math.floor(Date.now()/86400000),'annotated-pdf']),expires=Date.now()+86400000,annotationKey=`documents/${workspace}/${note}/exports/${id}.json`,exportKey=`documents/${workspace}/${note}/exports/${id}.pdf`;
 await getBucket().put(annotationKey,JSON.stringify(snapshot.annotations),{httpMetadata:{contentType:'application/json'}});
 const job=await jobs.createImportJob(workspace,{id,kind:'export',name:source.name,title:source.name,originalKey:base!.object_key,mediaType:'application/pdf',size:snapshot.base.size,noteId:note,payload:{noteId:note,baseId:input.baseId,annotationVersion:input.version,annotationKey,exportKey,expires}});
 await db.prepare("INSERT OR IGNORE INTO document_files(object_key,workspace,note,job,kind,expires) VALUES(?,?,?,?,'export-snapshot',?)").bind(annotationKey,workspace,note,id,expires).run();
 try{await jobs.enqueueImportJob(id);}catch(e){await jobs.failImport(id,(e as Error).message);}return jobs.getImportJob(job.id,workspace);
}
export async function processAnnotatedExport(job:StoredImportJob){
 const note=String(job.payload.noteId);await ownedSource(job.workspace,note);const base=await readBase(job.workspace,note);if(!base||base.id!==job.payload.baseId)throw new HttpError(409,'The annotation base is unavailable.');
 await callConverter(job,'export',base.object_key,undefined,String(job.payload.annotationKey));const response=await converterArtifact(job,'export');const size=Number(response.headers.get('content-length'));if(!size||size>80*1024*1024)throw new HttpError(413,'The annotated PDF exceeds the export limit.');
 const key=String(job.payload.exportKey);await trackFile(job,note,key,'export',Number(job.payload.expires));await getBucket().put(key,response.body!,{httpMetadata:{contentType:'application/pdf'}});await verifyDocumentFile(job,key);
 const db=getDatabase(),condition="EXISTS(SELECT 1 FROM import_jobs WHERE id=? AND status='processing' AND lease_token=?) AND EXISTS(SELECT 1 FROM notes WHERE workspace=? AND id=?)";const args=[job.id,job.token,job.workspace,note];
 await db.batch([db.prepare(`UPDATE document_files SET published=1 WHERE object_key=? AND ${condition}`).bind(key,...args),db.prepare(`UPDATE import_jobs SET status='ready',lease_token=NULL,lease_until=0,updated=? WHERE id=? AND ${condition}`).bind(new Date().toISOString(),job.id,...args)]);
}
export async function downloadAnnotatedExport(workspace:string,note:string,jobId:string){
 const source=await ownedSource(workspace,note),{getImportJob}=await import('./import-jobs'),job=await getImportJob(jobId,workspace);
 if(job.kind!=='export'||job.payload.noteId!==note||job.status!=='ready')throw new HttpError(404,'The annotated PDF is not ready.');if(Number(job.payload.expires)<Date.now())throw new HttpError(410,'This download has expired. Prepare a new annotated PDF.');
 const object=await getBucket().get(String(job.payload.exportKey));if(!object)throw new HttpError(410,'This download has expired. Prepare a new annotated PDF.');
 const name=source.name.replace(/\.[^.]+$/,'')+'-annotated.pdf';return new Response(object.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Content-Length':String(object.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
