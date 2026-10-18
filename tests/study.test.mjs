import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,queue,rate,preview,changed,links,bindLinks,resolveLink} from '../lib/study.ts';
import {workspace} from './fixtures.mjs';
test('FSRS preview and rating commit the same due time; serialization preserves it',()=>{const w=workspace(),c=queue(w)[0],now=new Date();const predicted=preview(c,now)[1].card.due;rate(w,c.id,1,'review-1',now);assert.equal(new Date(c.schedule.due).toISOString(),predicted.toISOString());const restored=JSON.parse(JSON.stringify(w));assert.equal(restored.cards.find(x=>x.id===c.id).schedule.due,predicted.toISOString());assert.ok(!queue(restored,now).some(x=>x.id===c.id));assert.equal(restored.events.length,1);});
test('review idempotency prevents a second history event',()=>{const w=workspace(),c=queue(w)[0];rate(w,c.id,1,'same');rate(w,c.id,1,'same');assert.equal(w.events.length,1);assert.equal(c.schedule.reps,2);});
test('draft, archived and suspended cards are excluded; approval introduces a draft',()=>{const w=workspace();const draft=w.cards.find(c=>c.life==='draft');assert.ok(!queue(w).includes(draft));draft.life='active';assert.ok(queue(w).includes(draft));for(const c of w.cards)c.life='suspended';assert.equal(queue(w).length,0);draft.life='archived';assert.equal(queue(w).length,0);});
test('due cards precede new cards; daily limit excludes extra new cards',()=>{const w=workspace();w.limit=1;const q=queue(w);assert.equal(q.filter(c=>c.schedule.state===0).length,1);assert.notEqual(q[0].schedule.state,0);const n=q.find(c=>c.schedule.state===0);rate(w,n.id,3,'intro');assert.equal(queue(w).filter(c=>c.schedule.state===0).length,0);});
test('source changes flag cards without changing schedule or history',()=>{const w=workspace(),c=queue(w)[0];rate(w,c.id,1,'history');const schedule=JSON.stringify(c.schedule);const n=w.notes.find(n=>n.id===c.note);n.version++;n.body+=' Changed.';assert.ok(changed(c,w));assert.equal(JSON.stringify(c.schedule),schedule);assert.equal(w.events.length,1);c.sourceVersion=n.version;assert.ok(!changed(c,w));});
test('stable links survive renaming and ignore code',()=>{const w=workspace();w.notes.forEach(n=>bindLinks(w,n));const tcp=w.notes.find(n=>n.title==='Concept A'),loss=w.notes.find(n=>n.title==='Concept B');loss.title='Renamed concept';assert.equal(resolveLink(w,'Concept B',tcp)[0].id,loss.id);assert.deepEqual(links('[[TCP]] `[[ignore]]`\n```\n[[also ignore]]\n```'),['TCP']);});

import {clozeDrafts} from '../lib/generation.ts';
test('extractive drafting works for user text and preserves exact citations',()=>{const source='Mitochondria are organelles that produce energy through cellular respiration.';const cards=clozeDrafts(source);assert.ok(cards.length);for(const c of cards){assert.equal(c.type,'cloze');assert.ok(source.includes(c.excerpt));assert.equal(c.front.replace('[...]',c.answer),c.excerpt);}});
test('insufficient material and fenced code do not create invented cards',()=>{assert.throws(()=>clozeDrafts('Hello'));assert.throws(()=>clozeDrafts('```\nMitochondria are organelles that produce energy through cellular respiration.\n```'));});

test('subject-specific new cards remain rateable outside the all-subject daily slice',()=>{
 const w=workspace();w.limit=1;
 const newCards=w.cards.filter(c=>c.life==='active'&&c.schedule.state===0);
 const chosen=newCards.at(-1);chosen.subject='other-subject';
 assert.ok(!queue(w).some(c=>c.id===chosen.id));
 assert.ok(queue(w,new Date(),'other-subject').some(c=>c.id===chosen.id));
 rate(w,chosen.id,3,'subject-review');
 assert.equal(w.events.length,1);
 assert.throws(()=>rate(w,newCards[0].id,3,'over-limit'));
});
test('idempotency keys cannot silently swallow a different card or rating',()=>{
 const w=workspace(),c=queue(w)[0];rate(w,c.id,1,'used');
 assert.throws(()=>rate(w,c.id,3,'used'));
 assert.throws(()=>rate(w,w.cards[1].id,1,'used'));
 assert.equal(w.events.length,1);
});

import {noteToMarkdown,parseMarkdownNote,notesToFiles,importMarkdownNotes,zip,unzipMarkdown} from '../lib/markdown-notes.ts';
test('markdown export round-trips title and subject through front matter',()=>{const md=noteToMarkdown({title:'TCP: "handshake"',body:'Body with [[Link]]'},'Networks');const n=parseMarkdownNote('ignored.md',md);assert.equal(n.title,'TCP: "handshake"');assert.equal(n.subject,'Networks');assert.equal(n.body,'Body with [[Link]]');});
test('markdown import uses file and folder names and keeps unknown front matter',()=>{const n=parseMarkdownNote('Vault/Biology/Cells.md','﻿---\r\ntags: [bio]\r\n---\r\nText');assert.equal(n.title,'Cells');assert.equal(n.subject,'Biology');assert.equal(n.body,'---\ntags: [bio]\n---\n\nText');assert.equal(parseMarkdownNote('Biology/Cells.md','x',false).subject,undefined);assert.equal(parseMarkdownNote('Plain.markdown','# Hi').body,'# Hi');});
test('bulk export names are unique per subject folder',()=>{const w=empty();w.subjects.push({id:'s',name:'A/B'});w.notes.push({id:'1',subject:'s',title:'Same',body:'1',aliases:[],version:1,updated:''},{id:'2',subject:'s',title:'Same',body:'2',aliases:[],version:1,updated:''});assert.deepEqual(notesToFiles(w).map(f=>f.path),['AB/Same.md','AB/Same (2).md']);});
test('zip archives round-trip markdown files including UTF-8 names',async()=>{const files=[{path:'Fächer/Ünit.md',content:'# Ü'},{path:'x/y.md',content:''}];assert.deepEqual(await unzipMarkdown(zip(files)),files);await assert.rejects(unzipMarkdown(new Uint8Array(10)),/not a readable ZIP/);});
test('markdown import matches subjects by name, uses fallback, skips identical notes',()=>{const w=empty();w.subjects.push({id:'s1',name:'Physics'});const r=importMarkdownNotes(w,{notes:[{title:'A',body:'[[B]]',subject:'physics'},{title:'B',body:'b',subject:'Chemistry'},{title:'C',body:'c'}],subject:'s1'});assert.deepEqual(r,{imported:3,skipped:0});assert.equal(w.subjects.length,2);assert.equal(w.notes.find(n=>n.title==='C').subject,'s1');assert.deepEqual(importMarkdownNotes(w,{notes:[{title:'A',body:'[[B]]',subject:'Physics'}]}),{imported:0,skipped:1});{const u=empty();assert.deepEqual(importMarkdownNotes(u,{notes:[{title:'X',body:''},{title:'Y',body:'',subject:'Uncategorised'}]}),{imported:2,skipped:0});assert.deepEqual(u.notes.map(n=>n.subject),['','']);assert.equal(u.subjects.length,0);assert.equal(notesToFiles(u)[0].path,'Uncategorised/X.md');}assert.throws(()=>importMarkdownNotes(w,{notes:[]}));});
