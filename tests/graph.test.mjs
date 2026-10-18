import test from 'node:test';
import assert from 'node:assert/strict';
import cytoscape from 'cytoscape';
import {empty,bindLinks} from '../lib/study.ts';
import {buildNoteGraph,visibleGraph,visualConnections,plainPreview} from '../lib/note-graph.ts';
function note(id,body='',subject='s'){return {id,subject,title:id,body,aliases:[],version:1,updated:new Date().toISOString()};}
function fixture(notes){return {...empty(),subjects:[{id:'s',name:'First'},{id:'t',name:'Second'}],notes};}
const filters={subject:'',showIsolated:true,root:'',hops:1};
test('A → B produces two nodes, one relationship and one backlink, without duplication',()=>{
 const g=buildNoteGraph(fixture([note('A','[[B]] [[B]]'),note('B')]));
 assert.equal(g.notes.length,2);assert.deepEqual(g.relationships,[{source:'A',target:'B'}]);assert.deepEqual(g.incoming.get('B'),['A']);assert.deepEqual(g.outgoing.get('B'),[]);
});
test('reciprocal explicit links retain two directed counts on one visual connection',()=>{
 const g=buildNoteGraph(fixture([note('A','[[B]]'),note('B','[[A]]')]));const lines=visualConnections(g.relationships);
 assert.equal(g.relationships.length,2);assert.equal(lines.length,1);assert.equal(lines[0].reciprocal,true);
});
test('isolated notes are shown by default and can be excluded',()=>{
 const g=buildNoteGraph(fixture([note('A','[[B]]'),note('B'),note('C')]));
 assert.equal(visibleGraph(g,filters).notes.length,3);assert.deepEqual(visibleGraph(g,{...filters,showIsolated:false}).notes.map(n=>n.id),['A','B']);
});
test('local BFS includes incoming and outgoing neighbours, then the second hop',()=>{
 const g=buildNoteGraph(fixture([note('A','[[B]]'),note('B','[[C]]'),note('C','[[D]]'),note('D'),note('E')]));
 assert.deepEqual(visibleGraph(g,{...filters,root:'B'}).notes.map(n=>n.id),['A','B','C']);
 assert.deepEqual(visibleGraph(g,{...filters,root:'B',hops:2}).notes.map(n=>n.id),['A','B','C','D']);
});
test('subject filters remove cross-subject edges and isolated is relative to the visible graph',()=>{
 const g=buildNoteGraph(fixture([note('A','[[B]]'),note('B','','t')]));const visible=visibleGraph(g,{...filters,subject:'s'});
 assert.equal(visible.notes.length,1);assert.equal(visible.relationships.length,0);assert.equal(visibleGraph(g,{...filters,subject:'s',showIsolated:false}).notes.length,0);
});
test('renaming preserves bound IDs, deletion removes endpoints, and removing link text removes edges',()=>{
 const w=fixture([note('A','[[B]]'),note('B')]);w.notes.forEach(n=>bindLinks(w,n));w.notes[1].title='Renamed';
 assert.equal(buildNoteGraph(w).relationships[0].target,'B');assert.equal(buildNoteGraph(w).notes[1].title,'Renamed');
 w.notes[0].body='';assert.equal(buildNoteGraph(w).relationships.length,0);w.notes[0].body='[[B]]';w.notes.pop();
 const g=buildNoteGraph(w);assert.equal(g.relationships.length,0);assert.deepEqual(g.unresolved.get('A'),[{title:'B',ambiguous:false}]);
});
test('unresolved becomes resolved after creation; ambiguous titles require a chosen binding',()=>{
 const w=fixture([note('A','[[B]]')]);assert.equal(buildNoteGraph(w).relationships.length,0);w.notes.push(note('B'));w.notes.forEach(n=>bindLinks(w,n));assert.equal(buildNoteGraph(w).relationships.length,1);
 const w2=fixture([note('A','[[Shared]]'),{...note('B'),title:'Shared'},{...note('C'),title:'Shared'}]);assert.equal(buildNoteGraph(w2).relationships.length,0);assert.equal(buildNoteGraph(w2).unresolved.get('A')[0].ambiguous,true);w2.notes[0].bindings={Shared:'C'};assert.equal(buildNoteGraph(w2).relationships[0].target,'C');
});
test('same-subject resolution is reused; external workspace notes cannot appear',()=>{
 const w=fixture([note('A','[[Shared]] [[Private]]'),{...note('B'),title:'Shared'},{...note('C','','t'),title:'Shared'}]);const g=buildNoteGraph(w);
 assert.deepEqual(g.relationships,[{source:'A',target:'B'}]);assert.ok(!g.notes.some(n=>n.id==='Private'));assert.deepEqual(g.unresolved.get('A'),[{title:'Private',ambiguous:false}]);
});
test('code links do not create graph edges; self-links have a single directional relationship',()=>{
 const g=buildNoteGraph(fixture([note('A','[[A]] `[[B]]`\n```\n[[B]]\n```'),note('B')]));assert.deepEqual(g.relationships,[{source:'A',target:'A'}]);assert.equal(visualConnections(g.relationships)[0].reciprocal,false);
});
test('plain previews do not expose Markdown syntax or HTML elements',()=>{
 assert.equal(plainPreview('# Heading\n\n**bold** and [[Linked]] with [site](https://example.com). <b>safe</b>'),'Heading bold and Linked with site. safe');
});
test('force layout completes with finite positions for 300 notes and no invented edges',()=>{
 const notes=Array.from({length:300},(_,i)=>note('N'+i,i<299?'[[N'+(i+1)+']]':''));const graph=buildNoteGraph(fixture(notes));
 const cy=cytoscape({headless:true,elements:[...graph.notes.map(n=>({data:{id:n.id}})),...visualConnections(graph.relationships).map(e=>({data:e}))]});
 cy.layout({name:'cose',animate:false,numIter:300,randomize:true}).run();
 assert.equal(cy.nodes().length,300);assert.equal(cy.edges().length,299);cy.nodes().forEach(n=>{assert.ok(Number.isFinite(n.position('x')));assert.ok(Number.isFinite(n.position('y')));});cy.destroy();
});
test('uncategorised notes, including ones whose subject was deleted, are visible and filterable',async()=>{
 const {UNCATEGORISED,isUncategorised}=await import('../lib/note-graph.ts');
 const g=buildNoteGraph(fixture([note('A','[[B]]'),note('B','',''),note('C','','gone')]));
 assert.deepEqual(visibleGraph(g,filters).notes.map(n=>n.id),['A','B','C']);
 assert.deepEqual(visibleGraph(g,{...filters,subject:UNCATEGORISED}).notes.map(n=>n.id),['B','C']);
 assert.equal(isUncategorised(g,g.notes[0]),false);
});
test('force simulation separates notes, keeps linked notes near link distance, and respects pins',async()=>{
 const {ForceSimulation}=await import('../lib/graph-forces.ts');
 const sim=new ForceSimulation([{id:'A',x:0,y:0},{id:'B',x:1,y:0},{id:'C',x:0,y:1},{id:'D',x:400,y:400}],[{source:'A',target:'B'}],{center:.5,repel:10,link:1,distance:120});
 sim.pin('D',400,400);sim.settle(1000);
 const [a,b,c,d]=sim.nodes,dist=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);
 for(const n of sim.nodes){assert.ok(Number.isFinite(n.x)&&Number.isFinite(n.y));}
 assert.ok(dist(a,c)>40&&dist(b,c)>40,'unlinked notes repel');
 assert.ok(Math.abs(dist(a,b)-120)<60,`linked notes settle near link distance (got ${dist(a,b)})`);
 assert.deepEqual([d.x,d.y],[400,400]);assert.equal(sim.running,false);
 sim.unpin('D');sim.reheat(.3);assert.ok(sim.running);
});

test('the tag filter keeps only tagged notes and the links between them',()=>{const w=empty();const note=(id,title,body,tags)=>({id,subject:'',title,body,aliases:[],version:1,updated:'',tags});w.notes.push(note('a','A','[[B]] [[C]]',['Exam']),note('b','B','',['exam','bio']),note('c','C','',undefined));w.notes.forEach(n=>bindLinks(w,n));const g=buildNoteGraph(w);
const v=visibleGraph(g,{subject:'',tag:'EXAM',showIsolated:true,root:'',hops:1});assert.deepEqual(v.notes.map(n=>n.id),['a','b']);assert.deepEqual(v.relationships,[{source:'a',target:'b'}]);
assert.deepEqual(visibleGraph(g,{subject:'',tag:'bio',showIsolated:false,root:'',hops:1}).notes,[]);assert.equal(visibleGraph(g,{subject:'',showIsolated:true,root:'',hops:1}).notes.length,3);});
