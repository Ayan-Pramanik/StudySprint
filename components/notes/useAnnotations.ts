'use client';
import {useEffect,useRef,useState} from 'react';
import {validateAnnotation} from '../../lib/documents';
import type {Annotation,AnnotationData,AnnotationSnapshot,DocumentBase} from '../../lib/documents';

type Change={id:string;data:AnnotationData|null;operationId:string;expectedVersion?:number};
type History={id:string;before:AnnotationData|null;after:AnnotationData|null};
const empty:AnnotationSnapshot={base:null,version:0,count:0,annotations:[]};
export function useAnnotations(note:string,base:DocumentBase|null){
 const [snapshot,setSnapshot]=useState(empty),[pending,setPending]=useState<Change[]>([]),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[loaded,setLoaded]=useState(false),[historyTick,tick]=useState(0);
 const state=useRef({snapshot:empty,pending:[] as Change[],error:'',conflict:false}),mounted=useRef(false),saving=useRef<Promise<void>|null>(null),key=useRef(''),undoStack=useRef<History[]>([]),redoStack=useRef<History[]>([]);
 const url='/api/notes/'+encodeURIComponent(note)+'/annotations';
 function publish(){if(!mounted.current)return;setSnapshot(state.current.snapshot);setPending([...state.current.pending]);setError(state.current.error);setConflict(state.current.conflict);}
 function persist(){if(!mounted.current||!key.current)return;try{if(state.current.pending.length)localStorage.setItem(key.current,JSON.stringify(state.current.pending));else localStorage.removeItem(key.current);}catch{state.current.error='Browser recovery storage is full. Keep this page open until your marks are saved.';}}
 async function refresh(){const r=await fetch(url,{cache:'no-store'}),d:any=await r.json();if(!r.ok)throw Error(d.error||'Annotations could not load.');if(d.base?.id!==base?.id)throw Error('The document preview changed. Reopen the reader.');state.current.snapshot=d;publish();return d as AnnotationSnapshot;}
 useEffect(()=>{mounted.current=true;state.current={snapshot:empty,pending:[],error:'',conflict:false};setLoaded(false);publish();undoStack.current=[];redoStack.current=[];if(!base)return()=>{mounted.current=false;};let tab=sessionStorage.getItem('ss-annotation-tab');if(!tab){tab=crypto.randomUUID();sessionStorage.setItem('ss-annotation-tab',tab);}key.current=`ss-annotations:${note}:${base.id}:${tab}`;let disposed=false;void refresh().then(()=>{if(disposed)return;try{const draft=JSON.parse(localStorage.getItem(key.current)||'[]');if(Array.isArray(draft))state.current.pending=draft;}catch{}publish();setLoaded(true);}).catch(e=>{if(!disposed){state.current.error=e.message;publish();}});const timer=setInterval(()=>{if(!state.current.pending.length&&!saving.current)void refresh().catch(()=>{});},10000);return()=>{disposed=true;mounted.current=false;clearInterval(timer);};},[note,base?.id]);
 function rendered(){const map=new Map(state.current.snapshot.annotations.map(a=>[a.id,a]));for(const change of state.current.pending){if(!change.data)map.delete(change.id);else map.set(change.id,{id:change.id,data:change.data,version:map.get(change.id)?.version||0,updated:new Date().toISOString()});}return [...map.values()];}
 function enqueue(id:string,data:AnnotationData|null,record=true){if(!loaded||!base)return;if(data){try{data=validateAnnotation(data,base.pages);}catch(e){state.current.error=(e as Error).message;publish();return;}}const before=rendered().find(a=>a.id===id)?.data||null;if(record){undoStack.current.push({id,before,after:data});redoStack.current=[];tick(v=>v+1);}state.current.pending.push({id,data,operationId:crypto.randomUUID()});state.current.error='';persist();publish();}
 async function drain(){if(saving.current)return saving.current;if(!base||!loaded||state.current.conflict||state.current.error)throw Error(state.current.error||'Wait for annotations to load.');
 const run=async()=>{while(state.current.pending.length&&mounted.current){const change=state.current.pending[0],current=state.current.snapshot.annotations.find(a=>a.id===change.id);if(change.expectedVersion===undefined)change.expectedVersion=current?.version||0;
 // A queued delete may follow an undo of an unsaved creation.
 if(!change.data&&!current&&change.expectedVersion===0){state.current.pending.shift();persist();publish();continue;}
 persist();try{const r=await fetch(url+'/'+change.id,{method:change.data?'PUT':'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseId:base.id,operationId:change.operationId,expectedVersion:change.expectedVersion,...(change.data?{data:change.data}:{})})}),d:any=await r.json();if(!r.ok){state.current.conflict=r.status===409;throw Error(d.error||'Your annotations could not save.');}state.current.snapshot={...state.current.snapshot,version:d.version,count:d.count,annotations:[...state.current.snapshot.annotations.filter(a=>a.id!==change.id),...(d.annotation?[d.annotation]:[])]};state.current.pending.shift();persist();publish();}catch(e){state.current.error=(e as Error).message;persist();publish();throw e;}}};saving.current=run().finally(()=>{saving.current=null;});return saving.current;}
 useEffect(()=>{if(!pending.length||!loaded||error||conflict)return;const timer=setTimeout(()=>void drain().catch(()=>{}),500);return()=>clearTimeout(timer);},[pending,loaded,error,conflict]);
 async function retry(){state.current.error='';publish();await drain();}
 async function resolve(keep:boolean){await refresh();if(!keep)state.current.pending=[];else state.current.pending=state.current.pending.map(c=>({...c,operationId:crypto.randomUUID(),expectedVersion:undefined}));state.current.error='';state.current.conflict=false;persist();publish();}
 function undo(){const h=undoStack.current.pop();if(h){redoStack.current.push(h);enqueue(h.id,h.before,false);tick(v=>v+1);}}
 function redo(){const h=redoStack.current.pop();if(h){undoStack.current.push(h);enqueue(h.id,h.after,false);tick(v=>v+1);}}
 async function flush(){await drain();if(state.current.pending.length)throw Error('Save pending annotations before downloading.');return state.current.snapshot;}
 void historyTick;
 return {annotations:rendered(),version:snapshot.version,count:snapshot.count,loaded,pending:pending.length,error,conflict,status:!loaded?'Loading annotations…':error?'Save failed':pending.length?'Saving annotations…':'Annotations saved',change:enqueue,undo,redo,canUndo:undoStack.current.length>0,canRedo:redoStack.current.length>0,retry,resolve,flush};
}
