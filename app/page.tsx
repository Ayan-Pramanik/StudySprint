'use client';
import { useState, useEffect, useRef, lazy, Suspense, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {GraphBoundary} from '../components/graph/GraphBoundary';
import { mermaidComponents } from '../components/MermaidDiagram';
import { NoteTree } from '../components/NoteTree';
import { Adventure } from '../components/Adventure';
import { ConceptGraphModal } from '../components/ConceptGraphModal';
import { AutoCardGenerator } from '../components/AutoCardGenerator';
import { type AutoCard } from '../lib/auto-cards';
import { buildConceptGraph, type ConceptGraph } from '../lib/concept-graph';
import { FocusProgress, FocusTimer, PomodoroChip, PomodoroGuard } from '../components/Pomodoro';
import { BookOpen, Layers, Sun, ChartNoAxesCombined, Plus, ArrowUpRight, ArrowRight, Network, Search, ChevronRight, Check, Clock, Link2, Sparkles, X, MoreHorizontal, Leaf, Download, Upload, Settings as SettingsIcon, Moon, Monitor, Timer } from 'lucide-react';
import { type ThemePreference, setThemePreference, useThemePreference } from '../lib/theme';
import { type Workspace, type Note, type Card, queue, day, changed, links, matches, resolveLink, preview, uid } from '../lib/study';
import { type MarkdownFile, noteToMarkdown, notesToFiles, parseMarkdownNote, safeFileName, unzipMarkdown, zip } from '../lib/markdown-notes';
import { UNCATEGORISED } from '../lib/note-graph';
// Subject filter match; UNCATEGORISED selects items with no (or a deleted) subject.
const inSubject=(w:Workspace,item:{subject:string},subject:string)=>!subject||(subject===UNCATEGORISED?!item.subject||!w.subjects.some(s=>s.id===item.subject):item.subject===subject);
function download(name:string,content:BlobPart,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportWorkspace(w:Workspace){download('studysprint-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({format:'studysprint',version:1,exportedAt:new Date().toISOString(),workspace:w},null,2));}
function exportNotes(w:Workspace,subject=''){const notes=w.notes.filter(n=>inSubject(w,n,subject));const name=subject?safeFileName(w.subjects.find(s=>s.id===subject)?.name||(subject===UNCATEGORISED?'Uncategorised':'notes')):'studysprint-notes';download(name+'-'+new Date().toISOString().slice(0,10)+'.zip',zip(notesToFiles(w,notes)) as BlobPart,'application/zip');}
const NoteGraphView=lazy(()=>import('../components/graph/NoteGraphView'));
const labels = ['Again', 'Hard', 'Good', 'Easy'];
const date = (v: string) => new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function interval(v: Date | string) { const m = Math.max(1, Math.round((+new Date(v) - Date.now()) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} hr` : `${Math.round(m / 1440)} days`; }
export default function App() {
    const [w, setW] = useState<Workspace>();
    const [tab, setTab] = useState('Today');
    const [graphVisited,setGraphVisited]=useState(false);
    const [graphFocus,setGraphFocus]=useState({id:'',sequence:0});
    function openGraph(id?:string){setGraphVisited(true);if(id)setGraphFocus(f=>({id,sequence:f.sequence+1}));setTab('Graph');}
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const [ai, setAi] = useState(false);
    const [selected, setSelected] = useState('');
    const [subject, setSubject] = useState('');
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [sourceFilter, setSourceFilter] = useState('');
    const [modal, setModal] = useState<ReactNode>();
    const [editCard, setEditCard] = useState<Card | undefined>();
    const [source, setSource] = useState<Card>();
    const [autoCardOpen, setAutoCardOpen] = useState(false);
    const [revealed, setRevealed] = useState(false);
    const [session, setSession] = useState<string[]>([]);
    const [finished,setFinished]=useState(false);
    const [reviewSubject, setReviewSubject] = useState('');
    const [reviewCardId, setReviewCardId] = useState('');
    const [eventId, setEventId] = useState(uid);
    const [tick, setTick] = useState(0);
    const [notice, setNotice] = useState('');
    useEffect(() => { fetch('/api/workspace?zone=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)).then(r => r.json()).then((d: any) => { if (d.error)
        throw Error(d.error); setW(d.workspace); setAi(d.ai); }).catch(e => setError(e.message)); const timer = setInterval(() => setTick(t => t + 1), 15000); return () => clearInterval(timer); }, []);
    async function mutate(action: string, data: any = {}) { if (lock.current)
        throw Error('Please wait for the current save.'); lock.current = true; setBusy(true); setError(''); try {
        const r = await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }) });
        const d: any = await r.json();
        if (!r.ok)
            throw Error(d.error);
        setW(d.workspace);
        return d.workspace as Workspace;
    }
    catch (e) {
        setError((e as Error).message);
        throw e;
    }
    finally {
        lock.current = false;
        setBusy(false);
    } }
    async function createAutoCardDrafts(sourceNote: Note, cards: AutoCard[]) {
        await mutate('createDrafts', { noteId: sourceNote.id, cards: cards.map(({ front, answer, type, excerpt }) => ({ front, answer, type, excerpt })) });
        setAutoCardOpen(false);
        setFilter('draft');
        setSourceFilter(sourceNote.id);
        setSearch('');
        setNotice(`${cards.length} editable ${cards.length === 1 ? 'draft' : 'drafts'} created from “${sourceNote.title}”.`);
        setTab('Cards');
    }
    async function saveConceptGraph(sourceId:string, graph:ConceptGraph){
        if(!w)throw Error('Your workspace is still loading.');
        const source=w.notes.find(item=>item.id===sourceId);
        if(!source)throw Error('Source note unavailable.');
        if(!graph.concepts.length)throw Error('There are not enough key ideas in this note yet.');
        const sourceTitle=source.title.trim();
        const wiki=(value:string)=>`[[${value.replace(/[\[\]]/g,'').trim()}]]`;
        const conceptTitles=new Map(graph.concepts.map(concept=>[concept.id,concept.label.trim()]));
        const subjectName=w.subjects.find(item=>item.id===source.subject)?.name;
        const notes=graph.concepts.map(concept=>{
            if(!conceptTitles.get(concept.id))throw Error('Each concept needs a name before it can be added.');
            const related=graph.edges.filter(edge=>edge.source===concept.id).map(edge=>`${wiki(conceptTitles.get(edge.target)||edge.target)} (${Math.round(edge.similarity*100)}% similar)`);
            const evidence=concept.evidence.replace(/[\r\n]+/g,' ').trim();
            return {title:conceptTitles.get(concept.id)!,subject:subjectName,body:[`Extracted from ${wiki(sourceTitle)}.`,`StudySprint concept graph node: similarity=${Math.round(concept.similarity*100)}%; layer=${concept.level}.`,`Supporting passage:\n> ${evidence||'This concept appears in the source note.'}`,related.length?`Related concepts: ${related.join(', ')}.`:''].filter(Boolean).join('\n\n')};
        });
        const legacyConcepts=w.notes.filter(item=>item.body.includes(`Extracted from [[${sourceTitle}]]`)&&/ · [a-f0-9]{6}$/i.test(item.title));
        let updated:Workspace=w;
        for(const legacy of legacyConcepts){
            const cleanTitle=legacy.title.replace(/ · [a-f0-9]{6}$/i,'').trim();
            const current=updated.notes.find(item=>item.id===legacy.id);
            if(current&&cleanTitle&&cleanTitle!==legacy.title)updated=await mutate('note',{id:current.id,title:cleanTitle,body:current.body.replace(/ · [a-f0-9]{6}(?=\]\])/gi,''),subject:current.subject,expectedUpdated:current.updated});
        }
        for(const item of notes){
            const current=updated.notes.find(existing=>existing.title===item.title&&existing.body.includes(`Extracted from [[${sourceTitle}]]`));
            if(current)updated=await mutate('note',{id:current.id,title:item.title,body:item.body,subject:current.subject,expectedUpdated:current.updated});
            else updated=await mutate('importNotes',{notes:[item],subject:source.subject||undefined});
        }
        openGraph(source.id);
    }
    async function generateConceptsFromNote(id:string){
        const source=w?.notes.find(item=>item.id===id);
        if(!source)throw Error('Source note unavailable.');
        await saveConceptGraph(id,buildConceptGraph(`${source.title}\n\n${source.body}`));
    }
    function act(action: string, data: any = {}) { void mutate(action, data).catch(() => { }); }
    const note = w?.notes.find(n => n.id === selected);
    const pending = w ? queue(w, new Date(), reviewSubject) : [];
    const current = reviewCardId ? w?.cards.find(c => c.id === reviewCardId && c.life === 'active') : pending[0];
    useEffect(() => { if (tab !== 'Review')
        return; if (!reviewCardId && current)
        setReviewCardId(current.id);
    else if (reviewCardId && !current)
        setReviewCardId(''); }, [tab, reviewCardId, current?.id]);
    async function rating(r: number) { if (!current || !revealed || lock.current || finished)
        return; try {
        const id = current.id;
        const next = await mutate('rate', { id, rating: r, eventId });
        setSession(s => [...s, eventId]);
        setEventId(uid());
        setReviewCardId('');
        setRevealed(false);
        setSource(undefined);
        const c = next.cards.find(c => c.id === id);
        setNotice(`${labels[r - 1]} saved · Next review ${date(c!.schedule.due)}`);
    }
    catch { } }
    useEffect(() => { function key(e: KeyboardEvent) { if (tab !== 'Review' || finished || e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target as HTMLElement)?.isContentEditable || modal || editCard || source || autoCardOpen)
        return; if (e.code === 'Space') {
        e.preventDefault();
        setRevealed(true);
    } if (revealed && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        void rating(Number(e.key));
    } } window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); });
    useEffect(() => { if (!modal && !editCard && !source && !autoCardOpen)
        return; const previous = document.activeElement as HTMLElement; const dialogs = document.querySelectorAll<HTMLElement>('[role=dialog]'); const dialog = dialogs[dialogs.length - 1]; const selector = 'button:not([disabled]),input,textarea,select,a[href],[tabindex="0"]'; (dialog?.querySelector(selector) as HTMLElement)?.focus(); function trap(e: KeyboardEvent) { if (e.key === 'Escape') {
        setModal(undefined);
        setEditCard(undefined);
        setSource(undefined);
        setAutoCardOpen(false);
    } if (e.key !== 'Tab' || !dialog)
        return; const items = Array.from(dialog.querySelectorAll<HTMLElement>(selector)); if (!items.length)
        return; const first = items[0], last = items[items.length - 1]; if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    }
    else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    } } document.addEventListener('keydown', trap); return () => { document.removeEventListener('keydown', trap); previous?.focus(); }; }, [modal, editCard, source, autoCardOpen]);
    function openNote(id: string) { setSelected(id); setTab('Notes'); setSource(undefined); }
    function start(s = '') { setFinished(false); setReviewCardId(''); setReviewSubject(s); setSession([]); setRevealed(false); setEventId(uid()); setNotice(''); setTab('Review'); }
    function moveNote(note: Note, subjectId: string) { const count = w!.cards.filter(c => c.note === note.id).length; void mutate('moveNote', { id: note.id, subject: subjectId }).then(() => setNotice(`Moved “${note.title}”${count ? ` and ${count === 1 ? '1 flashcard' : `${count} flashcards`}` : ''} to ${subjectId ? subjectName(subjectId) : 'no folder'}.`)).catch(() => { }); }
    function confirmDeleteNote(note: Note) { const count = w!.cards.filter(c => c.note === note.id).length; if (!count) return confirmAction('Delete this note?', 'It has no flashcards. Existing links to it will become unresolved.', () => act('deleteNote', { id: note.id }));
        const cards = count === 1 ? '1 flashcard' : `${count} flashcards`;
        setModal(<div><h2>Delete this note?</h2><p>“{note.title}” has {cards}. You can keep them, with their saved source excerpts, or delete them with the note. Review history is kept either way. Existing links to the note will become unresolved.</p><div className="actions"><button onClick={() => setModal(undefined)}>Cancel</button><button onClick={() => { setModal(undefined); act('deleteNote', { id: note.id }); }}>Delete note, keep cards</button><button className="danger" onClick={() => { setModal(undefined); act('deleteNote', { id: note.id, cards: true }); }}>Delete note and {cards}</button></div></div>); }
    function confirmAction(title: string, description: string, action: () => void) { setModal(<div><h2>{title}</h2><p>{description}</p><div className="actions"><button onClick={() => setModal(undefined)}>Cancel</button><button className="danger" onClick={() => { setModal(undefined); action(); }}>Confirm</button></div></div>); }
    function subjectForm(s?: {
        id: string;
        name: string;
    }) { setModal(<form onSubmit={e => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name'); void mutate('subject', { id: s?.id, name }).then(() => setModal(undefined)).catch(() => { }); }}><h2>{s ? 'Rename subject' : 'A space for your subject'}</h2><label>Subject name<input name="name" defaultValue={s?.name} required maxLength={100} autoFocus placeholder="e.g. Computer Networking"/></label><button className="primary">Save subject</button></form>); }
    function newNote(title = '',preferredSubject='') { if (!w) return; setModal(<form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void mutate('note', { title: f.get('title'), subject: f.get('subject'), newSubject:f.get('newSubject'), body: '' }).then(n => { setModal(undefined); openNote(n.notes.at(-1)!.id); }).catch(() => { }); }}><h2>Make room for an idea.</h2><label>Note title<input name="title" defaultValue={title} required autoFocus maxLength={200}/></label>{w.subjects.length ? <label>Subject<select name="subject" defaultValue={preferredSubject || (subject === UNCATEGORISED ? '' : subject) || w.subjects[0].id}>{w.subjects.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}<option value="">Uncategorised</option></select></label> : <label>Subject name (optional)<input name="newSubject" placeholder="Leave blank to keep it uncategorised" maxLength={100}/></label>}<button className="primary">Create note</button></form>); }
    function follow(title: string, from: Note) { const found = resolveLink(w!, title, from); if (found.length === 1)
        openNote(found[0].id);
    else if (!found.length)
        confirmAction('This note is waiting to be written.', `Create “${title}” and connect your ideas.`, () => newNote(title,from.subject));
    else
        setModal(<><h2>Choose a note</h2>{found.map(n => <button key={n.id} className="note-row" onClick={() => { void mutate('link', { id: from.id, title, target: n.id }).then(() => { setModal(undefined); openNote(n.id); }).catch(() => { }); }}>{n.title}<small>{w?.subjects.find(s => s.id === n.subject)?.name}</small></button>)}</>); }
    function importNotes() { if (!w) return; setModal(<DocumentImport w={w} busy={busy} preferredSubject={subject} mutate={mutate} done={message => { setModal(undefined); setNotice(message); setTab('Notes'); }}/>); }
    function manual(n?: Note) { setEditCard({ id: '', subject: n?.subject || '', note: n?.id, front: '', answer: '', excerpt: n?.body || '', sourceVersion: n?.version || 0, checked: true, life: 'active', schedule: {}, type: 'basic' }); }
    if (!w)
        return <div className="loading"><div className="brandmark"><Layers /></div><h1>StudySprint</h1><p>{error || 'Opening your workspace…'}</p>{error && <button onClick={() => location.reload()}>Try again</button>}</div>;
    const today = w.events.filter(e => day(e.at, w.zone) === day(new Date(), w.zone));
    const due = w.cards.filter(c => c.life === 'active' && c.schedule.state !== 0 && +new Date(c.schedule.due) <= Date.now());
    const fresh = w.cards.filter(c => c.life === 'active' && c.schedule.state === 0);
    const later = w.cards.filter(c => c.life === 'active' && c.schedule.state !== 0 && +new Date(c.schedule.due) > Date.now()).sort((a, b) => +new Date(a.schedule.due) - +new Date(b.schedule.due));
    const drafts = w.cards.filter(c => c.life === 'draft');
    const difficult = w.cards.filter(c => w.events.filter(e => e.card === c.id && e.rating === 1).length >= 3);
    const sessionEvents = w.events.filter(e => session.includes(e.id));
    const subjectName = (id: string) => w.subjects.find(s => s.id === id)?.name || 'Uncategorised';
    const hasUncategorised = w.notes.some(n => inSubject(w, n, UNCATEGORISED));
    return <div className="app-shell"><PomodoroGuard/>
 <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('Today'); }}><span className="brandmark"><Layers size={21}/></span>StudySprint<span className="brand-dot">.</span></a><div className="workspace-label">YOUR WORKSPACE</div><nav>{[[Sun, 'Today'], [Sparkles, 'Adventure'], [Timer, 'Focus'], [BookOpen, 'Notes'], [Network,'Graph'], [Layers, 'Cards'], [ChartNoAxesCombined, 'Progress'], [SettingsIcon,'Settings']].map(([Icon, name]: any) => <button key={name} className={tab === name ? 'nav active' : 'nav'} onClick={() => {setSearch('');if(name==='Graph')openGraph();else setTab(name);}}><Icon size={19}/>{name}{name === 'Cards' && drafts.length > 0 && <span className="nav-count">{drafts.length}</span>}</button>)}</nav><button className="primary create" onClick={() => newNote()}><Plus size={17}/>Create note</button><div className="sidebar-divider"/><div className="workspace-label row">SUBJECTS<button className="icon" aria-label="Create subject" onClick={() => subjectForm()}><Plus size={16}/></button></div>{w.subjects.map(s => <div className="subject-nav" key={s.id}><button onClick={() => { setSubject(s.id); setTab('Notes'); setSelected(w.notes.find(n => n.subject === s.id)?.id || ''); }}><span className="dot"/>{s.name}</button><button className="icon" aria-label={`Manage ${s.name}`} onClick={() => setModal(<><h2>{s.name}</h2><div className="actions"><button onClick={() => subjectForm(s)}>Rename</button><button className="danger" onClick={() => confirmAction('Delete subject?', 'Its notes will be kept as uncategorised. Cards, saved excerpts, and review history will be preserved.', () => act('deleteSubject', { id: s.id }))}>Delete subject</button></div></>)}><MoreHorizontal size={16}/></button></div>)}{hasUncategorised && <div className="subject-nav"><button onClick={() => { setSubject(UNCATEGORISED); setTab('Notes'); setSelected(w.notes.find(n => inSubject(w, n, UNCATEGORISED))?.id || ''); }}><span className="dot"/>Uncategorised</button></div>}<div className="sidebar-bottom"><div className="quiet-card"><Leaf size={19}/><strong>A little, often.</strong><p>Make space for what matters.<br />Your next session can be small.</p></div><button className="profile" onClick={()=>setTab('Settings')}><span className="avatar">S</span><span>My workspace<small>Guest · saved to this browser</small></span></button></div></aside>
 <div className="main-wrap"><header className="topbar"><div><span className="muted">My workspace</span><ChevronRight size={14}/><span>{tab}</span></div><div><span className="top-note"><span className="green-dot"/>Ready when you are</span><PomodoroChip open={() => setTab('Focus')}/><ThemeToggle/></div></header>
 {error && <div role="alert" className="error">{error}<button className="icon" onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
 {notice && <div role="status" className="notice">{notice}<button className="icon" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={16}/></button></div>}
 <main>
 {graphVisited&&<div hidden={tab!=='Graph'}><GraphBoundary><Suspense fallback={<div className="empty" role="status">Loading your note graph…</div>}><NoteGraphView workspace={w} active={tab==='Graph'} focusRequest={graphFocus} openNote={openNote} createNote={()=>newNote()} follow={follow}/></Suspense></GraphBoundary></div>}
 {tab === 'Adventure' && <Adventure w={w} busy={busy} mutate={mutate}/>}
 {tab === 'Today' && <><div className="page-heading"><div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</div><h1>A little progress, every day<span className="indigo">.</span></h1><p>Connect your notes. Remember what matters.</p></div>
 <section className="hero"><div><span className="pill mint"><span className="green-dot"/> YOUR NEXT STUDY SPRINT</span><h2>{due.length ? 'Good things come from coming back.' : 'Your next idea starts here.'}</h2><p>{w.notes.length ? `You have ${due.length} cards ready to revisit. Take a breath, find your focus, and see what you remember.` : 'A home for your notes, and a thoughtful way to remember them. Start with one idea and build connections as you learn.'}</p><div className="actions">{(w.notes.length || w.cards.some(c=>c.life==='active')) ? <button className="primary" onClick={() => start()}>Start review <ArrowRight size={18}/></button> : <><button className="primary" onClick={() => newNote()}>Create your first note <ArrowRight size={18}/></button><button onClick={() => manual()}>Create a card</button></>}{w.notes.length > 0 && <span className="hero-caption">One card at a time. At your own pace.</span>}</div></div><div className="card-art" aria-hidden="true"><div className="art-back"/><div className="art-front"><div className="art-mini"><Network size={19}/><span>SMALL CONNECTIONS</span></div><div className="art-lines"><i /><i /></div><div className="art-line"/><div className="art-bottom"><span>Lasting knowledge.</span><span className="check-bubble"><Check size={20}/></span></div></div><span className="art-spark">✧</span></div></section>
 <div className="stats"><Stat icon={<Clock />} label="Due now" value={due.length} detail="Ready to revisit"/><Stat icon={<Layers />} label="New cards" value={fresh.length} detail={`${w.limit} daily introduction limit`}/><Stat icon={<Check />} label="Reviewed today" value={today.length} detail="Every recall is practice"/><Stat icon={<BookOpen />} label="Scheduled later" value={later.length} detail={later[0] ? `Next: ${date(later[0].schedule.due)}` : "Nothing scheduled yet"}/></div>
 <div className="dashboard-grid"><section><div className="section-heading"><h2>Your subjects <span className="number">{w.subjects.length}</span></h2><button className="text-button" onClick={() => subjectForm()}><Plus size={15}/>Add subject</button></div>{!w.subjects.length ? <div className="empty compact"><Network /><h3>Give your ideas a home.</h3><p>Subjects keep related notes and cards together.</p></div> : w.subjects.map(s => <div className="subject-card" key={s.id}><div className="subject-icon"><Network size={24}/></div><div className="grow"><h3>{s.name}</h3><p>{w.notes.filter(n => n.subject === s.id).length} notes <span>·</span> {w.cards.filter(c => c.subject === s.id && c.life === 'active').length} cards </p><div className="subject-status"><span className="dot"/>{due.filter(c => c.subject === s.id).length} due now <span className="muted">· {fresh.filter(c => c.subject === s.id).length} new</span></div></div><button className="round-button" aria-label={`Review ${s.name}`} onClick={() => start(s.id)}><ArrowUpRight size={20}/></button></div>)}<div className="tip"><Link2 size={20}/><div><strong>Better together.</strong><p>Link your ideas with [[Note Title]]. Every connection gives your knowledge a little more context.</p></div></div></section><section><div className="section-heading"><h2>Pick up where you left off</h2><button className="text-button" onClick={() => setTab('Notes')}>All notes <ArrowRight size={15}/></button></div><div className="recent-list">{[...w.notes].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 4).map(n => <button className="recent-row" key={n.id} onClick={() => openNote(n.id)}><div className="note-icon"><BookOpen size={18}/></div><div><strong>{n.title}</strong><small>{subjectName(n.subject)}</small></div><ChevronRight size={16}/></button>)}{!w.notes.length && <p className="empty">Your recent notes will appear here.</p>}</div><div className="draft-callout"><span className="soft-icon"><Sparkles size={20}/></span><div><h3>A second look, then a first review.</h3><p>{drafts.length} drafts waiting for your approval.</p><button className="text-button" onClick={() => { setFilter('draft'); setTab('Cards'); }}>Review drafts <ArrowRight size={15}/></button></div></div></section></div><footer><span><Leaf size={14}/> Built for understanding, not just memorising.</span><button className="text-button" onClick={()=>exportWorkspace(w)}>Export workspace</button></footer></>}
 {tab === 'Notes' && <><div className="page-heading row"><div><div className="eyebrow">MAKE CONNECTIONS</div><h1>Your notes<span className="indigo">.</span></h1><p>A place to think things through.</p></div><div className="actions heading-actions"><button onClick={importNotes}><Upload size={16}/>Import files</button><button disabled={!w.notes.some(n=>inSubject(w,n,subject))} onClick={()=>exportNotes(w,subject)}><Download size={16}/>{subject?'Export subject':'Export all'} (.zip)</button><button className="primary" onClick={() => newNote()}><Plus size={17}/>Create note</button></div></div><div className="notes-layout"><NoteTree w={w} selected={selected} folder={subject} search={search} onSearch={setSearch} onSelect={n => setSelected(n.id)} onFolder={id => setSubject(current => current === id ? '' : id)} onNewNote={id => newNote('', id)} onNewFolder={() => subjectForm()} onMove={moveNote}/>{note ? <NoteEditor key={note.id} note={note} w={w} ai={ai} busy={busy} mutate={mutate} follow={follow} manual={manual} edit={setEditCard} localGraph={()=>openGraph(note.id)} importConceptGraph={saveConceptGraph} remove={() => confirmDeleteNote(note)}/> : <section className="empty"><BookOpen size={36}/><h2>Follow a thought.</h2><p>Choose a note, or start a new one.</p><button onClick={() => newNote()}>Create note</button></section>}</div></>}
 {tab === 'Cards' && <><div className="page-heading row"><div><div className="eyebrow">KNOWLEDGE, IN PRACTICE</div><h1>Your card library<span className="indigo">.</span></h1><p>Small questions. Stronger connections.</p></div><div className="actions"><button onClick={() => setAutoCardOpen(true)} disabled={!w.notes.length}><Sparkles size={16}/>Generate cards</button><button className="primary" onClick={() => manual()}><Plus size={17}/>Create card</button></div></div><div className="filters"><label className="search"><Search size={17}/><input aria-label="Search cards" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your cards…"/></label><select aria-label="Card state" value={filter} onChange={e => setFilter(e.target.value)}>{['all', 'draft', 'new', 'learning', 'review', 'suspended', 'archived', 'source changed', 'difficult'].map(s => <option key={s}>{s}</option>)}</select><select aria-label="Subject filter" value={subject} onChange={e => setSubject(e.target.value)}><option value="">All subjects</option>{w.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value={UNCATEGORISED}>Uncategorised</option></select><select aria-label="Source note filter" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}><option value="">All sources</option>{w.notes.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</select></div><div className="card-list">{w.cards.filter(c => inSubject(w, c, subject) && (!sourceFilter || c.note === sourceFilter) && `${c.front} ${c.answer}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || filter === c.life || filter === 'source changed' && changed(c, w) || filter === 'difficult' && difficult.includes(c) || c.life === 'active' && ({ new: c.schedule.state === 0, learning: c.schedule.state === 1 || c.schedule.state === 3, review: c.schedule.state === 2 } as any)[filter])).map(c => <article className="library-card" key={c.id}><div className="row"><span className={`pill ${c.life === 'draft' ? 'amber' : ''}`}>{c.life === 'active' ? ['New', 'Learning', 'Review', 'Relearning'][c.schedule.state] : c.life}</span><span className="muted small">{c.type}</span></div><h3>{c.front}</h3><p>{c.answer}</p><button className="source-link" onClick={() => setSource(c)}><Link2 size={14}/>{w.notes.find(n => n.id === c.note)?.title || (c.note ? 'Source unavailable' : 'No source linked')}</button>{changed(c, w) && <button className="source-warning" onClick={() => setSource(c)}>Note changed — check this card</button>}{c.life === 'active' && c.schedule.state !== 0 && <small className="due-label">Next review {date(c.schedule.due)}</small>}<div className="card-actions"><button onClick={() => setEditCard(c)}>Edit</button>{c.life === 'draft' ? <><button className="primary" disabled={busy} onClick={() => act('lifecycle', { id: c.id, life: 'active' })}>Approve</button><button onClick={() => act('lifecycle', { id: c.id, life: 'archived' })}>Reject</button></> : <button disabled={busy} onClick={() => act('lifecycle', { id: c.id, life: c.life === 'active' ? 'suspended' : 'active' })}>{c.life === 'active' ? 'Suspend' : 'Resume'}</button>}<button onClick={() => act('lifecycle', { id: c.id, life: 'archived' })}>Archive</button><button className="text-button danger-text" onClick={() => confirmAction('Delete card?', 'Its review events will remain in your progress history.', () => act('deleteCard', { id: c.id }))}>Delete</button></div></article>)}</div>{!w.cards.length && <div className="empty"><Layers size={36}/><h2>Turn an idea into a question.</h2><p>Create a card manually, or generate drafts from a note.</p></div>}</>}
 {tab === 'Review' && <div className="review-wrap"><div className="row"><button className="text-button" onClick={() => setTab('Today')}>← Back to Today</button><span className="muted">{session.length} attempts this session · {pending.length} available</span>{!finished&&<button className="text-button" onClick={()=>{setFinished(true);setRevealed(false);}}>Finish session</button>}</div>{current && !finished ? <><div className="review-top"><span className="pill">{subjectName(current.subject)}</span><span>{current.schedule.state === 0 ? 'NEW CARD' : 'RECALL PRACTICE'}</span></div><article className="review-card"><span className="eyebrow">{current.type === 'cloze' ? 'FILL IN THE GAP' : 'TAKE A MOMENT TO RECALL'}</span><h1>{current.front}</h1>{revealed ? <div className="answer"><span className="eyebrow">THE ANSWER</span><p>{current.answer}</p></div> : <button className="primary" onClick={() => setRevealed(true)}>Show answer <kbd>Space</kbd></button>}<button className="source-link" onClick={() => { setSource(current); if (!revealed)
        setNotice('Source opened as a hint. Rate honestly when you reveal the answer.'); }}><BookOpen size={16}/>View source</button></article>{revealed && <><div className="ratings">{labels.map((l, i) => <button className={`rating r${i}`} key={l} disabled={busy} onClick={() => void rating(i + 1)}><span><kbd>{i + 1}</kbd>{l}</span><small>{interval((preview(current) as any)[i + 1].card.due)}</small></button>)}</div><p className="review-hint">Forgotten or incorrect? Choose Again. Hard means correct with difficulty.</p></>}</> : <section className="completion"><span className="completion-icon"><Check size={30}/></span><h1>A good place to pause.</h1><p>{finished?'Session finished. Every review is saved.':'Nothing else is available right now. Your progress is saved.'}</p><div className="stats"><Stat label="Review attempts" value={sessionEvents.length}/><Stat label="Unique cards" value={new Set(sessionEvents.map(e => e.card)).size}/></div><div className="rating-summary">{labels.map((l, i) => <span key={l}><strong>{sessionEvents.filter(e => e.rating === i + 1).length}</strong>{l}</span>)}</div><p>{due.length} cards due across all subjects. {later[0] ? `Next review: ${date(later[0].schedule.due)}.` : 'Add a note or approve a draft to keep exploring.'}</p>{difficult.length > 0 && <button onClick={() => { setFilter('difficult'); setTab('Cards'); }}>Inspect {difficult.length} difficult cards</button>}<button className="primary" onClick={() => setTab('Today')}>Back to Today</button></section>}</div>}
 {tab === 'Focus' && <FocusTimer/>}
 {tab === 'Settings' && <Settings w={w} ai={ai} busy={busy} mutate={mutate} importNotes={importNotes}/>}
 {tab === 'Progress' && <><div className="page-heading"><div className="eyebrow">THE BIGGER PICTURE</div><h1>Showing up adds up<span className="indigo">.</span></h1><p>A record of your practice. No streaks to protect.</p></div><div className="stats"><Stat label="Review attempts" value={w.events.length} detail="Saved recall ratings"/><Stat label="Cards introduced" value={new Set(w.events.filter(e => e.introduced).map(e => e.card)).size}/><Stat label="Reviewed today" value={today.length}/><Stat label="Scheduled for later" value={later.length}/></div><FocusProgress open={() => setTab('Focus')}/><div className="dashboard-grid"><section className="panel"><h2>Practice over the last 7 days</h2><div className="bars">{Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); const count = w.events.filter(e => day(e.at, w.zone) === day(d, w.zone)).length; return <div key={i}><span>{count}</span><div className="bar" style={{ height: `${Math.max(3, Math.min(150, count * 15))}px` }}/><small>{d.toLocaleDateString(undefined, { weekday: 'short' })}</small></div>; })}</div></section><section className="panel"><h2>Self-reported recall</h2><p>From your last 100 review attempts.</p>{labels.map((l, i) => <div className="distribution" key={l}><span>{l}</span><progress max={Math.max(1, w.events.slice(-100).length)} value={w.events.slice(-100).filter(e => e.rating === i + 1).length}/><strong>{w.events.slice(-100).filter(e => e.rating === i + 1).length}</strong></div>)}</section></div><section className="panel"><h2>Due by subject</h2>{w.subjects.map(s => <div className="history-row" key={s.id}><span>{s.name}</span><strong>{due.filter(c => c.subject === s.id).length} due</strong></div>)}</section><section className="panel"><h2>Recent review history</h2>{w.events.length === 0 ? <p>Your first review will appear here. Every count comes from your saved review attempts.</p> : [...w.events].reverse().slice(0, 20).map(e => <div className="history-row" key={e.id}><div><strong>{w.cards.find(c => c.id === e.card)?.front || 'Deleted card'}</strong><small>{date(e.at)} · Next review {date(e.due)}</small></div><span className="pill">{labels[e.rating - 1]}</span></div>)}</section><p className="muted small">Difficult cards have 3 or more saved Again ratings. These metrics describe practice, not mastery.</p></>}
 </main></div>
 {modal && <div className="overlay" onClick={() => setModal(undefined)}><div role="dialog" aria-modal="true" aria-label="Workspace action" className="modal" onClick={e => e.stopPropagation()}><button className="close icon" aria-label="Close dialog" onClick={() => setModal(undefined)}><X /></button>{error && <p role="alert" className="danger-text">{error}</p>}{modal}</div></div>}
 {autoCardOpen && <AutoCardGenerator workspace={w} onClose={() => setAutoCardOpen(false)} onCreate={createAutoCardDrafts}/>}
 {editCard && <div className="overlay"><div role="dialog" aria-modal="true" aria-label="Edit flashcard" className="modal"><button className="close icon" aria-label="Close card editor" onClick={() => setEditCard(undefined)}><X /></button><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void mutate('card', { id: editCard.id || undefined, front: f.get('front'), answer: f.get('answer'), type: f.get('type'), note: f.get('note'), subject:f.get('subject'), excerpt: editCard.excerpt, reset: f.get('reset') === 'on' }).then(() => setEditCard(undefined)).catch(() => { }); }}><h2>{editCard.id ? 'Refine this card' : 'One idea, one card.'}</h2>{error && <p role="alert" className="danger-text">{error}</p>}<label>Type<select name="type" defaultValue={editCard.type}><option value="basic">Basic · question and answer</option><option value="cloze">Cloze · use one [...] gap</option></select></label><label>Prompt<textarea name="front" required defaultValue={editCard.front}/></label><label>Answer<textarea name="answer" required defaultValue={editCard.answer}/></label>{!editCard.id && <label>Subject<select name="subject" defaultValue={editCard.subject}><option value="">Uncategorised</option>{w.subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}{!editCard.id && <label>Source note (optional)<select name="note" defaultValue={editCard.note || ''}><option value="">No source</option>{w.notes.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</select></label>}{editCard.excerpt && <blockquote>{editCard.excerpt}</blockquote>}{editCard.id && <label className="checkbox"><input name="reset" type="checkbox"/>Reset learning progress for this edit (history stays saved)</label>}<button className="primary" disabled={busy}>Save card</button></form></div></div>}
 {source && <div className="sheet-overlay" onClick={() => setSource(undefined)}><aside className="source-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Supporting source"><div className="row"><span className="eyebrow">BACK TO THE SOURCE</span><button className="icon" aria-label="Close source" onClick={() => setSource(undefined)}><X /></button></div><h2>{w.notes.find(n => n.id === source.note)?.title || (source.note ? 'Source unavailable' : 'No source linked')}</h2><h3>Saved supporting passage</h3><blockquote>{source.excerpt || 'This manual card has no saved excerpt.'}</blockquote>{changed(source, w) && <div className="warning"><strong>Note changed — check this card.</strong><p>This is a conservative note-level flag. Compare the saved passage with the current note below.</p><button disabled={busy} onClick={() => void mutate('acknowledge', { id: source.id }).then(next => setSource(next.cards.find(c => c.id === source.id))).catch(() => { })}>Keep card & acknowledge</button><button onClick={() => setEditCard(source)}>Edit card</button><button onClick={() => { act('lifecycle', { id: source.id, life: 'archived' }); setSource(undefined); }}>Archive</button></div>}{w.notes.find(n => n.id === source.note) && <><h3>Current note</h3><Markdown components={mermaidComponents}>{w.notes.find(n => n.id === source.note)!.body}</Markdown><button onClick={() => openNote(source.note!)}>Open note</button></>}<h3>Review history</h3>{w.events.filter(e => e.card === source.id).slice(-10).reverse().map(e => <p key={e.id}>{labels[e.rating - 1]} · {date(e.at)}<small className="block">Next review {date(e.due)}</small></p>)}</aside></div>}
 </div>;
}
function Stat({ icon, label, value, detail }: {
    icon?: ReactNode;
    label: string;
    value: number;
    detail?: string;
}) { return <div className="stat"><div className="row"><span>{label}</span>{icon}</div><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }
function NoteEditor({ note, w, ai, busy, mutate, follow, manual, edit, remove, localGraph, importConceptGraph }: {
    note: Note;
    w: Workspace;
    ai: boolean;
    busy: boolean;
    mutate: (a: string, p: any) => Promise<Workspace>;
    follow: (s: string, n: Note) => void;
    manual: (n: Note) => void;
    edit: (c: Card) => void;
    remove: () => void;
    localGraph: () => void;
    importConceptGraph: (sourceId:string, graph:ConceptGraph) => Promise<void>;
}) {
    const cacheKey = 'ss-unsaved-' + note.id;
    const [recovery] = useState(() => { try {
        return JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    }
    catch {
        return null;
    } });
    const [title, setTitle] = useState<string>(recovery?.title ?? note.title);
    const [body, setBody] = useState<string>(recovery?.body ?? note.body);
    const [subject, setSubject] = useState<string>(recovery?.subject ?? note.subject);
    // The note was moved (e.g. dragged in the folder tree): adopt the new subject so the next autosave keeps it.
    const [knownSubject, setKnownSubject] = useState(note.subject);
    if (knownSubject !== note.subject) { setKnownSubject(note.subject); setSubject(note.subject); }
    const [mode, setMode] = useState(note.body ? 'Read' : 'Edit');
    const [status, setStatus] = useState('Saved');
    const [selection, setSelection] = useState('');
    const [conceptGraphOpen,setConceptGraphOpen]=useState(false);
    const [retry, setRetry] = useState(0);
    const saved = useRef({ title: note.title, body: note.body, subject: note.subject, updated:recovery?.updated??note.updated });
    const latest=useRef({title,body,subject});latest.current={title,body,subject};
    const text = useRef<HTMLTextAreaElement>(null);
    const failedSave=useRef('');
    useEffect(() => { if (title === saved.current.title && body === saved.current.body && subject === saved.current.subject)
        return; const signature=JSON.stringify({title,body,subject,retry});if(failedSave.current===signature)return; sessionStorage.setItem(cacheKey, JSON.stringify({ title, body, subject,updated:saved.current.updated })); setStatus('Saving…'); if(busy)return; const timer = setTimeout(() => { void mutate('note', { id: note.id, title, body, subject,expectedUpdated:saved.current.updated }).then(next => { saved.current = { title, body, subject, updated:next.notes.find(n=>n.id===note.id)!.updated }; if(latest.current.title===title&&latest.current.body===body&&latest.current.subject===subject){sessionStorage.removeItem(cacheKey);setStatus('Saved');}else{sessionStorage.setItem(cacheKey,JSON.stringify({...latest.current,updated:saved.current.updated}));setStatus('Saving…');} }).catch(() => {failedSave.current=signature;setStatus('Save failed — retry');}); }, 700); return () => clearTimeout(timer); }, [title, body, subject, retry, busy]);
    useEffect(() => { function guard(e: BeforeUnloadEvent) { if (status !== 'Saved')
        e.preventDefault(); } window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [status]);
    const drafts = w.cards.filter(c => c.note === note.id && c.life === 'draft');
    const backlinks = w.notes.filter(n => n.id !== note.id && links(n.body).some(t => resolveLink(w, t, n).some(m => m.id === note.id)));
    const markdown = body.split(/(```[\s\S]*?```|`[^`]*`)/g).map((s, i) => i % 2 ? s : s.replace(/\[\[([^\]]+)\]\]/g, (_, t) => `[${t}](#note-${encodeURIComponent(t)})`)).join('');
    return <><section className="editor"><div className="editor-toolbar"><button className="text-button" disabled={status!=='Saved'} onClick={localGraph}><Network size={14}/>View local graph</button><button className="text-button" disabled={status!=='Saved'||!body.trim()} onClick={()=>setConceptGraphOpen(true)}><Network size={14}/>Generate concept graph</button><div className="segmented">{['Read', 'Edit'].map(m => <button key={m} className={mode === m ? 'selected' : ''} onClick={() => setMode(m)}>{m}</button>)}</div><button className="save-status" onClick={() => setRetry(r => r + 1)}>{status === 'Saved' && <Check size={13}/>} {status}</button></div><label className="sr-only" htmlFor="note-title">Note title</label><input id="note-title" className="note-title" value={title} onChange={e => setTitle(e.target.value)}/><div className="note-meta"><select aria-label="Note subject" value={w.subjects.some(s => s.id === subject) ? subject : ''} onChange={e => setSubject(e.target.value)}>{w.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="">Uncategorised</option></select><span>Edited {date(note.updated)}</span></div>{mode === 'Edit' ? <textarea className="markdown-editor" ref={text} aria-label="Markdown note body" value={body} placeholder="Start with an idea. Link it with [[Note Title]]." onChange={e => setBody(e.target.value)} onSelect={() => { const el = text.current; if (el)
        setSelection(el.value.slice(el.selectionStart, el.selectionEnd)); }}/> : <div className="prose" onMouseUp={() => setSelection(window.getSelection()?.toString() || '')}><Markdown components={{ ...mermaidComponents, a: ({ href, children }) => href?.startsWith('#note-') ? <button className="wikilink" onClick={() => follow(decodeURIComponent(href.slice(6)), note)}>{children}</button> : <a href={href} rel="noopener noreferrer">{children}</a> }}>{markdown || '*An idea is a good place to start. Switch to Edit to write.*'}</Markdown></div>}{note.versions && note.versions.length>0 && <details className="note-history"><summary>Version history · {note.versions.length} saved revisions</summary>{[...note.versions].reverse().map(v=><div key={v.version}><strong>Version {v.version} · {date(v.at)}</strong><pre>{v.body}</pre><button disabled={busy||status!=='Saved'} onClick={()=>{if(window.confirm('Restore this revision? Your current saved text will remain in version history.')){setBody(v.body);setMode('Edit');}}}>Restore this revision</button></div>)}</details>}<div className="editor-bottom"><button className="text-button" onClick={()=>download(safeFileName(title)+'.md',noteToMarkdown({title,body},w.subjects.find(s=>s.id===subject)?.name),'text/markdown')}>Export Markdown</button><span>{body.trim() ? body.trim().split(/\s+/).length : 0} words · Markdown supported</span><button className="text-button danger-text" onClick={remove}>Delete note</button></div></section><aside className="connections"><div className="section-heading"><h3><Sparkles size={16}/> From notes to knowledge</h3></div><p>Turn {selection ? 'your selected passage' : 'this note'} into small moments of recall.</p><button className="primary full" disabled={busy || status !== 'Saved' || !body.trim()} onClick={() => void mutate('generate', { id: note.id, source: selection || body, method:'extractive' }).catch(() => { })}><Layers size={15}/>Create cloze drafts</button><small>Hides a phrase in your own text. No invented answers. Edit and approve each draft.</small>{ai && <button className="full" disabled={busy || status !== 'Saved' || !body.trim()} onClick={() => void mutate('generate', {id:note.id,source:selection||body,method:'ai'}).catch(()=>{})}><Sparkles size={15}/>Generate with AI</button>}<button className="full" onClick={() => manual(note)}><Plus size={15}/>Create manually</button>{selection && <button className="text-button" onClick={() => setSelection('')}>Clear selected passage</button>}<div className="sidebar-divider"/><h3>Drafts <span className="number">{drafts.length}</span></h3>{drafts.map(c => <div className="draft-mini" key={c.id}><span className="pill amber">Needs your approval</span><h4>{c.front}</h4><p>{c.answer}</p><details><summary>Supporting passage</summary><blockquote>{c.excerpt}</blockquote></details><div className="actions"><button onClick={() => edit(c)}>Edit</button><button className="primary" disabled={busy} onClick={() => void mutate('lifecycle', { id: c.id, life: 'active' }).catch(() => { })}>Approve</button><button disabled={busy} onClick={() => void mutate('lifecycle', { id: c.id, life: 'archived' }).catch(() => { })}>Reject</button></div></div>)}<div className="sidebar-divider"/><h3><Link2 size={16}/>Backlinks <span className="number">{backlinks.length}</span></h3>{backlinks.map(n => <button className="connection" key={n.id} onClick={() => follow(n.title, n)}><BookOpen size={15}/>{n.title}<ArrowUpRight size={14}/></button>)}{!backlinks.length && <p className="small">Notes that link here will appear here.</p>}<h3>Linked notes</h3>{[...new Set(links(body))].map(t => <button className="connection" key={t} onClick={() => follow(t, note)}><Link2 size={15}/>{t}<ArrowUpRight size={14}/></button>)}<h3>Associated cards</h3>{w.cards.filter(c => c.note === note.id && c.life !== 'draft').map(c => <button className="connection" key={c.id} onClick={() => edit(c)}><Layers size={14}/><span>{c.front}{changed(c, w) && <small className="danger-text">Note changed — check</small>}</span></button>)}</aside>{conceptGraphOpen&&<ConceptGraphModal title={title} body={body} onClose={()=>setConceptGraphOpen(false)} onImport={graph=>importConceptGraph(note.id,graph)}/>}</>;
}

const themeOptions:{value:ThemePreference;label:string;icon:typeof Sun}[]=[{value:'light',label:'Light',icon:Sun},{value:'dark',label:'Dark',icon:Moon},{value:'system',label:'System',icon:Monitor}];
function ThemeToggle(){const pref=useThemePreference();const i=themeOptions.findIndex(o=>o.value===pref);const current=themeOptions[i],next=themeOptions[(i+1)%themeOptions.length];const Icon=current.icon;
return <button className="theme-toggle" onClick={()=>setThemePreference(next.value)} aria-label={`Theme: ${current.label}. Switch to ${next.label}`} title={`Theme: ${current.label}`}><Icon size={16}/></button>;}
function Appearance(){const pref=useThemePreference();
return <section className="panel appearance"><h2>Appearance</h2><p>Saved in this browser. System follows your device setting.</p><div className="segmented" role="radiogroup" aria-label="Theme">{themeOptions.map(({value,label,icon:Icon})=><button key={value} role="radio" aria-checked={pref===value} className={pref===value?'selected':''} onClick={()=>setThemePreference(value)}><Icon size={14}/>{label}</button>)}</div></section>;}
function Settings({w,ai,busy,mutate,importNotes}:{w:Workspace;ai:boolean;busy:boolean;mutate:(a:string,p:any)=>Promise<Workspace>;importNotes:()=>void}){
const [message,setMessage]=useState('');const [backup,setBackup]=useState<any>();const [fileError,setFileError]=useState('');
return <><div className="page-heading"><div className="eyebrow">YOUR WORKSPACE</div><h1>Make it yours.</h1><p>Study preferences, appearance, data portability, and generation.</p></div><Appearance/><div className="dashboard-grid"><section className="panel"><h2>Your study rhythm</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void mutate('settings',{limit:Number(f.get('limit')),zone:f.get('zone')}).then(()=>setMessage('Preferences saved.')).catch(()=>{});}}><label>New cards per day<input name="limit" type="number" min="0" max="100" defaultValue={w.limit}/></label><label>Timezone<input name="zone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} required/></label><p className="small">Daily counts use {w.zone}. Due cards are always available regardless of the new-card limit.</p><button className="primary" disabled={busy}>Save preferences</button></form></section><section className="panel"><h2>Card generation</h2><p><strong>Cloze drafting is ready.</strong> It hides a phrase in your own sentences and saves editable drafts with exact source excerpts. It works without an AI service.</p><p>{ai?'AI generation is connected. Generate with AI is available in every note.':'AI generation is not connected. To enable it, set AI_API_KEY in the server environment and restart. AI_MODEL is optional. Never paste API keys into notes.'}</p></section></div><section className="panel"><h2>Manage subjects</h2><form onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const name=new FormData(form).get('name');void mutate('subject',{name}).then(()=>{form.reset();setMessage('Subject created.');}).catch(()=>{});}}><label>New subject<input name="name" required maxLength={100}/></label><button disabled={busy}>Add subject</button></form>{w.subjects.map(s=><form className="subject-settings" key={s.id} onSubmit={e=>{e.preventDefault();void mutate('subject',{id:s.id,name:new FormData(e.currentTarget).get('name')}).then(()=>setMessage('Subject renamed.')).catch(()=>{});}}><input aria-label={'Rename '+s.name} name="name" defaultValue={s.name} required maxLength={100}/><button disabled={busy}>Rename</button><button type="button" disabled={busy} className="danger-text" onClick={()=>{if(window.confirm('Delete this subject? Its notes will be kept as uncategorised. Cards, saved excerpts and review history will remain.'))void mutate('deleteSubject',{id:s.id}).then(()=>setMessage('Subject deleted.')).catch(()=>{});}}>Delete</button></form>)}</section><section className="panel"><h2>Your data, in your hands</h2><p>Export all subjects, notes, cards, schedules, and review history as JSON. Importing adds data with fresh identifiers and preserves your existing work. Import a backup only once to avoid duplicate copies.</p><button onClick={()=>exportWorkspace(w)}>Download workspace backup</button><label>Import a StudySprint backup<input type="file" accept=".json,application/json" onChange={async e=>{setFileError('');setBackup(undefined);const f=e.target.files?.[0];if(!f)return;if(f.size>2900000){setFileError('Choose a backup smaller than 2.9 MB.');return;}try{const data=JSON.parse(await f.text());if(data.format!=='studysprint'||data.version!==1)throw Error('Choose a StudySprint JSON backup.');setBackup(data);}catch(e){setFileError((e as Error).message);}}}/></label>{fileError&&<p role="alert" className="danger-text">{fileError}</p>}{backup&&<div className="warning"><p>Ready to import {backup.workspace?.notes?.length||0} notes and {backup.workspace?.cards?.length||0} cards. Existing data will be kept.</p><button disabled={busy} onClick={()=>void mutate('import',{backup}).then(()=>{setBackup(undefined);setMessage('Backup imported successfully.');}).catch(()=>{})}>Import backup</button><button onClick={()=>setBackup(undefined)}>Cancel</button></div>}<h3>Notes and documents</h3><p>Import Markdown, PDF, Word (.docx), plain text, HTML, CSV, JSON, XML, or log files as notes. PDF and Word text is extracted in your browser; the original file is not stored. Export every note as Markdown grouped in a .zip.</p><div className="actions"><button disabled={!w.notes.length} onClick={()=>exportNotes(w)}><Download size={16}/>Export all notes (.zip)</button><button onClick={importNotes}><Upload size={16}/>Import files</button></div><p className="small">Access is tied to this browser's guest cookie. Download a backup before clearing browser data, or use a backup to move your work to another browser.</p></section>{message&&<p className="notice" role="status">{message}</p>}</>;
}

const IMPORT_LIMIT=2800000;
const IMPORT_FILE_LIMIT=25*1024*1024;
const SUPPORTED_IMPORT_TYPES='PDF, Word (.docx), Markdown, text, HTML, CSV, JSON, XML and log files';
async function extractImportedFile(file:File):Promise<MarkdownFile>{
if(file.size>IMPORT_FILE_LIMIT)throw Error(`“${file.name}” is larger than 25 MB. Choose a smaller file.`);
const path=file.webkitRelativePath||file.name;const extension=file.name.split('.').pop()?.toLowerCase()||'';let content='';
if(extension==='pdf'){
const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
const loadingTask=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())});const pdf=await loadingTask.promise;
if(pdf.numPages>500){await loadingTask.destroy();throw Error(`“${file.name}” has more than 500 pages. Split it before importing.`);}
const pages:string[]=[];for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){const page=await pdf.getPage(pageNo);const text=await page.getTextContent();pages.push(text.items.map(item=>{if(!('str'in item))return '';return `${item.str}${item.hasEOL?'\n':' '}`;}).join('').replace(/[ \t]+\n/g,'\n').trim());page.cleanup();}
await loadingTask.destroy();content=pages.map((text,index)=>`## Page ${index+1}\n\n${text}`).join('\n\n');
if(!pages.some(text=>text.trim()))throw Error(`No selectable text was found in “${file.name}”. Scanned image-only PDFs need OCR before import.`);
}else if(extension==='docx'){
const mammothModule=await import('mammoth/mammoth.browser.js');const mammoth=mammothModule.default;
content=(await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;
}else if(['md','markdown','txt','text','csv','json','xml','log'].includes(extension))content=await file.text();
else if(['html','htm'].includes(extension)){const parsed=new DOMParser().parseFromString(await file.text(),'text/html');parsed.querySelectorAll('script,style,noscript,svg').forEach(node=>node.remove());content=(parsed.body.innerText||parsed.body.textContent||'').replace(/\n{3,}/g,'\n\n').trim();}
else if(extension!=='zip')throw Error(`“${file.name}” is not supported. Choose ${SUPPORTED_IMPORT_TYPES}, or a .zip of Markdown notes.`);
if(extension==='zip')throw Error('ZIP import currently supports Markdown notes only. Choose Markdown files from the archive instead.');
const markdownPath=path.replace(/\.[^/.]+$/,'')+'.md';return{path:markdownPath,content};
}
function DocumentImport({w,busy,preferredSubject,mutate,done}:{w:Workspace;busy:boolean;preferredSubject:string;mutate:(a:string,p:any)=>Promise<Workspace>;done:(message:string)=>void}){
const [files,setFiles]=useState<MarkdownFile[]>([]);const [reading,setReading]=useState(false);const [fileError,setFileError]=useState('');const [folders,setFolders]=useState(true);
const [subject,setSubject]=useState(preferredSubject&&preferredSubject!==UNCATEGORISED?preferredSubject:preferredSubject===UNCATEGORISED?'':w.subjects[0]?.id||'');const [newSubject,setNewSubject]=useState('');const [saving,setSaving]=useState(false);
async function choose(list:FileList|null){setFileError('');if(!list?.length)return;setReading(true);try{const next:MarkdownFile[]=[...files];for(const f of Array.from(list)){if(/\.zip$/i.test(f.name))next.push(...await unzipMarkdown(new Uint8Array(await f.arrayBuffer()),IMPORT_LIMIT));else next.push(await extractImportedFile(f));}
const seen=new Set<string>();const unique=next.filter(f=>!seen.has(f.path)&&!!seen.add(f.path));if(!unique.length)throw Error(`No supported documents were found. Choose ${SUPPORTED_IMPORT_TYPES}, or a .zip of Markdown notes.`);if(unique.length>1000)throw Error('Import up to 1000 notes at a time.');if(unique.reduce((t,f)=>t+f.content.length,0)>IMPORT_LIMIT)throw Error('Extracted text exceeds 2.8 MB total. Import fewer or smaller documents at a time.');setFiles(unique);}catch(e){setFileError((e as Error).message);}finally{setReading(false);}}
const notes=files.map(f=>parseMarkdownNote(f.path,f.content,folders));const tooLong=notes.find(n=>n.body.length>100000);const needsSubject=notes.some(n=>!n.subject);
const subjectName=(n:{subject?:string})=>n.subject||(subject==='new'?newSubject.trim()||'New subject':w.subjects.find(s=>s.id===subject)?.name||'Uncategorised');
return <form onSubmit={e=>{e.preventDefault();if(saving)return;setSaving(true);const before=w.notes.length;void mutate('importNotes',{notes,subject:subject==='new'?undefined:subject,newSubject:subject==='new'?newSubject:undefined}).then(next=>{const imported=next.notes.length-before;done(`Imported ${imported} ${imported===1?'note':'notes'}${notes.length>imported?` · skipped ${notes.length-imported} already in your workspace`:''}.`);}).catch(()=>{}).finally(()=>setSaving(false));}}><h2>Import files as notes.</h2><p>Choose Markdown, PDF, Word (.docx), text, HTML, CSV, JSON, XML, or log files, a folder, or a .zip of Markdown notes. PDF and Word text is extracted in your browser; original files are not stored. Scanned PDFs need OCR before import.</p>
<div className="actions"><label className="file-button">Choose files<input type="file" multiple accept=".md,.markdown,.zip,.pdf,.docx,.txt,.text,.csv,.json,.html,.htm,.xml,.log,text/markdown,application/zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/html,text/csv,application/json,application/xml" onChange={e=>{void choose(e.target.files);e.target.value='';}}/></label><label className="file-button">Choose folder<input type="file" ref={el=>{el?.setAttribute('webkitdirectory','');}} onChange={e=>{void choose(e.target.files);e.target.value='';}}/></label>{files.length>0&&<button type="button" onClick={()=>setFiles([])}>Clear</button>}</div>
{reading&&<p role="status">Reading files…</p>}{fileError&&<p role="alert" className="danger-text">{fileError}</p>}
<label className="checkbox"><input type="checkbox" checked={folders} onChange={e=>setFolders(e.target.checked)}/>Use folder names as subjects (front matter subjects always apply)</label>
{(needsSubject||!files.length)&&<label>Subject for notes without one<select value={subject} onChange={e=>setSubject(e.target.value)}>{w.subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}<option value="">Keep uncategorised</option><option value="new">New subject…</option></select></label>}
{subject==='new'&&(needsSubject||!files.length)&&<label>New subject name<input value={newSubject} onChange={e=>setNewSubject(e.target.value)} required={needsSubject} maxLength={100} placeholder="e.g. Computer Networking"/></label>}
{files.length>0&&<><h3>{notes.length} {notes.length===1?'note':'notes'} ready</h3><ul className="import-list">{notes.slice(0,200).map((n,i)=><li key={files[i].path}><BookOpen size={14}/><span>{n.title}<small>{subjectName(n)}</small></span></li>)}{notes.length>200&&<li className="muted">…and {notes.length-200} more</li>}</ul></>}
{tooLong&&<p role="alert" className="danger-text">“{tooLong.title}” is longer than 100,000 characters. Split it before importing.</p>}
<button className="primary" disabled={busy||saving||reading||!files.length||!!tooLong}><Upload size={16}/>{saving?'Importing…':`Import ${notes.length||''} ${notes.length===1?'note':'notes'}`}</button></form>;
}
