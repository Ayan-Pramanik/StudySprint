import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ZipReader,ZipWriter,Uint8ArrayReader,Uint8ArrayWriter} from '@zip.js/zip.js/lib/zip-core-native.js';

const base=process.env.TEST_URL||'http://127.0.0.1:8787';
async function guest(){const result=await fetch(base+'/api/workspace?zone=Australia%2FSydney');assert.equal(result.status,200);return{cookie:result.headers.get('set-cookie').split(';')[0]};}
async function json(path,g,init={}){const result=await fetch(base+path,{...init,headers:{cookie:g.cookie,Origin:base,...init.headers}});const data=await result.json();assert.ok(result.ok,JSON.stringify({status:result.status,...data}));return data;}
async function mutate(g,action,params){return json('/api/workspace',g,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...params})});}
async function waitJob(g,id){for(let attempt=0;attempt<180;attempt++){const {job}=await json('/api/note-imports/'+id,g);if(['ready','failed','cancelled'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,250));}throw Error('Background job did not finish.');}
async function restore(g,bytes,other){const init=await json('/api/backups',g,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'portable.zip',size:bytes.length})});
if(other){const denied=await fetch(`${base}/api/backups/${init.id}?part=1`,{method:'PUT',headers:{cookie:other.cookie,Origin:base},body:bytes});assert.equal(denied.status,404);await denied.arrayBuffer();}
for(let offset=0,part=1;offset<bytes.length;offset+=init.partSize,part++)await json(`/api/backups/${init.id}?part=${part}`,g,{method:'PUT',body:bytes.slice(offset,offset+init.partSize)});
const {job}=await json('/api/backups/'+init.id,g,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'complete'})});return waitJob(g,job.id);}

const a=await guest(),b=await guest();
const original='---\ntitle: Original source title\n---\n\nMitochondria produce energy through cellular respiration. Καλημέρα.\n';
const form=new FormData();form.append('file',new File([original],'Lecture.md',{type:'text/markdown'}));form.append('title','Portable lecture');form.append('requestId',crypto.randomUUID());
const submitted=await json('/api/note-imports',a,{method:'POST',body:form});const imported=await waitJob(a,submitted.job.id);assert.equal(imported.status,'ready',imported.error);
let {note}=await json('/api/notes/'+imported.noteId,a);const firstBody=note.body;
await mutate(a,'note',{id:note.id,title:note.title,subject:note.subject,body:firstBody+'\nA second, edited paragraph.',expectedUpdated:note.updated});
({note}=await json('/api/notes/'+imported.noteId,a));assert.equal(note.versions.length,1);
const foreign=await fetch(base+'/api/notes/'+note.id+'/source',{headers:{cookie:b.cookie}});assert.equal(foreign.status,404);
const forbidden=await fetch(base+'/api/backups',{method:'POST',headers:{cookie:a.cookie,Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify({name:'bad.zip',size:100})});assert.equal(forbidden.status,403);
const exported=await fetch(base+'/api/backups',{headers:{cookie:a.cookie}});assert.equal(exported.status,200);assert.match(exported.headers.get('content-type'),/application\/zip/);
const bytes=new Uint8Array(await exported.arrayBuffer());
const reader=new ZipReader(new Uint8ArrayReader(bytes),{useWebWorkers:false,checkCrc32:true});const entries=await reader.getEntries();const manifest=JSON.parse(new TextDecoder().decode(await entries.find(entry=>entry.filename==='manifest.json').arrayBuffer({useWebWorkers:false,checkCrc32:true})));assert.equal(manifest.version,3);assert.equal(manifest.sources.length,1);assert.equal(manifest.notes[0].versions.length,1);await reader.close();
const ready=await restore(b,bytes,a);assert.equal(ready.status,'ready',ready.error);
const after=await json('/api/workspace',b);assert.equal(after.workspace.notes.length,1);const restoredId=after.workspace.notes[0].id;assert.notEqual(restoredId,note.id);
const restored=(await json('/api/notes/'+restoredId,b)).note;assert.equal(restored.body,note.body);assert.equal(restored.versions.length,1);assert.notEqual(restored.source.id,note.source.id);
const revision=await json(`/api/notes/${restoredId}/revisions/${restored.versions[0].version}`,b);assert.equal(revision.body,firstBody);
const originalResponse=await fetch(base+'/api/notes/'+restoredId+'/source',{headers:{cookie:b.cookie}});assert.equal(originalResponse.status,200);assert.equal(await originalResponse.text(),original);
const searched=await json('/api/notes/search?q='+encodeURIComponent('ΚΑΛΗΜΈΡΑ'),b);assert.ok(searched.ids.includes(restoredId));
console.log('PASS: private source ownership, ZIP-v3 manifest, original bytes, edited Markdown and complete revisions survive a fresh-guest restore');

const corrupt=bytes.slice(),marker=new TextEncoder().encode('---\ntitle: Original source title\n---');let position=-1;for(let index=0;index<corrupt.length-marker.length;index++)if(marker.every((value,offset)=>corrupt[index+offset]===value)){position=index;break;}assert.ok(position>=0);corrupt[position]^=1;
const failed=await restore(b,corrupt);assert.equal(failed.status,'failed');assert.match(failed.error,/CRC|checksum|signature/i);const unchanged=await json('/api/workspace',b);assert.equal(unchanged.workspace.notes.length,1);assert.equal((await json('/api/notes/'+restoredId,b)).note.body,note.body);
console.log('PASS: corrupted archived original is rejected without publishing staged notes or altering existing work');

const upload=await json('/api/backups',b,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'cancel.zip',size:bytes.length})});await json('/api/backups/'+upload.id,b,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel'})});const missing=await fetch(`${base}/api/backups/${upload.id}?part=1`,{method:'PUT',headers:{cookie:b.cookie,Origin:base},body:bytes});assert.equal(missing.status,404);
console.log('PASS: cancelled multipart backup uploads cannot be completed or reused');

// A note may be edited down after conversion; its retained original remains
// large. Exercise a real two-part restore above the old 2.9 MB JSON limit.
const largeSource=new Uint8Array(9*1024*1024).fill(32);largeSource.set(new TextEncoder().encode('# Retained original\n'));largeSource.set(new TextEncoder().encode('End marker'),largeSource.length-10);
const sourceReader=new ZipReader(new Uint8ArrayReader(bytes),{useWebWorkers:false});const sourceEntries=await sourceReader.getEntries();const largeOutput=new Uint8ArrayWriter();const largeWriter=new ZipWriter(largeOutput,{level:0,useWebWorkers:false});
for(const entry of sourceEntries){let content=new Uint8Array(await entry.arrayBuffer({useWebWorkers:false,checkCrc32:true}));if(entry.filename==='manifest.json'){const value=JSON.parse(new TextDecoder().decode(content));value.sources[0].size=largeSource.length;content=new TextEncoder().encode(JSON.stringify(value));}else if(entry.filename===manifest.sources[0].original)content=largeSource;await largeWriter.add(entry.filename,new Uint8ArrayReader(content));}
const largeArchive=await largeWriter.close();await sourceReader.close();assert.ok(largeArchive.length>8*1024*1024);
const c=await guest();const largeJob=await restore(c,largeArchive);assert.equal(largeJob.status,'ready',largeJob.error);const largeWorkspace=await json('/api/workspace',c);const largeId=largeWorkspace.workspace.notes[0].id;const tail=await fetch(base+'/api/notes/'+largeId+'/source',{headers:{cookie:c.cookie,Range:'bytes=-10'}});assert.equal(tail.status,206);assert.equal(await tail.text(),'End marker');
console.log('PASS: a 9 MiB original survives two-part archive upload and streamed restore above the legacy JSON limit');

const officeFiles={
'[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
'_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
'word/document.xml':'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Retrieval practice strengthens memory through active recall.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
};
// Office applications expect conventional seekable ZIP headers rather than
// the streaming data descriptors used for downloadable workspace archives.
const officeBytes=execFileSync(fileURLToPath(new URL('../converter/.venv/bin/python',import.meta.url)),['-c','import io,json,sys,zipfile\nout=io.BytesIO()\nwith zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED) as archive:\n for name,value in json.load(sys.stdin).items():archive.writestr(name,value)\nsys.stdout.buffer.write(out.getvalue())'],{input:JSON.stringify(officeFiles)}),officeOwner=await guest(),officeTarget=await guest(),officeForm=new FormData();officeForm.append('file',new File([officeBytes],'Synthetic backup lecture.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));officeForm.append('title','Synthetic Office backup');
const officeStart=await json('/api/note-imports',officeOwner,{method:'POST',body:officeForm}),officeReady=await waitJob(officeOwner,officeStart.job.id);assert.equal(officeReady.status,'ready',officeReady.error);
const officeNote=(await json('/api/notes/'+officeReady.noteId,officeOwner)).note;assert.equal(officeNote.source.derivedPreview,true);
const previewBefore=new Uint8Array(await(await fetch(base+'/api/notes/'+officeNote.id+'/source?preview=1',{headers:{cookie:officeOwner.cookie}})).arrayBuffer());assert.equal(new TextDecoder().decode(previewBefore.subarray(0,5)),'%PDF-');
const officeBackup=new Uint8Array(await(await fetch(base+'/api/backups',{headers:{cookie:officeOwner.cookie}})).arrayBuffer()),officeRestored=await restore(officeTarget,officeBackup);assert.equal(officeRestored.status,'ready',officeRestored.error);
const officeRestoredId=(await json('/api/workspace',officeTarget)).workspace.notes[0].id,officeRestoredNote=(await json('/api/notes/'+officeRestoredId,officeTarget)).note;assert.equal(officeRestoredNote.source.derivedPreview,true);
const previewAfter=new Uint8Array(await(await fetch(base+'/api/notes/'+officeRestoredId+'/source?preview=1',{headers:{cookie:officeTarget.cookie}})).arrayBuffer());assert.deepEqual(previewAfter,previewBefore);
const officeOriginalAfter=new Uint8Array(await(await fetch(base+'/api/notes/'+officeRestoredId+'/source',{headers:{cookie:officeTarget.cookie}})).arrayBuffer());assert.deepEqual(officeOriginalAfter,new Uint8Array(officeBytes));
console.log('PASS: real DOCX original and its LibreOffice PDF preview both restore byte-for-byte with derived-preview metadata intact');
