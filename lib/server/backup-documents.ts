import {z} from 'zod';
import {validateAnnotation,MAX_ANNOTATION_TOTAL,MAX_ANNOTATIONS,rewriteAssetReferences} from '../documents.ts';
import type {StoredImportJob} from './import-jobs';
export const assetDescriptor=z.object({id:z.string().uuid(),mediaType:z.enum(['image/png','image/jpeg']),size:z.number().int().positive().max(8*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/),width:z.number().int().positive().max(20000),height:z.number().int().positive().max(20000),page:z.number().int().min(1).max(100).optional(),bbox:z.array(z.number().finite()).length(4).optional(),alt:z.string().max(1000).optional()}).strict();
export const baseDescriptor=z.object({id:z.string().uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().positive().max(40*1024*1024),kind:z.enum(['pdf','searchable-pdf','office-pdf','text-pdf']),pages:z.array(z.object({mediaBox:z.array(z.number().finite()).length(4),cropBox:z.array(z.number().finite()).length(4),rotation:z.number().int(),userUnit:z.number().positive()}).strict()).min(1).max(100)}).strict();
export const backupDocumentsSchema=z.object({
 assets:z.array(z.object({note:z.string().max(100),file:z.string().regex(/^documents\/assets\/\d+\.png$/),data:assetDescriptor}).strict()).max(10000),
 bases:z.array(z.object({note:z.string().max(100),file:z.string().regex(/^documents\/bases\/\d+\.pdf$/),annotations:z.string().regex(/^documents\/annotations\/\d+\.json$/),data:baseDescriptor}).strict()).max(200),
}).strict();
export type BackupDocuments=z.infer<typeof backupDocumentsSchema>;
export type ArchiveFile={path:string;size:number;text?:string;key?:string;etag?:string;annotationBase?:string;hash?:string};
export function documentPaths(documents?:BackupDocuments){return documents?[...documents.assets.map(a=>a.file),...documents.bases.flatMap(b=>[b.file,b.annotations])]:[];}
export async function exportDocuments(workspace:string):Promise<{documents:BackupDocuments;files:ArchiveFile[]}>{
 const {getDatabase,getBucket,digest}=await import('./workspace-store');const db=getDatabase(),bucket=getBucket(),documents:BackupDocuments={assets:[],bases:[]},files:ArchiveFile[]=[];
 const rows=await db.prepare('SELECT a.* FROM document_assets a JOIN notes n ON n.workspace=a.workspace AND n.id=a.note WHERE a.workspace=? AND a.published=1 ORDER BY a.id').bind(workspace).all<any>();
 async function binary(path:string,key:string,size:number){const object=await bucket.head(key);if(!object||object.size!==size)throw Error('A document artifact is missing; the backup was not created.');files.push({path,key,size,etag:object.etag});}
 for(const [i,row] of rows.results.entries()){const data=assetDescriptor.parse(JSON.parse(row.data)),file=`documents/assets/${i+1}.png`;documents.assets.push({note:row.note,file,data});await binary(file,row.object_key,data.size);}
 const bases=await db.prepare('SELECT b.* FROM document_bases b JOIN notes n ON n.workspace=b.workspace AND n.id=b.note WHERE b.workspace=? AND b.published=1 ORDER BY b.id').bind(workspace).all<any>();
 for(const [i,row] of bases.results.entries()){
  const data=baseDescriptor.parse({...JSON.parse(row.data),id:row.id}),file=`documents/bases/${i+1}.pdf`,annotations=`documents/annotations/${i+1}.json`;
  const content=await readAnnotationBackup(workspace,row.id);
  documents.bases.push({note:row.note,file,annotations,data});await binary(file,row.object_key,data.size);files.push({path:annotations,annotationBase:row.id,hash:await digest(content),size:new TextEncoder().encode(content).length});
 }
 return{documents,files};
}
export async function readAnnotationBackup(workspace:string,base:string){const{getDatabase}=await import('./workspace-store');const db=getDatabase();const [sets,marks]=await db.batch<any>([db.prepare('SELECT version,count,bytes FROM annotation_sets WHERE workspace=? AND base=?').bind(workspace,base),db.prepare('SELECT id,version,data,updated FROM annotations WHERE workspace=? AND base=? ORDER BY id').bind(workspace,base)]);const set=sets.results[0];if(!set||marks.results.length!==set.count)throw Error('Annotations changed while exporting. Download the backup again.');const content=JSON.stringify({baseId:base,version:set.version,annotations:marks.results.map(a=>({...a,data:JSON.parse(a.data)}))});if(new TextEncoder().encode(content).length>3*1024*1024)throw Error('Annotation backup exceeds its limit.');return content;}
export function validateDocumentManifest(documents:BackupDocuments,notes:Set<string>,sourceNotes:Set<string>){
 const ids=new Set<string>(),baseNotes=new Set<string>();for(const asset of documents.assets){if(!notes.has(asset.note)||ids.has(asset.data.id))throw Error('Invalid image ownership in backup.');ids.add(asset.data.id);}
 for(const base of documents.bases){if(!notes.has(base.note)||!sourceNotes.has(base.note)||ids.has(base.data.id)||baseNotes.has(base.note))throw Error('Invalid annotation base in backup.');ids.add(base.data.id);baseNotes.add(base.note);for(const page of base.data.pages){if(page.cropBox[2]<=page.cropBox[0]||page.cropBox[3]<=page.cropBox[1]||page.mediaBox[2]<=page.mediaBox[0]||page.mediaBox[3]<=page.mediaBox[1]||page.rotation%90)throw Error('Invalid PDF page geometry.');}}
}
export async function stageBackupDocuments(job:StoredImportJob,documents:BackupDocuments,mapped:(kind:string,id:string)=>Promise<string>,readText:(path:string,max:number)=>Promise<string>,copy:(path:string,key:string,size:number,type:string,sha?:string,note?:string)=>Promise<void>){
 const{getDatabase}=await import('./workspace-store');const db=getDatabase(),enc=new TextEncoder();
 async function stage(kind:string,id:string,note:string,key:string|null,data:unknown){await db.prepare('INSERT OR REPLACE INTO restore_documents(job,workspace,note,kind,id,object_key,data) VALUES(?,?,?,?,?,?,?)').bind(job.id,job.workspace,note,kind,id,key,JSON.stringify(data)).run();}
 for(const item of documents.assets){const id=await mapped('assets',item.data.id),note=await mapped('notes',item.note),key=`documents/${job.workspace}/${note}/assets/${id}.png`;await copy(item.file,key,item.data.size,item.data.mediaType,item.data.sha256,note);await stage('asset',id,note,key,{...item.data,id});}
 for(const item of documents.bases){
  const id=await mapped('bases',item.data.id),note=await mapped('notes',item.note),key=`documents/${job.workspace}/${note}/${id}/base.pdf`;
  await copy(item.file,key,item.data.size,'application/pdf',item.data.sha256,note);await stage('base',id,note,key,{...item.data,id});
  const value=z.object({baseId:z.string().uuid(),version:z.number().int().nonnegative(),annotations:z.array(z.object({id:z.string().uuid(),version:z.number().int().positive(),updated:z.string().datetime(),data:z.unknown()}).strict()).max(MAX_ANNOTATIONS)}).strict().parse(JSON.parse(await readText(item.annotations,3*1024*1024)));
  if(value.baseId!==item.data.id)throw Error('Annotations reference another PDF base.');let bytes=0;const seen=new Set<string>();
  for(const mark of value.annotations){if(seen.has(mark.id))throw Error('Duplicate annotation in backup.');seen.add(mark.id);const data=validateAnnotation(mark.data,item.data.pages),size=enc.encode(JSON.stringify(data)).length;bytes+=size;if(bytes>MAX_ANNOTATION_TOTAL)throw Error('Annotation data exceeds 2 MiB.');await stage('annotation',await mapped('annotations',mark.id),note,null,{base:id,data,version:mark.version,updated:mark.updated,bytes:size});}
  await stage('set',id,note,null,{version:value.version,count:value.annotations.length,bytes});
 }
}
export async function restoredDocumentStatements(job:string,workspace:string,condition:string,args:unknown[]){
 const{getDatabase}=await import('./workspace-store');const db=getDatabase(),where=`job=? AND workspace=? AND ${condition}`,bindings=[job,workspace,...args];return[
 db.prepare(`INSERT INTO document_assets(id,workspace,note,job,object_key,data,published) SELECT id,workspace,note,job,object_key,data,1 FROM restore_documents WHERE kind='asset' AND ${where}`).bind(...bindings),
 db.prepare(`INSERT INTO document_bases(id,workspace,note,job,object_key,data,published) SELECT id,workspace,note,job,object_key,data,1 FROM restore_documents WHERE kind='base' AND ${where}`).bind(...bindings),
 db.prepare(`INSERT OR IGNORE INTO document_files(object_key,workspace,note,job,kind,published) SELECT object_key,workspace,note,job,kind,1 FROM restore_documents WHERE kind IN ('asset','base') AND ${where}`).bind(...bindings),
 db.prepare(`INSERT INTO annotation_sets(base,workspace,note,version,count,bytes) SELECT id,workspace,note,json_extract(data,'$.version'),json_extract(data,'$.count'),json_extract(data,'$.bytes') FROM restore_documents WHERE kind='set' AND ${where}`).bind(...bindings),
 db.prepare(`INSERT INTO annotations(id,workspace,note,base,data,version,bytes,updated) SELECT id,workspace,note,json_extract(data,'$.base'),json_extract(data,'$.data'),json_extract(data,'$.version'),json_extract(data,'$.bytes'),json_extract(data,'$.updated') FROM restore_documents WHERE kind='annotation' AND ${where}`).bind(...bindings),
 db.prepare(`UPDATE note_sources SET preview_key=(SELECT object_key FROM document_bases b WHERE b.workspace=note_sources.workspace AND b.note=note_sources.note),preview_type='pdf' WHERE workspace=? AND note IN(SELECT note FROM restore_documents WHERE job=? AND kind='base') AND ${condition}`).bind(workspace,job,...args),
 ];
}
