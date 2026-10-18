import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

// Exercise the actual consumer and workspace publication SQL without a live
// Worker. Only platform bindings are replaced; D1 uses SQLite transactions.
const temporary = await mkdtemp(join(tmpdir(), 'studysprint-import-queue-'));
const output = join(temporary, 'consumer.mjs');
globalThis.__studySprintQueueEnv = {};
await build({entryPoints:['lib/server/import-jobs.ts'], outfile:output, bundle:true, platform:'node', format:'esm', logLevel:'silent', plugins:[{
    name:'cloudflare-test-binding',
    setup(builder) {
        builder.onResolve({filter:/^cloudflare:workers$/}, () => ({path:'cloudflare:workers', namespace:'test-binding'}));
        builder.onLoad({filter:/.*/, namespace:'test-binding'}, () => ({contents:'export const env = globalThis.__studySprintQueueEnv;', loader:'js'}));
    },
}]});
const consumer = await import(pathToFileURL(output).href);
const migrations = await Promise.all(['0000_fearless_the_hand','0001_quick_shaman','0002_goofy_tinkerer','0003_same_nebula'].map(name => readFile(`drizzle/${name}.sql`, 'utf8')));

function d1(raw) {
    function prepared(sql, parameters = []) {
        function execute() {
            const statement = raw.prepare(sql);
            if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)) return {results:statement.all(...parameters), meta:{changes:0}};
            return {results:[], meta:{changes:Number(statement.run(...parameters).changes)}};
        }
        return {bind(...values) {return prepared(sql, values);}, async run() {return execute();}, async all() {return execute();}, async first(column) {const result=raw.prepare(sql).get(...parameters);return result ? (column ? result[column] : result) : null;}, execute};
    }
    return {prepare:prepared, async batch(statements) {raw.exec('BEGIN');try {const result=statements.map(statement => statement.execute());raw.exec('COMMIT');return result;}catch(error){raw.exec('ROLLBACK');throw error;}}};
}
function message(id, attempts = 1) {
    return {body:{id}, attempts, acknowledged:false, retries:[], ack(){this.acknowledged=true;}, retry(options){this.retries.push(options);}};
}
async function fixture(status = 'processing') {
    const raw = new DatabaseSync(':memory:');
    for (const sql of migrations) raw.exec(sql);
    const workspace=crypto.randomUUID(), id=crypto.randomUUID(), text='Retrieval practice strengthens memory.';
    raw.prepare('INSERT INTO workspaces(id,data,version) VALUES(?,?,0)').run(workspace,JSON.stringify({subjects:[],notes:[],cards:[],events:[],limit:10,zone:'UTC'}));
    raw.prepare('INSERT INTO import_jobs(id,workspace,kind,name,title,status,original_key,media_type,size,created,updated,attempts,lease_token,lease_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,workspace,'document','lecture.txt','Synthetic queued note',status,'test-original','text/plain',text.length,'2026-10-18','2026-10-18',status==='processing'?1:0,status==='processing'?'crashed-worker':null,status==='processing'?Date.now()+900000:0);
    const objects=new Map([['test-original',Buffer.from(text)]]), deletions=[], fetches=[];
    const bucket={async head(key){const value=objects.get(key);return value?{size:value.length}:null;},async get(key){const value=objects.get(key);if(!value)return null;await bucket.onGet?.(key);return {arrayBuffer:async()=>Uint8Array.from(value).buffer,body:new Blob([value]).stream()};},async put(key,value){objects.set(key,Buffer.from(await new Response(value).arrayBuffer()));},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys]){deletions.push(key);objects.delete(key);}}};
    Object.assign(globalThis.__studySprintQueueEnv,{DB:d1(raw),BUCKET:bucket,CONVERTER_URL:'http://private-converter',CONVERTER_SECRET:'synthetic-test-secret'});
    const realFetch=globalThis.fetch;
    globalThis.fetch=async(url,options)=>{fetches.push({url,options});if(options?.method==='DELETE')return new Response(null,{status:204});if(String(url).endsWith('/preview'))return new Response('%PDF-fixture',{headers:{'Content-Length':'12'}});return Response.json({markdown:text,ocr:false,preview:true,base:{sha256:'a'.repeat(64),size:12,kind:'text-pdf',pages:[{mediaBox:[0,0,612,792],cropBox:[0,0,612,792],rotation:0,userUnit:1}]},assets:[],conversion:{engine:'test',warnings:[]}});};
    return {raw,workspace,id,text,bucket,fetches,deletions,close(){globalThis.fetch=realFetch;raw.close();}};
}

test('duplicate delivery preserves an active lease and cannot clean up its converter artifact', async()=>{
    const state=await fixture();
    try {
        const delivery=message(state.id,2);
        await consumer.consumeImports({messages:[delivery]});
        assert.equal(delivery.acknowledged,false);
        assert.equal(delivery.retries.length,1);
        assert.ok(delivery.retries[0].delaySeconds>=899 && delivery.retries[0].delaySeconds<=901, 'A duplicate must wait for the remaining15-minute lease, not retry every60seconds');
        const row=state.raw.prepare('SELECT * FROM import_jobs WHERE id=?').get(state.id);
        assert.equal(row.status,'processing');
        assert.equal(row.lease_token,'crashed-worker');
        assert.equal(row.attempts,1);
        assert.equal(state.raw.prepare('SELECT count(*) AS count FROM notes').get().count,0);
        assert.deepEqual(state.fetches,[],'An unowned delivery must not DELETE active converter artifacts');
        assert.deepEqual(state.deletions,[]);
        assert.equal(Object.hasOwn(consumer.publicJob(await consumer.getImportJob(state.id)),'leaseUntil'),false);
    } finally {state.close();}
});

test('crashed-worker redelivery waits until lease expiry and publishes once within the delivery budget', async()=>{
    const realNow=Date.now;
    let now=realNow();Date.now=()=>now;
    const state=await fixture();
    try {
        const blocked=message(state.id,2);
        await consumer.consumeImports({messages:[blocked]});
        assert.ok(blocked.retries[0].delaySeconds>=900);
        now+=blocked.retries[0].delaySeconds*1000;
        const recovered=message(state.id,3);
        await consumer.consumeImports({messages:[recovered]});
        assert.equal(recovered.acknowledged,true);
        assert.deepEqual(recovered.retries,[]);
        const row=state.raw.prepare('SELECT * FROM import_jobs WHERE id=?').get(state.id);
        assert.equal(row.status,'ready');assert.equal(row.note_id,state.id);
        assert.equal(state.raw.prepare('SELECT body FROM notes WHERE id=?').get(state.id).body,state.text);
        assert.equal(state.fetches.filter(f=>f.options?.method==='DELETE').length,1,'Only the delivery that acquired the lease owns artifact cleanup');
        const duplicate=message(state.id,4);
        await consumer.consumeImports({messages:[duplicate]});
        assert.equal(duplicate.acknowledged,true);
        assert.equal(state.raw.prepare('SELECT count(*) AS count FROM notes').get().count,1);
        assert.equal(state.fetches.filter(f=>f.options?.method==='DELETE').length,1,'Completed redelivery must not clean an artifact belonging to another attempt');
    } finally {state.close();Date.now=realNow;}
});

test('cancellation during an owned delivery prevents publication and remains cancelled', async()=>{
    const state=await fixture('queued');
    try {
        state.bucket.onGet=async()=>{state.bucket.onGet=null;await consumer.cancelImport(state.workspace,state.id);};
        const delivery=message(state.id);
        await consumer.consumeImports({messages:[delivery]});
        assert.equal(delivery.acknowledged,true);
        assert.equal(state.raw.prepare('SELECT status FROM import_jobs WHERE id=?').get(state.id).status,'cancelled');
        assert.equal(state.raw.prepare('SELECT count(*) AS count FROM notes').get().count,0);
        assert.equal(state.raw.prepare('SELECT count(*) AS count FROM note_sources').get().count,0);
    } finally {state.close();}
});

test.after(async()=>{delete globalThis.__studySprintQueueEnv;await rm(temporary,{recursive:true,force:true});});
