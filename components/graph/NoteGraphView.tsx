'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import LayoutWorker from './layout.worker?worker';
import type {Core,Position,ElementDefinition,EventObject,StylesheetJson} from 'cytoscape';
import {Network,Search,Plus,Minus,Maximize,RotateCcw,ArrowRight,BookOpen,X,SlidersHorizontal} from 'lucide-react';
import type {Workspace,Note} from '../../lib/study';
import {buildNoteGraph,visibleGraph,visualConnections,plainPreview,isUncategorised,UNCATEGORISED} from '../../lib/note-graph';
import {type Theme,useTheme} from '../../lib/theme';
import {ForceSimulation,defaultForces,type ForceSettings} from '../../lib/graph-forces';

const palette=['#6260b5','#397d72','#a46b36','#a05777','#526f96','#7d7541'];
const shapes=['ellipse','round-rectangle','diamond','hexagon','triangle','pentagon'];
const uncategorisedStyle={name:'Uncategorised',color:'#8a94a6',shape:'octagon'};
const forceControls:{key:keyof ForceSettings;label:string;min:number;max:number;step:number}[]=[{key:'center',label:'Center force',min:0,max:1,step:.05},{key:'repel',label:'Repel force',min:0,max:20,step:.5},{key:'link',label:'Link force',min:0,max:2,step:.05},{key:'distance',label:'Link distance',min:30,max:400,step:10}];
const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
type Props={workspace:Workspace;active:boolean;focusRequest:{id:string;sequence:number};openNote:(id:string)=>void;createNote:()=>void;follow:(title:string,from:Note)=>void};
/** Cytoscape draws on canvas, so its colours follow the theme here rather than in CSS. */
function graphStyle(theme:Theme):StylesheetJson{const dark=theme==='dark';return [
     {selector:'node',style:{width:30,height:30,'background-color':'data(color)',shape:'data(shape)' as 'ellipse',label:'data(label)',color:dark?'#e4e7ee':'#253248','font-family':'Arial, sans-serif','font-size':12,'text-valign':'bottom','text-margin-y':10,'text-wrap':'ellipsis','text-max-width':'170px','text-background-color':dark?'#171a20':'#f8f9f7','text-background-opacity':.92,'text-background-padding':'3px','border-width':2,'border-color':dark?'#171a20':'#fff'}},
     {selector:'edge',style:{width:1.8,'line-color':dark?'#5c6473':'#a2a8b5','target-arrow-color':dark?'#8a93a3':'#747b8b','source-arrow-color':dark?'#8a93a3':'#747b8b','target-arrow-shape':'triangle','source-arrow-shape':'data(backArrow)' as 'none','curve-style':'bezier','arrow-scale':1.3}},
     {selector:'.dim',style:{opacity:.2}},
     {selector:'node.emphasis',style:{'border-width':3,'border-color':dark?'#a5a2f7':'#5653ce','font-weight':'bold'}},
     {selector:'edge.emphasis',style:{width:2.6,'line-color':dark?'#8f8cf0':'#6762bd','target-arrow-color':dark?'#a5a2f7':'#5653ce','source-arrow-color':dark?'#a5a2f7':'#5653ce'}},
     {selector:'node.chosen',style:{'border-width':5,'border-color':dark?'#e4e2ff':'#26215e','background-color':'#b6b1f0','font-weight':'bold'}}
 ];}
export default function NoteGraphView({workspace,active,focusRequest,openNote,createNote,follow}:Props){
 const [subject,setSubject]=useState(''),[showIsolated,setShowIsolated]=useState(true),[root,setRoot]=useState(''),[hops,setHops]=useState<1|2>(1);
 const [query,setQuery]=useState(''),[selected,setSelected]=useState(''),[hovered,setHovered]=useState(''),[view,setView]=useState<'graph'|'list'>('graph');
 const [arranging,setArranging]=useState(false);
 const [detailsOpen,setDetailsOpen]=useState(true);
 const [forces,setForces]=useState<ForceSettings>(defaultForces),[liveForces,setLiveForces]=useState(true),[forcesOpen,setForcesOpen]=useState(false);
 const theme=useTheme();
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[locate,setLocate]=useState(0),[reset,setReset]=useState(0);
 const container=useRef<HTMLDivElement>(null),cyRef=useRef<Core|null>(null),positions=useRef(new Map<string,Position>()),topology=useRef('');
 const selectedRef=useRef(selected);selectedRef.current=selected;
 const simRef=useRef<ForceSimulation|null>(null),frame=useRef(0);
 const liveRef=useRef(liveForces);liveRef.current=liveForces;const forcesRef=useRef(forces);forcesRef.current=forces;
 // Animates the simulation on the renderer; stops when it comes to rest. Reduced motion settles in one step.
 const physics=useRef({start:(alpha:number)=>{},stop:()=>{}});
 physics.current.stop=()=>{cancelAnimationFrame(frame.current);frame.current=0;};
 physics.current.start=alpha=>{
  const cy=cyRef.current,sim=simRef.current;if(!cy||!sim||!liveRef.current)return;
  sim.settings=forcesRef.current;sim.reheat(alpha);
  const apply=()=>cy.batch(()=>{for(const n of sim.nodes){const node=cy.getElementById(n.id);if(node.length&&!node.grabbed())node.position({x:n.x,y:n.y});}});
  const save=()=>{for(const n of sim.nodes)positions.current.set(n.id,{x:n.x,y:n.y});};
  if(reducedMotion()){physics.current.stop();sim.settle();apply();save();return;}
  if(frame.current)return;
  const step=()=>{if(simRef.current!==sim||cyRef.current!==cy){frame.current=0;return;}sim.tick();apply();if(sim.running)frame.current=requestAnimationFrame(step);else{frame.current=0;save();}};
  frame.current=requestAnimationFrame(step);
 };
 const selectRef=useRef((id:string)=>{});selectRef.current=id=>{setSelected(id);setHovered('');setDetailsOpen(true);};
 // Review-clock ticks and selection changes do not rebuild the graph.
 const graph=useMemo(()=>buildNoteGraph(workspace),[workspace.notes,workspace.subjects]);
 const visible=useMemo(()=>visibleGraph(graph,{subject,showIsolated,root,hops}),[graph,subject,showIsolated,root,hops]);
 const visibleIds=useMemo(()=>new Set(visible.notes.map(n=>n.id)),[visible.notes]);
 const byId=useMemo(()=>new Map(workspace.notes.map(n=>[n.id,n])),[workspace.notes]);
 const subjectStyle=useMemo(()=>new Map(workspace.subjects.map((s,i)=>[s.id,{...s,color:palette[i%palette.length],shape:shapes[i%shapes.length]}])),[workspace.subjects]);
 const styleOf=(n:Note)=>isUncategorised(graph,n)?uncategorisedStyle:subjectStyle.get(n.subject)!;
 const hasUncategorised=useMemo(()=>workspace.notes.some(n=>isUncategorised(graph,n)),[graph,workspace.notes]);
 const chosen=byId.get(selected),localRoot=byId.get(root);
 const results=useMemo(()=>query.trim()?workspace.notes.filter(n=>n.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):[],[query,workspace.notes]);
 const visualEdges=useMemo(()=>visualConnections(visible.relationships),[visible.relationships]);
 const elements=useMemo<ElementDefinition[]>(()=>[
  ...visible.notes.map(n=>({data:{id:n.id,label:n.title,color:styleOf(n).color,shape:styleOf(n).shape},position:positions.current.get(n.id)})),
  ...visualEdges.map(e=>({data:{...e,backArrow:e.reciprocal?'triangle':'none'}}))
 ],[visible.notes,visualEdges,subjectStyle,graph]);
 useEffect(()=>{if(!focusRequest.sequence)return;setRoot(focusRequest.id);setSelected(focusRequest.id);setSubject('');setShowIsolated(true);setHops(1);setQuery('');setLocate(v=>v+1);},[focusRequest]);
 useEffect(()=>{if(selected&&!byId.has(selected))setSelected('');if(root&&!byId.has(root))setRoot('');if(subject&&subject!==UNCATEGORISED&&!subjectStyle.has(subject))setSubject('');for(const id of positions.current.keys())if(!byId.has(id))positions.current.delete(id);},[byId,subjectStyle,selected,root,subject]);
 useEffect(()=>{
  let disposed=false,cy:Core|undefined,observer:ResizeObserver|undefined;
  setReady(false);setError('');
  import('cytoscape').then(({default:cytoscape})=>{
   if(disposed||!container.current)return;
   cy=cytoscape({container:container.current,elements:[],layout:{name:'preset'},minZoom:.15,maxZoom:3,wheelSensitivity:.2,selectionType:'single',boxSelectionEnabled:false,
    style:graphStyle(document.documentElement.dataset.theme==='dark'?'dark':'light')});
   cyRef.current=cy;
   cy.on('tap','node',event=>selectRef.current(event.target.id()));
   cy.on('tap',event=>{if(event.target===cy)selectRef.current('');});
   cy.on('mouseover','node',event=>setHovered(event.target.id()));
   cy.on('mouseout','node',()=>setHovered(''));
   cy.on('dragfree','node',event=>positions.current.set(event.target.id(),{...event.target.position()}));
   // While a note is held, it is pinned under the pointer and the forces pull its neighbours along.
   const hold=(event:EventObject)=>{const sim=simRef.current;if(!sim||!liveRef.current)return;const p=event.target.position();sim.pin(event.target.id(),p.x,p.y);if(!reducedMotion())physics.current.start(.3);};
   cy.on('grab','node',hold);cy.on('drag','node',hold);
   cy.on('free','node',event=>{const sim=simRef.current;if(!sim)return;const p=event.target.position(),n=sim.node(event.target.id());if(n){n.x=p.x;n.y=p.y;n.vx=n.vy=0;}sim.unpin(event.target.id());physics.current.start(.3);});
   observer=new ResizeObserver(()=>cy?.resize());observer.observe(container.current);
   topology.current='';setReady(true);
  }).catch(()=>{if(!disposed)setError('The visual graph could not load. Retry, or use the note list below.');});
  return()=>{disposed=true;physics.current.stop();simRef.current=null;observer?.disconnect();if(cy){cy.removeAllListeners();cy.destroy();}if(cyRef.current===cy)cyRef.current=null;};
 },[attempt]);
 useEffect(()=>{
  const cy=cyRef.current;if(!ready||!cy||!active||view!=='graph')return;
  let worker:Worker|undefined;
  try{
   cy.resize();
   cy.nodes().forEach(n=>{positions.current.set(n.id(),{...n.position()});});
   cy.json({elements});
   cy.nodes().forEach(n=>{const position=positions.current.get(n.id());if(position)n.position(position);});
   const key=JSON.stringify([visible.notes.map(n=>n.id),visible.relationships,reset]);
   if(key!==topology.current&&cy.nodes().length){
    setArranging(true);
    worker=new LayoutWorker();
    worker.onmessage=(event:MessageEvent<{positions?:{id:string;position:Position}[];error?:string}>)=>{
     setArranging(false);
     if(event.data.error){setError(event.data.error);worker?.terminate();return;}
     cy.batch(()=>{for(const item of event.data.positions||[]){cy.getElementById(item.id).position(item.position);positions.current.set(item.id,item.position);}});
     topology.current=key;cy.fit(undefined,55);
     buildSimulation(cy);physics.current.start(.5);
     const focus=cy.getElementById(selectedRef.current);if(focus.length){cy.zoom(Math.max(.9,Math.min(cy.zoom(),1.5)));cy.center(focus);}
     worker?.terminate();
    };
    worker.onerror=()=>{setArranging(false);setError('The layout worker could not start. Retry, or use the accessible list.');worker?.terminate();};
    worker.postMessage({elements,randomize:reset>0||visible.notes.some(n=>!positions.current.has(n.id))});
   }else{setArranging(false);buildSimulation(cy);}
   applyHighlight(cy,hovered||selected,selected);
  }catch{setArranging(false);setError('The graph layout could not be displayed. Retry the renderer or use the note list.');}
  return()=>{worker?.terminate();physics.current.stop();};
 },[ready,elements,active,view,reset]);
 useEffect(()=>{if(!simRef.current)return;simRef.current.settings=forces;if(liveForces)physics.current.start(.6);else physics.current.stop();},[forces,liveForces]);
 function buildSimulation(cy:Core){const sim=new ForceSimulation(cy.nodes().map(n=>({id:n.id(),...n.position()})),visible.relationships,forcesRef.current);sim.alpha=0;simRef.current=sim;}
 useEffect(()=>{const cy=cyRef.current;if(ready&&cy)cy.style(graphStyle(theme));},[ready,theme]);
 useEffect(()=>{const cy=cyRef.current;if(ready&&cy)applyHighlight(cy,hovered||selected,selected);},[ready,selected,hovered,elements]);
 useEffect(()=>{const cy=cyRef.current;if(!ready||!cy||!active||view!=='graph'||!locate)return;const node=cy.getElementById(selected);if(node.length){cy.zoom(Math.max(.9,Math.min(cy.zoom(),1.5)));cy.center(node);}},[ready,active,view,locate,selected,elements]);
 function pick(id:string,reveal=false){if(reveal){setSubject('');setShowIsolated(true);setRoot('');}setSelected(id);setHovered('');setDetailsOpen(true);setLocate(v=>v+1);}
 function local(id:string){setRoot(id);setSubject('');setShowIsolated(true);setSelected(id);setDetailsOpen(true);setLocate(v=>v+1);}
 function clearFilters(){setSubject('');setRoot('');setShowIsolated(true);setQuery('');}
 function neighbours(ids:string[]|undefined){return (ids||[]).map(id=>byId.get(id)).filter((n):n is Note=>!!n);}
 const incoming=neighbours(graph.incoming.get(selected)),outgoing=neighbours(graph.outgoing.get(selected));
 return <section className="note-graph-view" aria-label="Note graph">
  <div className="graph-filters">
   <label>Find a note<div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by title…" aria-label="Search graph notes"/></div></label>
   <label>Subject<select value={subject} onChange={e=>setSubject(e.target.value)}><option value="">All subjects</option>{workspace.subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}{hasUncategorised&&<option value={UNCATEGORISED}>Uncategorised</option>}</select></label>
   <label className="checkbox"><input type="checkbox" checked={showIsolated} onChange={e=>setShowIsolated(e.target.checked)}/>Show isolated notes</label>
   <div className="segmented" aria-label="Graph presentation"><button aria-pressed={view==='graph'} onClick={()=>setView('graph')}>Graph</button><button aria-pressed={view==='list'} onClick={()=>setView('list')}>Accessible list</button></div>
  </div>
  {query.trim()&&<section className="graph-search-results" aria-label="Search results"><p role="status">{results.length} matching {results.length===1?'note':'notes'}</p>{results.length?results.slice(0,100).map(n=><button key={n.id} onFocus={()=>setHovered(n.id)} onBlur={()=>setHovered('')} onClick={()=>pick(n.id,!visibleIds.has(n.id))}><span>{n.title}<small>{styleOf(n).name}</small></span><span>{visibleIds.has(n.id)?'Locate':'Reveal in global graph'} <ArrowRight size={14}/></span></button>):<p>No title matches. Try a shorter search.</p>}{results.length>100&&<p>Narrow your search to see more specific results.</p>}</section>}
  <div className="graph-status row"><div><span className="pill">{root?`Local · ${localRoot?.title||'Note unavailable'}`:'Global · all notes'}</span>{root&&<><label className="graph-hop-label">Distance<select aria-label="Local graph distance" value={hops} onChange={e=>setHops(Number(e.target.value) as 1|2)}><option value="1">One hop</option><option value="2">Two hops</option></select></label><button className="text-button" onClick={()=>setRoot('')}>Show global graph</button></>}</div><span aria-live="polite">{visible.notes.length} notes · {visible.relationships.length} directed connections</span></div>
  {subject&&<p className="small muted">Connections to hidden subjects are not displayed. Isolated means no connections within the current filters.</p>}
  <div className="graph-legend" aria-label="Subject legend">{workspace.subjects.map(s=><span key={s.id}><i style={{background:subjectStyle.get(s.id)?.color}}/>{s.name}<small>({subjectStyle.get(s.id)?.shape})</small></span>)}{hasUncategorised&&<span><i style={{background:uncategorisedStyle.color}}/>{uncategorisedStyle.name}<small>({uncategorisedStyle.shape})</small></span>}<span className="graph-arrow-key">A → B: A links to B · A ↔ B: both link explicitly</span></div>
  {!workspace.notes.length&&<div className="empty"><Network size={32}/><h2>Your ideas will meet here.</h2><p>Create a note, then connect it with [[Note Title]].</p><button className="primary" onClick={createNote}>Create note</button></div>}
  {!!workspace.notes.length&&!graph.relationships.length&&<p className="graph-guidance">Your notes have no resolved links yet. Write [[Note Title]] in a note to connect it to another existing note.</p>}
  {!!workspace.notes.length&&!visible.notes.length&&<div className="empty"><h2>No notes match these filters.</h2><p>Try another subject, include isolated notes, or return to the global view.</p><button onClick={clearFilters}>Reset filters</button></div>}
  <div className="graph-layout">
   <div className="graph-main">
    <div hidden={view!=='graph'||!workspace.notes.length||!visible.notes.length}>
     <div className="graph-tools" aria-label="Graph controls"><button disabled={!ready||arranging||!!error} onClick={()=>cyRef.current?.fit(undefined,55)}><Maximize size={15}/>Fit to view</button><button disabled={!ready||arranging||!!error} onClick={()=>{positions.current.clear();setReset(v=>v+1);}}><RotateCcw size={15}/>Reset layout</button><button aria-label="Zoom in" disabled={!ready||arranging||!!error} onClick={()=>{const cy=cyRef.current;if(cy)cy.zoom({level:Math.min(3,cy.zoom()*1.3),renderedPosition:{x:cy.width()/2,y:cy.height()/2}});}}><Plus size={16}/></button><button aria-label="Zoom out" disabled={!ready||arranging||!!error} onClick={()=>{const cy=cyRef.current;if(cy)cy.zoom({level:Math.max(.15,cy.zoom()/1.3),renderedPosition:{x:cy.width()/2,y:cy.height()/2}});}}><Minus size={16}/></button><button aria-expanded={forcesOpen} aria-controls="graph-forces" onClick={()=>setForcesOpen(v=>!v)}><SlidersHorizontal size={15}/>Forces</button></div>
     {forcesOpen&&<fieldset id="graph-forces" className="graph-forces"><legend>Forces</legend><label className="checkbox"><input type="checkbox" checked={liveForces} onChange={e=>setLiveForces(e.target.checked)}/>Live forces</label>{forceControls.map(c=><label key={c.key}><span>{c.label}<output>{forces[c.key]}</output></span><input type="range" min={c.min} max={c.max} step={c.step} value={forces[c.key]} disabled={!liveForces} onChange={e=>{const value=Number(e.target.value);setForces(f=>({...f,[c.key]:value}));}}/></label>)}<button type="button" onClick={()=>setForces(defaultForces)}>Restore defaults</button></fieldset>}
     <div className="graph-surface"><div ref={container} className="graph-canvas" role="img" aria-label="Interactive note connections. Use the accessible list for keyboard navigation."/>{(!ready||arranging)&&!error&&<div className="graph-overlay" role="status">Arranging your connections…</div>}{error&&<div className="graph-overlay" role="alert"><p>{error}</p><button onClick={()=>setAttempt(v=>v+1)}>Retry</button><button onClick={()=>setView('list')}>Use accessible list</button></div>}</div>
     <p className="graph-help">Drag a note to pull its connections along{liveForces?'':' (live forces are off)'}. Drag the background to pan. Scroll or pinch to zoom. Select a note for details.</p>
    </div>
    <section className="graph-note-list" hidden={view!=='list'} aria-label="Notes and directed connections">
     {visible.notes.map(n=><article key={n.id} className={selected===n.id?'selected':''}><button className="graph-list-title" onFocus={()=>setHovered(n.id)} onBlur={()=>setHovered('')} aria-pressed={selected===n.id} onClick={()=>pick(n.id)}>{n.title}</button><p>{styleOf(n).name}</p><div><strong>Outgoing → </strong>{neighbours(graph.outgoing.get(n.id)).length?neighbours(graph.outgoing.get(n.id)).map(other=><button key={other.id} onClick={()=>pick(other.id,!visibleIds.has(other.id))}>{other.title}{!visibleIds.has(other.id)?' (reveal)':''}</button>):<span>None</span>}</div><div><strong>Incoming ← </strong>{neighbours(graph.incoming.get(n.id)).length?neighbours(graph.incoming.get(n.id)).map(other=><button key={other.id} onClick={()=>pick(other.id,!visibleIds.has(other.id))}>{other.title}{!visibleIds.has(other.id)?' (reveal)':''}</button>):<span>None</span>}</div><div className="actions"><button onClick={()=>{setSelected(n.id);openNote(n.id);}}>Open note</button><button onClick={()=>local(n.id)}>Focus local graph</button></div></article>)}
    </section>
   </div>
   {chosen?<aside className={`graph-details ${detailsOpen?'':'collapsed'}`} aria-label="Selected note details"><div className="row"><span className="eyebrow">SELECTED NOTE</span><button className="icon" aria-label="Clear graph selection" onClick={()=>setSelected('')}><X size={18}/></button></div><h2>{chosen.title}</h2><button className="graph-details-toggle" aria-expanded={detailsOpen} onClick={()=>setDetailsOpen(v=>!v)}>{detailsOpen?'Collapse details':'Expand details'}</button><div className="graph-details-body"><span className="pill">{styleOf(chosen).name}</span><p className="graph-preview">{plainPreview(chosen.body)||'This note has no text yet.'}</p>{!visibleIds.has(chosen.id)&&<button className="full" onClick={()=>pick(chosen.id,true)}>Reveal selected note in global graph</button>}<div className="actions"><button className="primary" onClick={()=>openNote(chosen.id)}><BookOpen size={15}/>Open note</button><button onClick={()=>local(chosen.id)}>Focus local graph</button></div><h3>Outgoing links → <span className="number">{outgoing.length}</span></h3><ConnectionList notes={outgoing} visibleIds={visibleIds} pick={pick}/><h3>Incoming links / backlinks ← <span className="number">{incoming.length}</span></h3><ConnectionList notes={incoming} visibleIds={visibleIds} pick={pick}/>{!!graph.unresolved.get(chosen.id)?.length&&<><h3>Unresolved links</h3>{graph.unresolved.get(chosen.id)!.map(link=><button className="graph-unresolved" key={link.title} onClick={()=>follow(link.title,chosen)}>{link.title}<small>{link.ambiguous?'Choose intended note':'Create note'}</small></button>)}</>}</div></aside>:<aside className="graph-details graph-details-empty"><Network size={28}/><h2>Follow a connection.</h2><p>Select a node or a note in the accessible list to see its source links and backlinks.</p></aside>}
  </div>
 </section>;
}
function applyHighlight(cy:Core,id:string,selected:string){
 cy.batch(()=>{cy.elements().removeClass('dim emphasis chosen');const node=cy.getElementById(id);if(node.length){cy.elements().addClass('dim');node.closedNeighborhood().removeClass('dim').addClass('emphasis');}cy.getElementById(selected).addClass('chosen');});
}
function ConnectionList({notes,visibleIds,pick}:{notes:Note[];visibleIds:Set<string>;pick:(id:string,reveal?:boolean)=>void}){return notes.length?<ul className="graph-connections">{notes.map(n=><li key={n.id}><button onClick={()=>pick(n.id,!visibleIds.has(n.id))}>{n.title}{!visibleIds.has(n.id)&&<small>Reveal hidden note</small>}</button></li>)}</ul>:<p className="small muted">No connections in this direction.</p>;}
