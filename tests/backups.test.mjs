import test from 'node:test';
import assert from 'node:assert/strict';
import { ZipReader, ZipWriter, Uint8ArrayReader, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js/lib/zip-core-native.js';
import { BACKUP_PART_SIZE, MAX_BACKUP_BYTES, backupPartSize, expectedBackupPaths, parseBackupManifest, R2BackupReader, readBackupText } from '../lib/server/backups.ts';

const manifest = () => ({format:'studysprint',version:2,exportedAt:'2026-10-18T12:00:00.000Z',workspace:'workspace.json',notes:[{id:'note-1',body:'notes/1.md',versions:[{version:1,body:'revisions/1/1.md'}]}],sources:[{id:'source-1',note:'note-1',name:'A lecture.pdf',mediaType:'application/pdf',size:12,preview:'pdf',derivedPreview:false,ocr:false,original:'sources/1/original'}]});

test('portable manifest retains original paths, current text and every revision',()=>{
    const value=parseBackupManifest(manifest());
    assert.deepEqual([...expectedBackupPaths(value)],['manifest.json','workspace.json','notes/1.md','revisions/1/1.md','sources/1/original']);
});
test('manifest rejects paths outside its generated namespace and repeated source ownership',()=>{
    const unsafe=manifest();unsafe.sources[0].original='../private/file';assert.throws(()=>parseBackupManifest(unsafe));
    const duplicate=manifest();duplicate.sources.push({...duplicate.sources[0],id:'second-source',original:'sources/2/original'});assert.throws(()=>parseBackupManifest(duplicate),/duplicate source/);
    const missing=manifest();missing.sources[0].note='missing-note';assert.throws(()=>parseBackupManifest(missing),/missing note/);
});
test('manifest prevents missing or incompatible source previews',()=>{
    const value=manifest();value.sources[0].mediaType='application/vnd.openxmlformats-officedocument.wordprocessingml.document';assert.throws(()=>parseBackupManifest(value),/missing a document preview/);
    value.sources[0].previewFile='sources/1/preview.pdf';value.sources[0].previewSize=100;value.sources[0].derivedPreview=true;assert.doesNotThrow(()=>parseBackupManifest(value));
    value.sources[0].preview='text';assert.throws(()=>parseBackupManifest(value),/text source/);
});
test('multipart sizing rejects missing, fractional and extra parts, preserving the last short part',()=>{
    assert.equal(backupPartSize(BACKUP_PART_SIZE+3,1),BACKUP_PART_SIZE);assert.equal(backupPartSize(BACKUP_PART_SIZE+3,2),3);
    assert.equal(backupPartSize(MAX_BACKUP_BYTES,32),BACKUP_PART_SIZE);
    for(const value of [0,-1,1.2,3,NaN])assert.throws(()=>backupPartSize(BACKUP_PART_SIZE+3,value));
});

async function archive(files){const output=new Uint8ArrayWriter();const writer=new ZipWriter(output,{level:0,useWebWorkers:false});for(const[name,content]of files)await writer.add(name,typeof content==='string'?new TextReader(content):new Uint8ArrayReader(content));return writer.close();}
function rangedBucket(bytes){const calls=[];return {calls,async get(key,{range}){calls.push({key,...range});const data=bytes.slice(range.offset,range.offset+range.length);return{body:new Blob([data]).stream(),arrayBuffer:async()=>data.buffer};}};}

test('R2 range reader streams binary originals without reading the whole ZIP',async()=>{
    const original=Uint8Array.from({length:8*1024*1024},(_,index)=>index%251);
    const bytes=await archive([['manifest.json',JSON.stringify(manifest())],['notes/1.md','# Lecture\n\nA preserved passage.'],['sources/1/original',original]]);
    const bucket=rangedBucket(bytes);const reader=new ZipReader(new R2BackupReader(bucket,'private/backup.zip',bytes.length),{useWebWorkers:false,checkCrc32:true});
    const entries=await reader.getEntries();assert.equal(entries.length,3);
    const text=await readBackupText(entries.find(entry=>entry.filename==='notes/1.md'),1024);assert.equal(text,'# Lecture\n\nA preserved passage.');
    const restored=new Uint8Array(await entries.find(entry=>entry.filename==='sources/1/original').arrayBuffer({checkCrc32:true,useWebWorkers:false}));assert.deepEqual(restored,original);
    assert.ok(bucket.calls.length>3);assert.ok(bucket.calls.every(call=>call.key==='private/backup.zip'&&call.length<bytes.length));await reader.close();
});
test('restore checks CRC and rejects altered stored contents',async()=>{
    const bytes=await archive([['notes/1.md','Unique intact note passage']]);
    const marker=new TextEncoder().encode('Unique intact note passage');let position=-1;
    for(let index=0;index<bytes.length-marker.length;index++)if(marker.every((value,offset)=>bytes[index+offset]===value)){position=index;break;}
    assert.ok(position>=0);bytes[position]^=1;
    const reader=new ZipReader(new Uint8ArrayReader(bytes),{useWebWorkers:false});const [entry]=await reader.getEntries();
    await assert.rejects(readBackupText(entry,1024),/CRC|checksum|signature/i);await reader.close();
});
test('restore text limits count actual UTF-8 bytes and reject malformed text',async()=>{
    const bytes=await archive([['large.md','é'.repeat(30)],['invalid.md',new Uint8Array([0xff,0xfe])]]);const reader=new ZipReader(new Uint8ArrayReader(bytes),{useWebWorkers:false});const entries=await reader.getEntries();
    await assert.rejects(readBackupText(entries[0],59),/limit/);await assert.rejects(readBackupText(entries[1],100),/encoded data|encoding/i);await reader.close();
});
test('random directory reads are bounded and cancellation reaches underlying R2 stream',async()=>{
    const reader=new R2BackupReader(rangedBucket(new Uint8Array(100)), 'private/key',100);await assert.rejects(reader.readUint8Array(-1,2),/range/);assert.equal((await reader.readUint8Array(98,10)).length,2);
    const oversized=new R2BackupReader(rangedBucket(new Uint8Array(0)),'private/key',20*1024*1024);await assert.rejects(oversized.readUint8Array(0,9*1024*1024),/directory/);
    let cancelled=false;const bucket={async get(){return{body:new ReadableStream({pull(controller){controller.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}})}}};
    const stream=new R2BackupReader(bucket,'private/key',2*1024*1024).createReadable({offset:0,size:2*1024*1024});const consumer=stream.getReader();await consumer.read();await consumer.cancel();assert.equal(cancelled,true);
});
