import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
const chunks='dist/client/_next/static/chunks';
const graphName=(await readdir(chunks)).find(n=>n.startsWith('NoteGraphView-')&&n.endsWith('.js'));
assert.ok(graphName,'Graph must have its own lazy-loaded chunk');
const source=await readFile(`${chunks}/${graphName}`,'utf8');
const workerUrl=source.match(/\/_next\/static\/layout\.worker-[\w-]+\.js/)?.[0];
assert.ok(workerUrl,'Graph must reference its bundled layout worker');
assert.doesNotMatch(source,/new Worker\(new URL\([^)]*file:\/\//,'Worker URL must not resolve against a server-side file URL');
const fileUrl=pathToFileURL(resolve('dist/client'+workerUrl)).href;
const elements=[{data:{id:'A'}},{data:{id:'B'}},{data:{id:'Isolated'}},{data:{id:'A-B',source:'A',target:'B'}}];
const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');globalThis.self=globalThis;self.postMessage=data=>parentPort.postMessage(data);import(workerData.url).then(()=>self.onmessage({data:{elements:workerData.elements,randomize:true}})).catch(error=>{throw error;});`,{eval:true,workerData:{url:fileUrl,elements}});
let timer;
try{
 const output=await Promise.race([new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Bundled layout worker timed out')),15000);})]);
 assert.ok(!output.error,output.error);assert.equal(output.positions.length,3);for(const n of output.positions){assert.ok(Number.isFinite(n.position.x));assert.ok(Number.isFinite(n.position.y));}
 console.log('PASS: real production layout-worker bundle returns finite positions, including an isolated note');
}finally{clearTimeout(timer);await worker.terminate();}
if(process.env.TEST_URL){
 const base=process.env.TEST_URL;const html=await (await fetch(base)).text();
 assert.doesNotMatch(html,/<(?:script|link)[^>]+(?:src|href)="[^"]*NoteGraphView-/,'Graph should not be loaded by the initial dashboard');
 for(const path of [`/_next/static/chunks/${graphName}`,workerUrl,...(await readdir(chunks)).filter(n=>n.startsWith('cytoscape.')).map(n=>`/_next/static/chunks/${n}`)]){
  const response=await fetch(base+path);assert.equal(response.status,200,path);assert.match(response.headers.get('content-type')||'',/javascript/);
 }
 console.log('PASS: graph, renderer and worker assets served correctly; graph absent from initial HTML preloads');
}
