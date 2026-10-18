import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:8787';
for(const path of ['/','/focus','/notes','/graph','/cards','/review','/progress','/settings','/notes/missing']){
 const response=await fetch(base+path);assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),/text\/html/);
}
assert.equal((await fetch(base+'/unknown-route')).status,404);
async function guest(){const r=await fetch(base+'/api/workspace');assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
const owner=await guest(),other=await guest();
async function post(params){const r=await fetch(base+'/api/workspace',{method:'POST',headers:{cookie:owner,Origin:base,'Content-Type':'application/json'},body:JSON.stringify(params)});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d.workspace;}
let w=await post({action:'note',title:'Stable route',body:'Synthetic route identity test.',newSubject:'First folder'});
const original=w.notes[0],url='/notes/'+encodeURIComponent(original.id);
w=await post({action:'note',id:original.id,title:'Renamed route',body:'Synthetic route identity test.',subject:original.subject,expectedUpdated:original.updated});
assert.equal(w.notes[0].id,original.id);
w=await post({action:'subject',name:'Second folder'});
w=await post({action:'moveNote',id:original.id,subject:w.subjects.at(-1).id});
assert.equal(w.notes[0].id,original.id);assert.notEqual(w.notes[0].subject,original.subject);
assert.equal((await fetch(base+url,{headers:{cookie:owner}})).status,200);
const own=await fetch(base+'/api/notes/'+encodeURIComponent(original.id),{headers:{cookie:owner}});assert.equal(own.status,200);assert.equal((await own.json()).note.title,'Renamed route');
assert.equal((await fetch(base+'/api/notes/'+encodeURIComponent(original.id),{headers:{cookie:other}})).status,404);
assert.equal((await fetch(base+'/api/notes/missing',{headers:{cookie:owner}})).status,404);
w=await post({action:'deleteNote',id:original.id});assert.equal(w.notes.length,0);
assert.equal((await fetch(base+'/api/notes/'+encodeURIComponent(original.id),{headers:{cookie:owner}})).status,404);
console.log('PASS: every direct screen route, unknown-route 404, stable note identity across rename/move, guest isolation and deleted-note rejection');
