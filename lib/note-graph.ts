import { linksForNote, resolveLink, hasTag, type LinkedNote, type Note, type WorkspaceSnapshot, type Workspace } from './study.ts';
export type Relationship = {source:string;target:string};
export type NoteGraph = {notes:LinkedNote[];subjectIds:Set<string>;relationships:Relationship[];outgoing:Map<string,string[]>;incoming:Map<string,string[]>;unresolved:Map<string,{title:string;ambiguous:boolean}[]>};
export function buildNoteGraph(workspace: Workspace | WorkspaceSnapshot): NoteGraph {
 const outgoing=new Map(workspace.notes.map(n=>[n.id,[] as string[]]));
 const incoming=new Map(workspace.notes.map(n=>[n.id,[] as string[]]));
 const unresolved:NoteGraph['unresolved']=new Map();
 const relationships:Relationship[]=[];
 for(const note of workspace.notes){
  const targets=new Set<string>(),missing:{title:string;ambiguous:boolean}[]=[];
  for(const title of new Set(linksForNote(note))){
   const matches=resolveLink(workspace,title,note);
   // Ambiguous titles are not relationships until the student chooses a target.
   if(matches.length===1&&incoming.has(matches[0].id))targets.add(matches[0].id);
   else missing.push({title,ambiguous:matches.length>1});
  }
  outgoing.set(note.id,[...targets]);unresolved.set(note.id,missing);
  for(const target of targets){relationships.push({source:note.id,target});incoming.get(target)!.push(note.id);}
 }
 return {notes:workspace.notes,subjectIds:new Set(workspace.subjects.map(s=>s.id)),relationships,outgoing,incoming,unresolved};
}
// Subject filter value for notes without a subject (or whose subject no longer exists).
export const UNCATEGORISED='__uncategorised';
export function isUncategorised(graph:Pick<NoteGraph,'subjectIds'>,note:Pick<Note,'subject'>){return !note.subject||!graph.subjectIds.has(note.subject);}
export type GraphFilters={subject:string;tag?:string;showIsolated:boolean;root:string;hops:1|2};
export function visibleGraph(graph:NoteGraph,filters:GraphFilters){
 let local:Set<string>|undefined;
 if(filters.root){local=new Set(graph.notes.some(n=>n.id===filters.root)?[filters.root]:[]);let frontier=[...local];for(let hop=0;hop<filters.hops;hop++){
  const next:string[]=[];for(const id of frontier)for(const neighbour of [...(graph.outgoing.get(id)||[]),...(graph.incoming.get(id)||[])])if(!local.has(neighbour)){local.add(neighbour);next.push(neighbour);}frontier=next;
 }}
 let notes=graph.notes.filter(n=>(!local||local.has(n.id))&&(!filters.subject||(filters.subject===UNCATEGORISED?isUncategorised(graph,n):n.subject===filters.subject))&&(!filters.tag||hasTag(n,filters.tag)));
 const candidateIds=new Set(notes.map(n=>n.id));
 let relationships=graph.relationships.filter(e=>candidateIds.has(e.source)&&candidateIds.has(e.target));
 if(!filters.showIsolated){const connected=new Set(relationships.flatMap(e=>[e.source,e.target]));notes=notes.filter(n=>connected.has(n.id));}
 const ids=new Set(notes.map(n=>n.id));relationships=relationships.filter(e=>ids.has(e.source)&&ids.has(e.target));
 return {notes,relationships};
}
export function visualConnections(relationships:Relationship[]){
 const pairs=new Map<string,{id:string;source:string;target:string;reciprocal:boolean}>();
 for(const {source,target}of relationships){const id=JSON.stringify([source,target].sort());const existing=pairs.get(id);if(existing){if(source!==target)existing.reciprocal=true;}else pairs.set(id,{id:'edge:'+id,source,target,reciprocal:false});}
 return [...pairs.values()];
}
export function plainPreview(body:string){return body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g,' ').replace(/<[^>]*>/g,' ').replace(/\[\[([^\]]+)\]\]/g,'$1').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[#*_`>~]/g,'').replace(/\s+/g,' ').trim().slice(0,240);}
