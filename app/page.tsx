'use client';
import { useState, useEffect, useRef, useCallback, useId, useMemo, lazy, Suspense, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {CreateNoteDialog} from '../components/notes/CreateNoteDialog';
import {MarkdownBundleImport} from '../components/notes/MarkdownBundleImport';
import {ImproveConversion} from '../components/notes/ImproveConversion';
import {documentUrl,DocumentImage} from '../components/notes/documentMarkdown';
import {ImportProgress} from '../components/notes/ImportProgress';
import {BackupRestore} from '../components/notes/BackupRestore';
import {GraphBoundary} from '../components/graph/GraphBoundary';
import { mermaidComponents } from '../components/MermaidDiagram';
import { NoteTree } from '../components/NoteTree';
import { QuizTab, QuizImport, downloadQuizTemplate } from '../components/Quiz';
import { InsightsTab, QuizProgress } from '../components/Insights';
import { FocusProgress, FocusTimer, PomodoroChip, PomodoroGuard } from '../components/Pomodoro';
import { BookOpen, Layers, Sun, ChartNoAxesCombined, Plus, ArrowUpRight, ArrowRight, Network, Search, ChevronRight, Check, Clock, Link2, Sparkles, X, MoreHorizontal, Leaf, Download, Upload, Settings as SettingsIcon, Moon, Monitor, Timer, Tag, ListChecks, Lightbulb } from 'lucide-react';
import { type ThemePreference, setThemePreference, useThemePreference } from '../lib/theme';
import { normalizeTags, allTags, MAX_TAGS, validateNoteBody, type WorkspaceSnapshot, type NoteSummary, type ImportJob, type Note, type Card, linksForNote, queue, day, changed, links, resolveLink, preview, uid } from '../lib/study';
import { type MarkdownFile, noteToMarkdown, notesToFiles, parseMarkdownNote, safeFileName, unzipMarkdown, zip } from '../lib/markdown-notes';
import { type NoteOp, mergeOp, removeOp, applyOutbox, unreachable, loadOutbox, saveOutbox, loadCache, saveCache, loadNoteCache, saveNoteCache, lastUser, rememberUser, forgetUser } from '../lib/offline';
import { parseCards, cardKey, MAX_IMPORT_CARDS, type ParsedCard } from '../lib/card-import';
const remarkPlugins=[remarkGfm];
import { UNCATEGORISED } from '../lib/note-graph';
// Subject filter match; UNCATEGORISED selects items with no (or a deleted) subject.
const inSubject=(w:WorkspaceSnapshot,item:{subject:string},subject:string)=>!subject||(subject===UNCATEGORISED?!item.subject||!w.subjects.some(s=>s.id===item.subject):item.subject===subject);
function download(name:string,content:BlobPart,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function rememberNote(cache:Record<string,Note>,note:Note){const next={...cache};delete next[note.id];next[note.id]=note;for(const id of Object.keys(next).slice(0,-6))delete next[id];return next;}
function WorkspaceBackupButton({label='Download workspace backup',className=''}:{label?:string;className?:string}){const [busy,setBusy]=useState(false),[error,setError]=useState('');return <div className="backup-download"><button className={className} disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const response=await fetch('/api/backups?check=1');const data=await response.json() as {ready?:boolean;error?:string};if(!response.ok||!data.ready)throw Error(data.error||'Your backup could not be prepared.');const link=document.createElement('a');link.href='/api/backups';link.download='studysprint-backup-'+new Date().toISOString().slice(0,10)+'.zip';link.click();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?'Preparing backup…':label}</button>{error&&<p className="danger-text small" role="alert">{error}</p>}</div>;}

async function exportNotes(w:WorkspaceSnapshot,subject='') {const params=new URLSearchParams();if(subject)params.set('subject',subject===UNCATEGORISED?'':subject);const link=document.createElement('a');link.href='/api/markdown-bundle?'+params;link.download='studysprint-notes.zip';link.click();}

const SourceReader=lazy(()=>import('../components/notes/SourceReader'));
const NoteGraphView=lazy(()=>import('../components/graph/NoteGraphView'));
const labels = ['Again', 'Hard', 'Good', 'Easy'];
const date = (v: string) => new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function interval(v: Date | string) { const m = Math.max(1, Math.round((+new Date(v) - Date.now()) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} hr` : `${Math.round(m / 1440)} days`; }
export default function App() {
    const [w, setW] = useState<WorkspaceSnapshot>();
    const workspaceVersion=useRef(-1);
    const applyWorkspace=useCallback((result:{workspace:WorkspaceSnapshot;version?:number})=>{if(typeof result.version==='number'&&result.version<workspaceVersion.current)return;received(result.workspace,result.version??workspaceVersion.current);},[]);
    const [tab, setTab] = useState('Today');
    const [graphVisited,setGraphVisited]=useState(false);
    const [graphFocus,setGraphFocus]=useState({id:'',sequence:0});
    function openGraph(id?:string){setGraphVisited(true);if(id)setGraphFocus(f=>({id,sequence:f.sequence+1}));setTab('Graph');}
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const [ai, setAi] = useState(false);
    const [uploads,setUploads]=useState(true);
    const [noteCache,setNoteCache]=useState<Record<string,Note>>({});
    const [noteLoadError,setNoteLoadError]=useState('');
    const [noteAttempt,setNoteAttempt]=useState(0);
    const [jobs,setJobs]=useState<ImportJob[]>([]);
    const trackedImport=useRef('');
    const previousJobs=useRef(new Map<string,string>());
    const importRefreshBusy=useRef(false);
    const importWorkspacePending=useRef(false);
    const [user, setUser] = useState<User | null>(null);
    const [signIn, setSignIn] = useState(false);
    const [online, setOnline] = useState(true);
    const [unsynced, setUnsynced] = useState<NoteOp[]>([]);
    const [quizLaunch, setQuizLaunch] = useState<{ quiz: string; only?: string[] }>();
    // The last server copy of the workspace; `w` is this copy with the offline outbox laid over it.
    const serverW = useRef<WorkspaceSnapshot | undefined>(undefined);
    const serverVersion = useRef(-1);
    const account = useRef('');
    const syncing = useRef(false);
    const reported = useRef(new Set<string>());
    const [selected, setSelected] = useState('');
    const [editorRevision,setEditorRevision]=useState(0);
    async function conversionApplied(id:string){const [w,n]=await Promise.all([fetch('/api/workspace'),fetch('/api/notes/'+id)]);const workspace:any=await w.json(),detail:any=await n.json();if(!w.ok||!n.ok)throw Error(workspace.error||detail.error||'The applied note could not refresh.');applyWorkspace(workspace);setNoteCache(cache=>rememberNote(cache,detail.note));setEditorRevision(v=>v+1);}
    const [subject, setSubject] = useState('');
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [sourceFilter, setSourceFilter] = useState('');
    const [modal, setModal] = useState<ReactNode>();
    const [editCard, setEditCard] = useState<Card | undefined>();
    const [source, setSource] = useState<Card>();
    const [revealed, setRevealed] = useState(false);
    const [session, setSession] = useState<string[]>([]);
    const [finished,setFinished]=useState(false);
    const [reviewSubject, setReviewSubject] = useState('');
    const [reviewCardId, setReviewCardId] = useState('');
    const [eventId, setEventId] = useState(uid);
    const [tick, setTick] = useState(0);
    const [notice, setNotice] = useState('');
    const currentTab=useRef(tab);currentTab.current=tab;
    useEffect(() => { void load(); const timer = setInterval(() => setTick(t => t + 1), 15000);
        // Periodic sync: upload queued note edits and pull changes made on other devices.
        const syncTimer = setInterval(() => void sync(), 30000);
        const onOnline = () => void sync(), onOffline = () => setOnline(false), onVisible = () => { if (document.visibilityState === 'visible') void sync(); };
        window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline); document.addEventListener('visibilitychange', onVisible);
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
        return () => { clearInterval(timer); clearInterval(syncTimer); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); document.removeEventListener('visibilitychange', onVisible); }; }, []);
    const OFFLINE = "You're offline. Notes you write are kept on this device and sync when you reconnect, but this action needs a connection.";
    const getJson = async (url: string, init?: RequestInit) => { try { return await fetch(url, init); } catch { return undefined; } };
    function received(workspace: WorkspaceSnapshot, version: number) { if(version<workspaceVersion.current)return;workspaceVersion.current=version;serverW.current = workspace; serverVersion.current = version; const ops = loadOutbox(account.current); saveCache(account.current, workspace, version); setUnsynced(ops); setW(applyOutbox(workspace, ops,true)); }
    async function load() {
        const r = await getJson('/api/workspace?zone=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone));
        if (unreachable(r)) {
            const u = lastUser(), cached = u && loadCache(u.email);
            if (!u || !cached) return setError("Can't reach StudySprint. Check your connection and try again.");
            account.current = u.email; setNoteCache(loadNoteCache(u.email)); setUser(u); setOnline(false); received(cached.workspace, cached.version); return;
        }
        const d: any = await r!.json();
        if (d.signIn) return setSignIn(true);
        if (d.error) return setError(d.error);
        account.current = d.user.email; setNoteCache(loadNoteCache(d.user.email)); setUploads(!!d.uploads); rememberUser(d.user); setUser(d.user); setAi(d.ai); received(d.workspace, d.version); void sync();
    }
    function queueNote(data: any) {
        if (!account.current || !serverW.current) throw Error(OFFLINE);
        if (data.newSubject) throw Error('Creating a subject needs a connection. Choose an existing subject or Uncategorised for now.');
        validateNoteBody(String(data.body??''));
        if (!String(data.title ?? '').trim()) throw Error('A name is required');
        const ops = mergeOp(loadOutbox(account.current), { id: data.id || uid(), create: data.id ? undefined : true, base: data.expectedUpdated, title: String(data.title).trim(), body: String(data.body ?? ''), subject: String(data.subject || ''), ...(data.tags !== undefined ? { tags: normalizeTags(data.tags) } : {}), at: new Date().toISOString() });
        saveOutbox(account.current, ops); setUnsynced(ops);
        const next = applyOutbox(serverW.current, ops,true); setW(next);setNoteCache(cache=>{const summary=next.notes.find(n=>n.id===(data.id||ops.at(-1)!.id))!;const updated=rememberNote(cache,{...summary,body:String(data.body??'')});saveNoteCache(account.current,updated);return updated;}); return next;
    }
    // Uploads one queued edit: 'done' removes it, 'skip' keeps it for later, 'stop' ends this round (offline or busy).
    async function upload(op: NoteOp): Promise<'done' | 'skip' | 'stop'> {
        const u = account.current;
        const post = (body: object) => getJson('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'note', ...body }) });
        const done = () => { const ops = removeOp(loadOutbox(u), op); saveOutbox(u, ops); setUnsynced(ops); return 'done' as const; };
        let r = await post({ id: op.id, create: op.create, title: op.title, body: op.body, subject: op.subject, tags: op.tags, expectedUpdated: op.base });
        if (unreachable(r)) { setOnline(false); return 'stop'; }
        setOnline(true);
        if (r!.ok) return done();
        const d: any = await r!.json();
        if (d.signIn) { setSignIn(true); setW(undefined); return 'stop'; }
        if (r!.status === 409) return 'stop';
        if (/changed in another tab|Note unavailable|Subject unavailable/.test(d.error)) {
            // Compare with the server's current note: identical means an earlier upload already landed; edited elsewhere
            // means both versions are kept; deleted elsewhere means the note is restored with the offline text.
            const g = await getJson('/api/workspace');
            if (unreachable(g)) { setOnline(false); return 'stop'; }
            const sw = ((await g!.json()) as { workspace?: WorkspaceSnapshot }).workspace;
            if (!sw) return 'stop';
            const summary=sw.notes.find(n=>n.id===op.id);let current:Note|undefined;if(summary){const detail=await getJson('/api/notes/'+encodeURIComponent(op.id));if(unreachable(detail))return 'stop';if(!detail!.ok)return 'stop';current=((await detail!.json()) as {note:Note}).note;}
            if (current && current.title === op.title && current.body === op.body && current.subject === op.subject && (!op.tags || sameTags(current.tags, op.tags))) return done();
            const subject = sw.subjects.some(x => x.id === op.subject) ? op.subject : '';
            const conflict = !!current && !!op.base && current.updated !== op.base;
            const copy = op.title.slice(0, 185) + ' (offline copy)';
            r = await post(conflict ? { id: uid(), create: true, title: copy, body: op.body, subject, tags: op.tags } : { id: op.id, create: !current, title: op.title, body: op.body, subject, tags: op.tags, expectedUpdated: current?.updated });
            if (unreachable(r)) { setOnline(false); return 'stop'; }
            if (r!.ok) { if (conflict) setNotice(`“${op.title}” was also changed on another device, so your offline version was saved as “${copy}”.`); return done(); }
            d.error = ((await r!.json()) as { error?: string }).error;
        }
        if (!reported.current.has(op.at)) { reported.current.add(op.at); setError(`Couldn't sync “${op.title}”: ${d.error} It stays on this device and will be retried.`); }
        return 'skip';
    }
    async function sync() {
        if (!account.current || syncing.current || lock.current) return;
        syncing.current = true;
        try {
            let uploaded = false;
            for (const op of loadOutbox(account.current)) { const outcome = await upload(op); if (outcome === 'stop') return; uploaded ||= outcome === 'done'; }
            const r = await getJson('/api/workspace');
            if (unreachable(r)) return setOnline(false);
            setOnline(true);
            const d: any = await r!.json();
            if (d.signIn) { setSignIn(true); setW(undefined); return; }
            if (d.workspace && !lock.current && (uploaded || d.version !== serverVersion.current)) received(d.workspace, d.version);
        }
        finally { syncing.current = false; }
    }
    async function mutate(action: string, data: any = {}) { if (lock.current)
        throw Error('Please wait for the current save.'); lock.current = true; setBusy(true); setError(''); try {
        // Edits to a note that still has queued offline changes join the queue so they upload in order.
        if (action === 'note' && data.id && loadOutbox(account.current).some(o => o.id === data.id)) { const next = queueNote(data); setTimeout(() => void sync(), 0); return next; }
        const r = await getJson('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }) });
        if (unreachable(r)) {
            setOnline(false);
            if (action === 'note') return queueNote(data);
            throw Error(OFFLINE);
        }
        setOnline(true);
        const d: any = await r!.json();
        if (d.signIn) {
            setSignIn(true);
            setW(undefined);
        }
        if (!r!.ok)
            throw Error(d.error);
        applyWorkspace(d);
        if(action==='note'&&data.id){const summary=(d.workspace as WorkspaceSnapshot).notes.find(n=>n.id===data.id);if(summary)setNoteCache(cache=>{const previous=cache[data.id];if(!previous)return cache;const versions=previous.version!==summary.version?[...(previous.versions||[]),{version:previous.version,at:previous.updated}]:previous.versions;return rememberNote(cache,{...previous,...summary,body:String(data.body),versions});});}
        return d.workspace as WorkspaceSnapshot;
    }
    catch (e) {
        setError((e as Error).message);
        throw e;
    }
    finally {
        lock.current = false;
        setBusy(false);
    } }
    function act(action: string, data: any = {}) { void mutate(action, data).catch(() => { }); }
    useEffect(()=>{if(account.current)saveNoteCache(account.current,noteCache);},[noteCache]);
    const noteSummary=w?.notes.find(n=>n.id===selected);
    const cachedNote=noteCache[selected];
    const queuedOp=unsynced.find(o=>o.id===selected);
    const note=noteSummary&&(queuedOp||cachedNote?.updated===noteSummary.updated)?{...cachedNote,...noteSummary,body:queuedOp?.body??cachedNote!.body}:undefined;
    useEffect(()=>{if(!noteSummary||queuedOp)return;const controller=new AbortController();setNoteLoadError('');if(noteCache[selected]?.updated===noteSummary.updated)return;fetch('/api/notes/'+encodeURIComponent(selected),{signal:controller.signal}).then(async r=>{const data=await r.json() as {note:Note;error?:string};if(!r.ok)throw Error(data.error||'This note could not load.');return data.note;}).then(n=>setNoteCache(cache=>rememberNote(cache,n))).catch(e=>{if(e.name!=='AbortError')setNoteLoadError(e.message);});return()=>controller.abort();},[selected,noteSummary?.updated,noteAttempt,queuedOp?.at]);
    const refreshImports=useCallback(async(updatedJob?:ImportJob)=>{if(updatedJob){setJobs(current=>[updatedJob,...current.filter(j=>j.id!==updatedJob.id)]);if(updatedJob.status==='cancelled'){setNotice('Import cancelled.');if(trackedImport.current===updatedJob.id){trackedImport.current='';try{sessionStorage.removeItem('ss-tracked-import');}catch{}}}}if(importRefreshBusy.current)return;importRefreshBusy.current=true;try{const r=await fetch('/api/note-imports');if(!r.ok)return;const data=await r.json() as {jobs:ImportJob[]};setJobs(current=>trackedImport.current&&!data.jobs.some(j=>j.id===trackedImport.current)?[...current.filter(j=>j.id===trackedImport.current),...data.jobs]:data.jobs);for(const job of data.jobs){const previous=previousJobs.current.get(job.id);if(job.status==='ready'&&((previous&&previous!=='ready')||trackedImport.current===job.id)){importWorkspacePending.current=true;if(trackedImport.current===job.id){trackedImport.current='';try{sessionStorage.removeItem('ss-tracked-import');}catch{}if(job.noteId&&currentTab.current==='Notes'){setSelected(job.noteId);}setNotice(job.kind==='restore'?'Workspace backup restored.':'Your document is ready to study.');}}previousJobs.current.set(job.id,job.status);}if(importWorkspacePending.current){const response=await fetch('/api/workspace');if(response.ok){const result=await response.json() as {workspace:WorkspaceSnapshot;version?:number};applyWorkspace(result);importWorkspacePending.current=false;}}}finally{importRefreshBusy.current=false;}},[applyWorkspace]);
    const activeImports=jobs.some(j=>j.status==='queued'||j.status==='processing');
    useEffect(()=>{if(!w)return;try{trackedImport.current=sessionStorage.getItem('ss-tracked-import')||trackedImport.current;}catch{}void refreshImports().catch(()=>{});const timer=setInterval(()=>void refreshImports().catch(()=>{}),activeImports?2000:15000);return()=>clearInterval(timer);},[!!w,activeImports,refreshImports]);
    function trackImport(job:ImportJob){trackedImport.current=job.id;try{sessionStorage.setItem('ss-tracked-import',job.id);}catch{}setJobs(current=>[job,...current.filter(j=>j.id!==job.id)]);setModal(undefined);setTab('Notes');setNotice(job.kind==='restore'?'Backup uploaded. Your workspace will update when restoration completes.':'Your document is converting. You can keep studying.');void refreshImports().catch(()=>{});}
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
    useEffect(() => { function key(e: KeyboardEvent) { if (tab !== 'Review' || finished || e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target as HTMLElement)?.isContentEditable || modal || editCard || source)
        return; if (e.code === 'Space') {
        e.preventDefault();
        setRevealed(true);
    } if (revealed && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        void rating(Number(e.key));
    } } window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); });
    useEffect(() => { if (!modal && !editCard && !source)
        return; const previous = document.activeElement as HTMLElement; const dialogs = document.querySelectorAll<HTMLElement>('[role=dialog]'); const dialog = dialogs[dialogs.length - 1]; const selector = 'button:not([disabled]),input,textarea,select,a[href],[tabindex="0"]'; (dialog?.querySelector(selector) as HTMLElement)?.focus(); function trap(e: KeyboardEvent) { if (e.key === 'Escape') {
        setModal(undefined);
        setEditCard(undefined);
        setSource(undefined);
    } if (e.key !== 'Tab' || !dialog)
        return; const items = Array.from(dialog.querySelectorAll<HTMLElement>(selector)); if (!items.length)
        return; const first = items[0], last = items[items.length - 1]; if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    }
    else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    } } document.addEventListener('keydown', trap); return () => { document.removeEventListener('keydown', trap); previous?.focus(); }; }, [modal, editCard, source]);
    function openNote(id: string) {trackedImport.current='';try{sessionStorage.removeItem('ss-tracked-import');}catch{} setSelected(id); setTab('Notes'); setSource(undefined); }
    function start(s = '') { setFinished(false); setReviewCardId(''); setReviewSubject(s); setSession([]); setRevealed(false); setEventId(uid()); setNotice(''); setTab('Review'); }
    function moveNote(note: NoteSummary, subjectId: string) { const count = w!.cards.filter(c => c.note === note.id).length; void mutate('moveNote', { id: note.id, subject: subjectId }).then(() => setNotice(`Moved “${note.title}”${count ? ` and ${count === 1 ? '1 flashcard' : `${count} flashcards`}` : ''} to ${subjectId ? subjectName(subjectId) : 'no folder'}.`)).catch(() => { }); }
    function confirmDeleteNote(note: Note|NoteSummary) { const count = w!.cards.filter(c => c.note === note.id).length; if (!count) return confirmAction('Delete this note?', 'It has no flashcards. Existing links to it will become unresolved.', () => act('deleteNote', { id: note.id }));
        const cards = count === 1 ? '1 flashcard' : `${count} flashcards`;
        setModal(<div><h2>Delete this note?</h2><p>“{note.title}” has {cards}. You can keep them, with their saved source excerpts, or delete them with the note. Review history is kept either way. Existing links to the note will become unresolved.</p><div className="actions"><button onClick={() => setModal(undefined)}>Cancel</button><button onClick={() => { setModal(undefined); act('deleteNote', { id: note.id }); }}>Delete note, keep cards</button><button className="danger" onClick={() => { setModal(undefined); act('deleteNote', { id: note.id, cards: true }); }}>Delete note and {cards}</button></div></div>); }
    function confirmAction(title: string, description: string, action: () => void) { setModal(<div><h2>{title}</h2><p>{description}</p><div className="actions"><button onClick={() => setModal(undefined)}>Cancel</button><button className="danger" onClick={() => { setModal(undefined); action(); }}>Confirm</button></div></div>); }
    function subjectForm(s?: {
        id: string;
        name: string;
    }) { setModal(<form onSubmit={e => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name'); void mutate('subject', { id: s?.id, name }).then(() => setModal(undefined)).catch(() => { }); }}><h2>{s ? 'Rename subject' : 'A space for your subject'}</h2><label>Subject name<input name="name" defaultValue={s?.name} required maxLength={100} autoFocus placeholder="e.g. Computer Networking"/></label><button className="primary">Save subject</button></form>); }
    function newNote(title='',preferredSubject=''){if(!w)return;setModal(<CreateNoteDialog w={w} title={title} subject={preferredSubject||(subject===UNCATEGORISED?'':subject)||w.subjects[0]?.id||''} uploads={uploads} write={async data=>{const next=await mutate('note',data);setModal(undefined);openNote(next.notes.at(-1)!.id);}} uploaded={trackImport}/>);}
    function follow(title: string, from: Note|NoteSummary) { const found = resolveLink(w!, title, from); if (found.length === 1)
        openNote(found[0].id);
    else if (!found.length)
        confirmAction('This note is waiting to be written.', `Create “${title}” and connect your ideas.`, () => newNote(title,from.subject));
    else
        setModal(<><h2>Choose a note</h2>{found.map(n => <button key={n.id} className="note-row" onClick={() => { void mutate('link', { id: from.id, title, target: n.id }).then(() => { setModal(undefined); openNote(n.id); }).catch(() => { }); }}>{n.title}<small>{w?.subjects.find(s => s.id === n.subject)?.name}</small></button>)}</>); }
    function uploadQuizzes() { if (!w) return; setModal(<QuizImport w={w} mutate={mutate} done={message => { setModal(undefined); setNotice(message); }}/>); }
    function importCards() { if (!w) return; setModal(<CardImport w={w} mutate={mutate} done={message => { setModal(undefined); setNotice(message); }}/>); }
    function importNotes() { if (!w) return; setModal(<MarkdownBundleImport w={w} preferredSubject={subject} done={trackImport}/>); }
    function manual(n?: Note) { setEditCard({ id: '', subject: n?.subject || '', note: n?.id, front: '', answer: '', excerpt: n?.body || '', sourceVersion: n?.version || 0, checked: true, life: 'active', schedule: {}, type: 'basic' }); }
    if (!w && signIn)
        return <Landing/>;
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
 <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('Today'); }}><span className="brandmark"><Layers size={21}/></span>StudySprint<span className="brand-dot">.</span></a><div className="workspace-label">YOUR WORKSPACE</div><nav>{[[Sun, 'Today'], [Timer, 'Focus'], [BookOpen, 'Notes'], [Network,'Graph'], [Layers, 'Cards'], [ListChecks, 'Quiz'], [ChartNoAxesCombined, 'Progress'], [Lightbulb, 'Insights'], [SettingsIcon,'Settings']].map(([Icon, name]: any) => <button key={name} className={tab === name ? 'nav active' : 'nav'} onClick={() => {setSearch('');setQuizLaunch(undefined);if(name==='Graph')openGraph();else setTab(name);}}><Icon size={19}/>{name}{name === 'Cards' && drafts.length > 0 && <span className="nav-count">{drafts.length}</span>}</button>)}</nav><button className="primary create" onClick={() => newNote()}><Plus size={17}/>Create note</button><div className="sidebar-divider"/><div className="workspace-label row">SUBJECTS<button className="icon" aria-label="Create subject" onClick={() => subjectForm()}><Plus size={16}/></button></div>{w.subjects.map(s => <div className="subject-nav" key={s.id}><button onClick={() => { setSubject(s.id); setTab('Notes'); setSelected(w.notes.find(n => n.subject === s.id)?.id || ''); }}><span className="dot"/>{s.name}</button><button className="icon" aria-label={`Manage ${s.name}`} onClick={() => setModal(<><h2>{s.name}</h2><div className="actions"><button onClick={() => subjectForm(s)}>Rename</button><button className="danger" onClick={() => confirmAction('Delete subject?', 'Its notes will be kept as uncategorised. Cards, saved excerpts, and review history will be preserved.', () => act('deleteSubject', { id: s.id }))}>Delete subject</button></div></>)}><MoreHorizontal size={16}/></button></div>)}{hasUncategorised && <div className="subject-nav"><button onClick={() => { setSubject(UNCATEGORISED); setTab('Notes'); setSelected(w.notes.find(n => inSubject(w, n, UNCATEGORISED))?.id || ''); }}><span className="dot"/>Uncategorised</button></div>}<div className="sidebar-bottom"><div className="quiet-card"><Leaf size={19}/><strong>A little, often.</strong><p>Make space for what matters.<br />Your next session can be small.</p></div><button className="profile" onClick={()=>setTab('Settings')}><span className="avatar">{(user?.name||'S')[0].toUpperCase()}</span><span>{user?.name||'My workspace'}<small>{user?.email}</small></span></button></div></aside>
 <div className="main-wrap"><header className="topbar"><div><span className="muted">My workspace</span><ChevronRight size={14}/><span>{tab}</span></div><div><span className="top-note" role="status">{!online ? <><span className="amber-dot"/>Offline{unsynced.length ? ` · ${unsynced.length} unsynced ${unsynced.length === 1 ? 'note' : 'notes'} on this device` : ''}</> : unsynced.length ? <><span className="amber-dot"/>Syncing {unsynced.length} {unsynced.length === 1 ? 'note' : 'notes'}…</> : <><span className="green-dot"/>Ready when you are</>}</span><PomodoroChip open={() => setTab('Focus')}/><ThemeToggle/></div></header>
 {error && <div role="alert" className="error">{error}<button className="icon" onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
 {notice && <div role="status" className="notice">{notice}<button className="icon" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={16}/></button></div>}
 <main className={tab === 'Notes' ? 'notes-main' : undefined}>
 {graphVisited&&<div hidden={tab!=='Graph'}><GraphBoundary><Suspense fallback={<div className="empty" role="status">Loading your note graph…</div>}><NoteGraphView workspace={w} active={tab==='Graph'} focusRequest={graphFocus} openNote={openNote} createNote={()=>newNote()} follow={follow}/></Suspense></GraphBoundary></div>}
 {tab === 'Today' && <><div className="page-heading"><div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</div><h1>A little progress, every day<span className="indigo">.</span></h1><p>Connect your notes. Remember what matters.</p></div>
 <section className="hero"><div><span className="pill mint"><span className="green-dot"/> YOUR NEXT STUDY SPRINT</span><h2>{due.length ? 'Good things come from coming back.' : 'Your next idea starts here.'}</h2><p>{w.notes.length ? `You have ${due.length} cards ready to revisit. Take a breath, find your focus, and see what you remember.` : 'A home for your notes, and a thoughtful way to remember them. Start with one idea and build connections as you learn.'}</p><div className="actions">{(w.notes.length || w.cards.some(c=>c.life==='active')) ? <button className="primary" onClick={() => start()}>Start review <ArrowRight size={18}/></button> : <><button className="primary" onClick={() => newNote()}>Create your first note <ArrowRight size={18}/></button><button onClick={() => manual()}>Create a card</button></>}{w.notes.length > 0 && <span className="hero-caption">One card at a time. At your own pace.</span>}</div></div><div className="card-art" aria-hidden="true"><div className="art-back"/><div className="art-front"><div className="art-mini"><Network size={19}/><span>SMALL CONNECTIONS</span></div><div className="art-lines"><i /><i /></div><div className="art-line"/><div className="art-bottom"><span>Lasting knowledge.</span><span className="check-bubble"><Check size={20}/></span></div></div><span className="art-spark">✧</span></div></section>
 <div className="stats"><Stat icon={<Clock />} label="Due now" value={due.length} detail="Ready to revisit"/><Stat icon={<Layers />} label="New cards" value={fresh.length} detail={`${w.limit} daily introduction limit`}/><Stat icon={<Check />} label="Reviewed today" value={today.length} detail="Every recall is practice"/><Stat icon={<BookOpen />} label="Scheduled later" value={later.length} detail={later[0] ? `Next: ${date(later[0].schedule.due)}` : "Nothing scheduled yet"}/></div>
 <div className="dashboard-grid"><section><div className="section-heading"><h2>Your subjects <span className="number">{w.subjects.length}</span></h2><button className="text-button" onClick={() => subjectForm()}><Plus size={15}/>Add subject</button></div>{!w.subjects.length ? <div className="empty compact"><Network /><h3>Give your ideas a home.</h3><p>Subjects keep related notes and cards together.</p></div> : w.subjects.map(s => <div className="subject-card" key={s.id}><div className="subject-icon"><Network size={24}/></div><div className="grow"><h3>{s.name}</h3><p>{w.notes.filter(n => n.subject === s.id).length} notes <span>·</span> {w.cards.filter(c => c.subject === s.id && c.life === 'active').length} cards </p><div className="subject-status"><span className="dot"/>{due.filter(c => c.subject === s.id).length} due now <span className="muted">· {fresh.filter(c => c.subject === s.id).length} new</span></div></div><button className="round-button" aria-label={`Review ${s.name}`} onClick={() => start(s.id)}><ArrowUpRight size={20}/></button></div>)}<div className="tip"><Link2 size={20}/><div><strong>Better together.</strong><p>Link your ideas with [[Note Title]]. Every connection gives your knowledge a little more context.</p></div></div></section><section><div className="section-heading"><h2>Pick up where you left off</h2><button className="text-button" onClick={() => setTab('Notes')}>All notes <ArrowRight size={15}/></button></div><div className="recent-list">{[...w.notes].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 4).map(n => <button className="recent-row" key={n.id} onClick={() => openNote(n.id)}><div className="note-icon"><BookOpen size={18}/></div><div><strong>{n.title}</strong><small>{subjectName(n.subject)}</small></div><ChevronRight size={16}/></button>)}{!w.notes.length && <p className="empty">Your recent notes will appear here.</p>}</div><div className="draft-callout"><span className="soft-icon"><Sparkles size={20}/></span><div><h3>A second look, then a first review.</h3><p>{drafts.length} drafts waiting for your approval.</p><button className="text-button" onClick={() => { setFilter('draft'); setTab('Cards'); }}>Review drafts <ArrowRight size={15}/></button></div></div></section></div><footer><span><Leaf size={14}/> Built for understanding, not just memorising.</span><WorkspaceBackupButton label="Export workspace" className="text-button"/></footer></>}
 {tab === 'Notes' && <><div className="page-heading row"><div><div className="eyebrow">MAKE CONNECTIONS</div><h1>Your notes<span className="indigo">.</span></h1><p>A place to think things through.</p></div><div className="actions heading-actions"><button onClick={importNotes}><Upload size={16}/>Import Markdown</button><button disabled={!w.notes.some(n=>inSubject(w,n,subject))} onClick={()=>exportNotes(w,subject)}><Download size={16}/>{subject?'Export subject':'Export all'} (.zip)</button><button className="primary" onClick={() => newNote()}><Plus size={17}/>Create note</button></div></div><ImportProgress jobs={jobs} refresh={refreshImports} open={openNote}/><div className="notes-layout"><NoteTree w={w} selected={selected} folder={subject} search={search} onSearch={setSearch} onSelect={n => {trackedImport.current="";sessionStorage.removeItem("ss-tracked-import");setSelected(n.id);}} onFolder={id => setSubject(current => current === id ? '' : id)} onNewNote={id => newNote('', id)} onNewFolder={() => subjectForm()} onImport={importNotes} onExport={w.notes.some(n=>inSubject(w,n,subject))?()=>void exportNotes(w,subject):undefined} onMove={moveNote}/>{note ? <NoteEditor key={note.id+':'+editorRevision} conversionApplied={()=>conversionApplied(note.id)} note={note} w={w} ai={ai} queued={!!queuedOp} busy={busy} mutate={mutate} follow={follow} manual={manual} edit={setEditCard} localGraph={()=>openGraph(note.id)} remove={() => confirmDeleteNote(note)}/> : noteSummary ? <section className="empty" role="status"><p>{noteLoadError||'Opening your note…'}</p>{noteLoadError&&<button onClick={()=>setNoteAttempt(n=>n+1)}>Try again</button>}</section> : <section className="empty"><BookOpen size={36}/><h2>Follow a thought.</h2><p>Choose a note, or start a new one.</p><button onClick={() => newNote()}>Create note</button></section>}</div></>}
 {tab === 'Cards' && <><div className="page-heading row"><div><div className="eyebrow">KNOWLEDGE, IN PRACTICE</div><h1>Your card library<span className="indigo">.</span></h1><p>Small questions. Stronger connections.</p></div><button className="primary" onClick={() => manual()}><Plus size={17}/>Create card</button></div><div className="filters"><label className="search"><Search size={17}/><input aria-label="Search cards" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your cards…"/></label><select aria-label="Card state" value={filter} onChange={e => setFilter(e.target.value)}>{['all', 'draft', 'new', 'learning', 'review', 'suspended', 'archived', 'source changed', 'difficult'].map(s => <option key={s}>{s}</option>)}</select><select aria-label="Subject filter" value={subject} onChange={e => setSubject(e.target.value)}><option value="">All subjects</option>{w.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value={UNCATEGORISED}>Uncategorised</option></select><select aria-label="Source note filter" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}><option value="">All sources</option>{w.notes.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</select></div><div className="card-list">{w.cards.filter(c => inSubject(w, c, subject) && (!sourceFilter || c.note === sourceFilter) && `${c.front} ${c.answer}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || filter === c.life || filter === 'source changed' && changed(c, w) || filter === 'difficult' && difficult.includes(c) || c.life === 'active' && ({ new: c.schedule.state === 0, learning: c.schedule.state === 1 || c.schedule.state === 3, review: c.schedule.state === 2 } as any)[filter])).map(c => <article className="library-card" key={c.id}><div className="row"><span className={`pill ${c.life === 'draft' ? 'amber' : ''}`}>{c.life === 'active' ? ['New', 'Learning', 'Review', 'Relearning'][c.schedule.state] : c.life}</span><span className="muted small">{c.type}</span></div><h3>{c.front}</h3><p>{c.answer}</p><button className="source-link" onClick={() => setSource(c)}><Link2 size={14}/>{w.notes.find(n => n.id === c.note)?.title || (c.note ? 'Source unavailable' : 'No source linked')}</button>{changed(c, w) && <button className="source-warning" onClick={() => setSource(c)}>Note changed — check this card</button>}{c.life === 'active' && c.schedule.state !== 0 && <small className="due-label">Next review {date(c.schedule.due)}</small>}<div className="card-actions"><button onClick={() => setEditCard(c)}>Edit</button>{c.life === 'draft' ? <><button className="primary" disabled={busy} onClick={() => act('lifecycle', { id: c.id, life: 'active' })}>Approve</button><button onClick={() => act('lifecycle', { id: c.id, life: 'archived' })}>Reject</button></> : <button disabled={busy} onClick={() => act('lifecycle', { id: c.id, life: c.life === 'active' ? 'suspended' : 'active' })}>{c.life === 'active' ? 'Suspend' : 'Resume'}</button>}<button onClick={() => act('lifecycle', { id: c.id, life: 'archived' })}>Archive</button><button className="text-button danger-text" onClick={() => confirmAction('Delete card?', 'Its review events will remain in your progress history.', () => act('deleteCard', { id: c.id }))}>Delete</button></div></article>)}</div>{!w.cards.length && <div className="empty"><Layers size={36}/><h2>Turn an idea into a question.</h2><p>Create a card manually, or generate drafts from a note.</p></div>}</>}
 {tab === 'Review' && <div className="review-wrap"><div className="row"><button className="text-button" onClick={() => setTab('Today')}>← Back to Today</button><span className="muted">{session.length} attempts this session · {pending.length} available</span>{!finished&&<button className="text-button" onClick={()=>{setFinished(true);setRevealed(false);}}>Finish session</button>}</div>{current && !finished ? <><div className="review-top"><span className="pill">{subjectName(current.subject)}</span><span>{current.schedule.state === 0 ? 'NEW CARD' : 'RECALL PRACTICE'}</span></div><article className="review-card"><span className="eyebrow">{current.type === 'cloze' ? 'FILL IN THE GAP' : 'TAKE A MOMENT TO RECALL'}</span><h1>{current.front}</h1>{revealed ? <div className="answer"><span className="eyebrow">THE ANSWER</span><p>{current.answer}</p></div> : <button className="primary" onClick={() => setRevealed(true)}>Show answer <kbd>Space</kbd></button>}<button className="source-link" onClick={() => { setSource(current); if (!revealed)
        setNotice('Source opened as a hint. Rate honestly when you reveal the answer.'); }}><BookOpen size={16}/>View source</button></article>{revealed && <><div className="ratings">{labels.map((l, i) => <button className={`rating r${i}`} key={l} disabled={busy} onClick={() => void rating(i + 1)}><span><kbd>{i + 1}</kbd>{l}</span><small>{interval((preview(current) as any)[i + 1].card.due)}</small></button>)}</div><p className="review-hint">Forgotten or incorrect? Choose Again. Hard means correct with difficulty.</p></>}</> : <section className="completion"><span className="completion-icon"><Check size={30}/></span><h1>A good place to pause.</h1><p>{finished?'Session finished. Every review is saved.':'Nothing else is available right now. Your progress is saved.'}</p><div className="stats"><Stat label="Review attempts" value={sessionEvents.length}/><Stat label="Unique cards" value={new Set(sessionEvents.map(e => e.card)).size}/></div><div className="rating-summary">{labels.map((l, i) => <span key={l}><strong>{sessionEvents.filter(e => e.rating === i + 1).length}</strong>{l}</span>)}</div><p>{due.length} cards due across all subjects. {later[0] ? `Next review: ${date(later[0].schedule.due)}.` : 'Add a note or approve a draft to keep exploring.'}</p>{difficult.length > 0 && <button onClick={() => { setFilter('difficult'); setTab('Cards'); }}>Inspect {difficult.length} difficult cards</button>}<button className="primary" onClick={() => setTab('Today')}>Back to Today</button></section>}</div>}
 {tab === 'Focus' && <FocusTimer/>}
 {tab === 'Quiz' && <QuizTab key={quizLaunch ? JSON.stringify(quizLaunch) : 'list'} w={w} mutate={mutate} upload={uploadQuizzes} confirm={confirmAction} modal={setModal} launch={quizLaunch}/>}
 {tab === 'Insights' && <InsightsTab w={w} practise={(quiz, only) => { setQuizLaunch({ quiz, only }); setTab('Quiz'); }} edit={setEditCard} source={setSource} openQuiz={() => setTab('Quiz')} openCards={() => setTab('Cards')}/>}
 {tab === 'Settings' && <Settings w={w} ai={ai} user={user} pending={unsynced.length} busy={busy} mutate={mutate} importNotes={importNotes} importCards={importCards} uploadQuizzes={uploadQuizzes} imported={trackImport}/>}
 {tab === 'Progress' && <><div className="page-heading"><div className="eyebrow">THE BIGGER PICTURE</div><h1>Showing up adds up<span className="indigo">.</span></h1><p>A record of your practice. No streaks to protect.</p></div><div className="stats"><Stat label="Review attempts" value={w.events.length} detail="Saved recall ratings"/><Stat label="Cards introduced" value={new Set(w.events.filter(e => e.introduced).map(e => e.card)).size}/><Stat label="Reviewed today" value={today.length}/><Stat label="Scheduled for later" value={later.length}/></div><FocusProgress open={() => setTab('Focus')}/><QuizProgress w={w} openQuiz={() => setTab('Quiz')} openInsights={() => setTab('Insights')}/><div className="dashboard-grid"><section className="panel"><h2>Practice over the last 7 days</h2><div className="bars">{Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); const count = w.events.filter(e => day(e.at, w.zone) === day(d, w.zone)).length; return <div key={i}><span>{count}</span><div className="bar" style={{ height: `${Math.max(3, Math.min(150, count * 15))}px` }}/><small>{d.toLocaleDateString(undefined, { weekday: 'short' })}</small></div>; })}</div></section><section className="panel"><h2>Self-reported recall</h2><p>From your last 100 review attempts.</p>{labels.map((l, i) => <div className="distribution" key={l}><span>{l}</span><progress max={Math.max(1, w.events.slice(-100).length)} value={w.events.slice(-100).filter(e => e.rating === i + 1).length}/><strong>{w.events.slice(-100).filter(e => e.rating === i + 1).length}</strong></div>)}</section></div><section className="panel"><h2>Due by subject</h2>{w.subjects.map(s => <div className="history-row" key={s.id}><span>{s.name}</span><strong>{due.filter(c => c.subject === s.id).length} due</strong></div>)}</section><section className="panel"><h2>Recent review history</h2>{w.events.length === 0 ? <p>Your first review will appear here. Every count comes from your saved review attempts.</p> : [...w.events].reverse().slice(0, 20).map(e => <div className="history-row" key={e.id}><div><strong>{w.cards.find(c => c.id === e.card)?.front || 'Deleted card'}</strong><small>{date(e.at)} · Next review {date(e.due)}</small></div><span className="pill">{labels[e.rating - 1]}</span></div>)}</section><p className="muted small">Difficult cards have 3 or more saved Again ratings. These metrics describe practice, not mastery.</p></>}
 </main></div>
 {modal && <div className="overlay" onClick={() => setModal(undefined)}><div role="dialog" aria-modal="true" aria-label="Workspace action" className="modal" onClick={e => e.stopPropagation()}><button className="close icon" aria-label="Close dialog" onClick={() => setModal(undefined)}><X /></button>{error && <p role="alert" className="danger-text">{error}</p>}{modal}</div></div>}
 {editCard && <div className="overlay"><div role="dialog" aria-modal="true" aria-label="Edit flashcard" className="modal"><button className="close icon" aria-label="Close card editor" onClick={() => setEditCard(undefined)}><X /></button><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void mutate('card', { id: editCard.id || undefined, front: f.get('front'), answer: f.get('answer'), type: f.get('type'), note: f.get('note'), subject:f.get('subject'), excerpt: editCard.excerpt, reset: f.get('reset') === 'on' }).then(() => setEditCard(undefined)).catch(() => { }); }}><h2>{editCard.id ? 'Refine this card' : 'One idea, one card.'}</h2>{error && <p role="alert" className="danger-text">{error}</p>}<label>Type<select name="type" defaultValue={editCard.type}><option value="basic">Basic · question and answer</option><option value="cloze">Cloze · use one [...] gap</option></select></label><label>Prompt<textarea name="front" required defaultValue={editCard.front}/></label><label>Answer<textarea name="answer" required defaultValue={editCard.answer}/></label>{!editCard.id && <label>Subject<select name="subject" defaultValue={editCard.subject}><option value="">Uncategorised</option>{w.subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}{!editCard.id && <label>Source note (optional)<select name="note" defaultValue={editCard.note || ''}><option value="">No source</option>{w.notes.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</select></label>}{editCard.excerpt && <blockquote>{editCard.excerpt}</blockquote>}{editCard.id && <label className="checkbox"><input name="reset" type="checkbox"/>Reset learning progress for this edit (history stays saved)</label>}<button className="primary" disabled={busy}>Save card</button></form></div></div>}
 {source && <div className="sheet-overlay" onClick={() => setSource(undefined)}><aside className="source-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Supporting source"><div className="row"><span className="eyebrow">BACK TO THE SOURCE</span><button className="icon" aria-label="Close source" onClick={() => setSource(undefined)}><X /></button></div><h2>{w.notes.find(n => n.id === source.note)?.title || (source.note ? 'Source unavailable' : 'No source linked')}</h2><h3>Saved supporting passage</h3><blockquote>{source.excerpt || 'This manual card has no saved excerpt.'}</blockquote>{changed(source, w) && <div className="warning"><strong>Note changed — check this card.</strong><p>This is a conservative note-level flag. Compare the saved passage with the current note below.</p><button disabled={busy} onClick={() => void mutate('acknowledge', { id: source.id }).then(next => setSource(next.cards.find(c => c.id === source.id))).catch(() => { })}>Keep card & acknowledge</button><button onClick={() => setEditCard(source)}>Edit card</button><button onClick={() => { act('lifecycle', { id: source.id, life: 'archived' }); setSource(undefined); }}>Archive</button></div>}{w.notes.find(n => n.id === source.note) && <><h3>Current note</h3><CurrentNoteSource id={source.note!}/><button onClick={() => openNote(source.note!)}>Open note</button></>}<h3>Review history</h3>{w.events.filter(e => e.card === source.id).slice(-10).reverse().map(e => <p key={e.id}>{labels[e.rating - 1]} · {date(e.at)}<small className="block">Next review {date(e.due)}</small></p>)}</aside></div>}
 </div>;
}
function Stat({ icon, label, value, detail }: {
    icon?: ReactNode;
    label: string;
    value: number;
    detail?: string;
}) { return <div className="stat"><div className="row"><span>{label}</span>{icon}</div><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }
function NoteEditor({ note, w, ai, queued, busy, mutate, follow, manual, edit, remove, localGraph,conversionApplied }: {
    note: Note;
    w: WorkspaceSnapshot;
    ai: boolean;
    queued: boolean;
    busy: boolean;
    mutate: (a: string, p: any) => Promise<WorkspaceSnapshot>;
    follow: (s: string, n: Note|NoteSummary) => void;
    manual: (n: Note) => void;
    edit: (c: Card) => void;
    remove: () => void;
    localGraph: () => void;
    conversionApplied:()=>Promise<void>;
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
    const [tags, setTags] = useState<string[]>(recovery?.tags ?? note.tags ?? []);
    // The note was moved (e.g. dragged in the folder tree): adopt the new subject so the next autosave keeps it.
    const [knownSubject, setKnownSubject] = useState(note.subject);
    if (knownSubject !== note.subject) { setKnownSubject(note.subject); setSubject(note.subject); }
    const [mode, setMode] = useState(note.body ? 'Read' : 'Edit');
    const [view,setView]=useState<'markdown'|'original'|'split'>('markdown');
    useEffect(()=>{const query=matchMedia('(max-width: 800px)');const change=()=>{if(query.matches)setView(v=>v==='split'?'original':v);};change();query.addEventListener('change',change);return()=>query.removeEventListener('change',change);},[]);
    const [status, setStatus] = useState('Saved');
    const [selection, setSelection] = useState('');
    const [retry, setRetry] = useState(0);
    const saved = useRef({ title: note.title, body: note.body, subject: note.subject, tags: note.tags ?? [], updated:recovery?.updated??note.updated });
    const latest=useRef({title,body,subject,tags});latest.current={title,body,subject,tags};
    const text = useRef<HTMLTextAreaElement>(null);
    const failedSave=useRef('');
    // A newer server copy arrived (sync from another device, or an offline edit uploaded). Adopt its stamp so the next
    // autosave is not mistaken for a stale write, and show its text when nothing here is unsaved.
    useEffect(() => { const s = saved.current; if (note.updated === s.updated) return;
        const same = note.title === s.title && note.body === s.body && note.subject === s.subject && sameTags(note.tags, s.tags);
        const clean = latest.current.title === s.title && latest.current.body === s.body && latest.current.subject === s.subject && sameTags(latest.current.tags, s.tags);
        if (!same && !clean) return;
        saved.current = { title: note.title, body: note.body, subject: note.subject, tags: note.tags ?? [], updated: note.updated };
        if (!same) { setTitle(note.title); setBody(note.body); setSubject(note.subject); setTags(note.tags ?? []); } }, [note.updated]);
    useEffect(() => { if (title === saved.current.title && body === saved.current.body && subject === saved.current.subject && sameTags(tags, saved.current.tags))
        return; const signature=JSON.stringify({title,body,subject,tags,retry});if(failedSave.current===signature)return; sessionStorage.setItem(cacheKey, JSON.stringify({ title, body, subject, tags,updated:saved.current.updated })); if(new TextEncoder().encode(body).length>1048576){setStatus('Note too large — shorten to save');return;}setStatus('Saving…'); if(busy)return; const timer = setTimeout(() => { void mutate('note', { id: note.id, title, body, subject, tags,expectedUpdated:saved.current.updated }).then(next => { saved.current = { title, body, subject, tags, updated:next.notes.find(n=>n.id===note.id)!.updated }; if(latest.current.title===title&&latest.current.body===body&&latest.current.subject===subject&&sameTags(latest.current.tags,tags)){sessionStorage.removeItem(cacheKey);setStatus('Saved');}else{sessionStorage.setItem(cacheKey,JSON.stringify({...latest.current,updated:saved.current.updated}));if(new TextEncoder().encode(body).length>1048576){setStatus('Note too large — shorten to save');return;}setStatus('Saving…');} }).catch(() => {failedSave.current=signature;setStatus('Save failed — retry');}); }, 700); return () => clearTimeout(timer); }, [title, body, subject, tags, retry, busy]);
    useEffect(() => { function guard(e: BeforeUnloadEvent) { if (status !== 'Saved')
        e.preventDefault(); } window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [status]);
    const drafts = w.cards.filter(c => c.note === note.id && c.life === 'draft');
    const backlinks = w.notes.filter(n => n.id !== note.id && linksForNote(n).some(t => resolveLink(w, t, n).some(m => m.id === note.id)));
    const markdown = body.split(/(```[\s\S]*?```|`[^`]*`)/g).map((s, i) => i % 2 ? s : s.replace(/\[\[([^\]]+)\]\]/g, (_, t) => `[${t}](#note-${encodeURIComponent(t)})`)).join('');
    const generatedSource=selection||body;
    const generationTooLong=generatedSource.length>24000;
    const selectionMismatch=!!selection&&!body.includes(selection);
    const bodyBytes=new TextEncoder().encode(body).length;
    const markdownPanel=<div className="markdown-panel">{mode==='Edit'?<textarea className="markdown-editor" ref={text} aria-label="Markdown note body" value={body} placeholder="Start with an idea. Link it with [[Note Title]]." onChange={e=>{setBody(e.target.value);setSelection('');}} onSelect={()=>{const el=text.current;if(el)setSelection(el.value.slice(el.selectionStart,el.selectionEnd));}}/>:<div className="prose" onMouseUp={()=>setSelection(window.getSelection()?.toString()||'')}><Markdown remarkPlugins={[remarkGfm]} urlTransform={documentUrl(note.id)} components={{...mermaidComponents,img:DocumentImage,a:({href,children})=>href?.startsWith('#note-')?<button className="wikilink" onClick={()=>follow(decodeURIComponent(href.slice(6)),note)}>{children}</button>:<a href={href} rel="noopener noreferrer">{children}</a>}}>{markdown||'*An idea is a good place to start. Switch to Edit to write.*'}</Markdown></div>}</div>;
    return <><section className={'editor'+(view==='split'?' editor-split':'')}><div className="editor-toolbar"><button className="text-button" disabled={status!=='Saved'} onClick={localGraph}><Network size={14}/>View local graph</button><div className="segmented" aria-label="Note view">{['Read','Edit'].map(m=><button key={m} className={mode===m&&view!=='original'?'selected':''} onClick={()=>{setMode(m);if(view==='original')setView('markdown');}}>{m}</button>)}{note.source&&<><button className={view==='original'?'selected':''} onClick={()=>setView('original')}>Original</button><button className={'split-view-toggle'+(view==='split'?' selected':'')} onClick={()=>setView(view==='split'?'markdown':'split')}>Split view</button></>}</div><button className="save-status" onClick={()=>setRetry(r=>r+1)}>{status==='Saved'&&!queued&&<Check size={13}/>} {status==='Saved'&&queued?'Saved on this device — waiting to sync':status}</button></div><label className="sr-only" htmlFor="note-title">Note title</label><input id="note-title" className="note-title" value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/><div className="note-meta"><select aria-label="Note subject" value={w.subjects.some(s=>s.id===subject)?subject:''} onChange={e=>setSubject(e.target.value)}>{w.subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}<option value="">Uncategorised</option></select><span>Edited {date(note.updated)}</span></div>
    <TagInput tags={tags} onChange={setTags} suggestions={allTags(w)}/>
    {bodyBytes>1048576&&<p role="alert" className="warning">This note exceeds 1 MiB of Markdown. Shorten it before saving; your text has not been truncated.</p>}
    <div className={'note-content'+(view==='split'?' note-split':'')}>{view!=='original'&&markdownPanel}{view!=='markdown'&&note.source&&<Suspense fallback={<p role="status">Loading document reader…</p>}><SourceReader noteId={note.id} source={note.source}/></Suspense>}</div>
    {note.source&&<ImproveConversion note={note} applied={conversionApplied} disabled={busy||status!=='Saved'}/>}
    {note.versions&&note.versions.length>0&&<details className="note-history"><summary>Version history · {note.versions.length} saved revisions</summary>{[...note.versions].reverse().map(v=><Revision key={v.version} noteId={note.id} version={v} disabled={busy||status!=='Saved'} restore={value=>{setBody(value);setMode('Edit');setView('markdown');}}/>)}</details>}
    <div className="editor-bottom"><button className="text-button" disabled={status!=='Saved'} onClick={()=>{if(note.assets?.length){const link=document.createElement('a');link.href='/api/markdown-bundle?note='+note.id;link.download=safeFileName(title)+'.zip';link.click();}else download(safeFileName(title)+'.md',noteToMarkdown({title,body},w.subjects.find(s=>s.id===subject)?.name),'text/markdown');}}>Export Markdown{note.assets?.length?' with images (.zip)':''}</button><span>{body.trim()?body.trim().split(/\s+/).length:0} words · Markdown supported</span><button className="text-button danger-text" onClick={remove}>Delete note</button></div></section>
    <aside className="connections"><div className="section-heading"><h3><Sparkles size={16}/> From notes to knowledge</h3></div><p>Turn {selection?'your selected passage':'this note'} into small moments of recall.</p>{selectionMismatch&&<p className="warning">Select this formatted passage in Edit so its Markdown stays linked to the source.</p>}{generationTooLong&&<p className="warning">This {selection?'selection':'note'} is long. Select a passage of up to 24,000 characters in Markdown Edit to create flashcards.</p>}<button className="primary full" disabled={busy||status!=='Saved'||!generatedSource.trim()||generationTooLong||selectionMismatch} onClick={()=>void mutate('generate',{id:note.id,source:generatedSource,method:'extractive'}).catch(()=>{})}><Layers size={15}/>Create cloze drafts</button><small>Hides a phrase in your own text. No invented answers. Edit and approve each draft.</small>{ai&&<button className="full" disabled={busy||status!=='Saved'||!generatedSource.trim()||generationTooLong||selectionMismatch} onClick={()=>void mutate('generate',{id:note.id,source:generatedSource,method:'ai'}).catch(()=>{})}><Sparkles size={15}/>Generate with AI</button>}<button className="full" disabled={busy||status!=='Saved'} onClick={()=>manual({...note,title,body:selection||(body.length<=24000?body:''),subject})}><Plus size={15}/>Create manually</button>{selection&&<button className="text-button" onClick={()=>setSelection('')}>Clear selected passage</button>}<div className="sidebar-divider"/><h3>Drafts <span className="number">{drafts.length}</span></h3>{drafts.map(c=><div className="draft-mini" key={c.id}><span className="pill amber">Needs your approval</span><h4>{c.front}</h4><p>{c.answer}</p><details><summary>Supporting passage</summary><blockquote>{c.excerpt}</blockquote></details><div className="actions"><button onClick={()=>edit(c)}>Edit</button><button className="primary" disabled={busy} onClick={()=>void mutate('lifecycle',{id:c.id,life:'active'}).catch(()=>{})}>Approve</button><button disabled={busy} onClick={()=>void mutate('lifecycle',{id:c.id,life:'archived'}).catch(()=>{})}>Reject</button></div></div>)}<div className="sidebar-divider"/><h3><Link2 size={16}/>Backlinks <span className="number">{backlinks.length}</span></h3>{backlinks.map(n=><button className="connection" key={n.id} onClick={()=>follow(n.title,n)}><BookOpen size={15}/>{n.title}<ArrowUpRight size={14}/></button>)}{!backlinks.length&&<p className="small">Notes that link here will appear here.</p>}<h3>Linked notes</h3>{[...new Set(links(body))].map(t=><button className="connection" key={t} onClick={()=>follow(t,note)}><Link2 size={15}/>{t}<ArrowUpRight size={14}/></button>)}<h3>Associated cards</h3>{w.cards.filter(c=>c.note===note.id&&c.life!=='draft').map(c=><button className="connection" key={c.id} onClick={()=>edit(c)}><Layers size={14}/><span>{c.front}{changed(c,w)&&<small className="danger-text">Note changed — check</small>}</span></button>)}</aside></>;

}

function Revision({noteId,version,disabled,restore}:{noteId:string;version:{version:number;at:string;body?:string};disabled:boolean;restore:(body:string)=>void}){
 const [body,setBody]=useState(version.body),[loading,setLoading]=useState(false),[error,setError]=useState('');
 async function load(){if(body!==undefined||loading)return;setLoading(true);setError('');try{const r=await fetch('/api/notes/'+encodeURIComponent(noteId)+'/revisions/'+version.version);const d=await r.json() as {body:string;error?:string};if(!r.ok)throw Error(d.error||'This revision could not load.');setBody(d.body);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 return <details className="revision" onToggle={e=>{if(e.currentTarget.open)void load();}}><summary>Version {version.version} · {date(version.at)}</summary>{loading&&<p role="status">Loading revision…</p>}{error&&<p role="alert">{error} <button onClick={()=>void load()}>Retry</button></p>}{body!==undefined&&<><pre>{body}</pre><button disabled={disabled} onClick={()=>{if(window.confirm('Restore this revision? Your current saved text will remain in version history.'))restore(body);}}>Restore this revision</button></>}</details>;
}
function CurrentNoteSource({id}:{id:string}){
 const [body,setBody]=useState<string>(),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setBody(undefined);setError('');fetch('/api/notes/'+encodeURIComponent(id),{signal:controller.signal}).then(async r=>{const d=await r.json() as {note:Note;error?:string};if(!r.ok)throw Error(d.error||'The current note could not load.');return d.note.body;}).then(setBody).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[id]);
 return error?<p role="alert">{error}</p>:body===undefined?<p role="status">Loading current note…</p>:<div className="prose"><Markdown remarkPlugins={[remarkGfm]} urlTransform={documentUrl(id)} components={{...mermaidComponents,img:DocumentImage}}>{body}</Markdown></div>;
}

const themeOptions:{value:ThemePreference;label:string;icon:typeof Sun}[]=[{value:'light',label:'Light',icon:Sun},{value:'dark',label:'Dark',icon:Moon},{value:'system',label:'System',icon:Monitor}];
function ThemeToggle(){const pref=useThemePreference();const i=themeOptions.findIndex(o=>o.value===pref);const current=themeOptions[i],next=themeOptions[(i+1)%themeOptions.length];const Icon=current.icon;
return <button className="theme-toggle" onClick={()=>setThemePreference(next.value)} aria-label={`Theme: ${current.label}. Switch to ${next.label}`} title={`Theme: ${current.label}`}><Icon size={16}/></button>;}
function Appearance(){const pref=useThemePreference();
return <section className="panel appearance"><h2>Appearance</h2><p>Saved in this browser. System follows your device setting.</p><div className="segmented" role="radiogroup" aria-label="Theme">{themeOptions.map(({value,label,icon:Icon})=><button key={value} role="radio" aria-checked={pref===value} className={pref===value?'selected':''} onClick={()=>setThemePreference(value)}><Icon size={14}/>{label}</button>)}</div></section>;}
function Settings({w,ai,user,pending,busy,mutate,importNotes,importCards,uploadQuizzes,imported}:{w:WorkspaceSnapshot;ai:boolean;user:User|null;pending:number;busy:boolean;mutate:(a:string,p:any)=>Promise<WorkspaceSnapshot>;importNotes:()=>void;importCards:()=>void;uploadQuizzes:()=>void;imported:(job:ImportJob)=>void}){
const [message,setMessage]=useState('');const [backup,setBackup]=useState<any>();const [fileError,setFileError]=useState('');
return <><div className="page-heading"><div className="eyebrow">YOUR WORKSPACE</div><h1>Make it yours.</h1><p>Study preferences, appearance, data portability, and generation.</p></div><Appearance/><div className="dashboard-grid"><section className="panel"><h2>Your study rhythm</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void mutate('settings',{limit:Number(f.get('limit')),zone:f.get('zone')}).then(()=>setMessage('Preferences saved.')).catch(()=>{});}}><label>New cards per day<input name="limit" type="number" min="0" max="100" defaultValue={w.limit}/></label><label>Timezone<input name="zone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} required/></label><p className="small">Daily counts use {w.zone}. Due cards are always available regardless of the new-card limit.</p><button className="primary" disabled={busy}>Save preferences</button></form></section><section className="panel"><h2>Card generation</h2><p><strong>Cloze drafting is ready.</strong> It hides a phrase in your own sentences and saves editable drafts with exact source excerpts. It works without an AI service.</p><p>{ai?'AI generation is connected. Generate with AI is available in every note.':'AI generation is not connected. To enable it, set AI_API_KEY in the server environment and restart. AI_MODEL is optional. Never paste API keys into notes.'}</p></section></div><section className="panel"><h2>Manage subjects</h2><form onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const name=new FormData(form).get('name');void mutate('subject',{name}).then(()=>{form.reset();setMessage('Subject created.');}).catch(()=>{});}}><label>New subject<input name="name" required maxLength={100}/></label><button disabled={busy}>Add subject</button></form>{w.subjects.map(s=><form className="subject-settings" key={s.id} onSubmit={e=>{e.preventDefault();void mutate('subject',{id:s.id,name:new FormData(e.currentTarget).get('name')}).then(()=>setMessage('Subject renamed.')).catch(()=>{});}}><input aria-label={'Rename '+s.name} name="name" defaultValue={s.name} required maxLength={100}/><button disabled={busy}>Rename</button><button type="button" disabled={busy} className="danger-text" onClick={()=>{if(window.confirm('Delete this subject? Its notes will be kept as uncategorised. Cards, saved excerpts and review history will remain.'))void mutate('deleteSubject',{id:s.id}).then(()=>setMessage('Subject deleted.')).catch(()=>{});}}>Delete</button></form>)}</section><section className="panel"><h2>Your data, in your hands</h2><p>Export all subjects, notes, cards, schedules, and review history in a ZIP backup with uploaded documents, images and annotations. Importing adds data with fresh identifiers and preserves your existing work. Import a backup only once to avoid duplicate copies.</p><WorkspaceBackupButton/><BackupRestore imported={imported}/><label>Import a StudySprint backup<input type="file" accept=".json,application/json" onChange={async e=>{setFileError('');setBackup(undefined);const f=e.target.files?.[0];if(!f)return;if(f.size>2900000){setFileError('Choose a backup smaller than 2.9 MB.');return;}try{const data=JSON.parse(await f.text());if(data.format!=='studysprint'||data.version!==1)throw Error('Choose a StudySprint JSON backup.');setBackup(data);}catch(e){setFileError((e as Error).message);}}}/></label>{fileError&&<p role="alert" className="danger-text">{fileError}</p>}{backup&&<div className="warning"><p>Ready to import {backup.workspace?.notes?.length||0} notes and {backup.workspace?.cards?.length||0} cards. Existing data will be kept.</p><button disabled={busy} onClick={()=>void mutate('import',{backup}).then(()=>{setBackup(undefined);setMessage('Backup imported successfully.');}).catch(()=>{})}>Import backup</button><button onClick={()=>setBackup(undefined)}>Cancel</button></div>}<h3>Markdown notes</h3><p>Export every note as a .md file with title and subject front matter, grouped into one folder per subject in a .zip. Import .md files, folders, or .zip archives from StudySprint, Obsidian or any Markdown editor.</p><div className="actions"><button disabled={!w.notes.length} onClick={()=>exportNotes(w)}><Download size={16}/>Export all notes (.zip)</button><button onClick={importNotes}><Upload size={16}/>Import Markdown notes</button></div><h3>Flashcards</h3><p>Bring in cards in bulk from a CSV, TSV or text file, or paste them: the first column is the prompt and the second the answer. Works with Anki (Notes in Plain Text), Quizlet and spreadsheet exports, including Anki cloze deletions.</p><div className="actions"><button onClick={importCards}><Upload size={16}/>Import flashcards</button></div><h3>Quizzes</h3><p>Upload multiple-choice, true/false and typed-answer quizzes from a CSV spreadsheet or JSON file. Quizzes are grouped by subject in the Quiz tab, where you can practise them and review past attempts.</p><div className="actions"><button onClick={uploadQuizzes}><Upload size={16}/>Upload quiz</button><button onClick={downloadQuizTemplate}><Download size={16}/>Download template (.csv)</button></div><p className="small">Your workspace belongs to your account and opens on any device where you log in.</p></section>{user&&<section className="panel"><h2>Account</h2><p>Logged in as <strong>{user.name}</strong> ({user.email}).</p><button onClick={()=>{if(pending&&!window.confirm(`${pending} note ${pending===1?'change has':'changes have'} not synced yet. Logging out removes ${pending===1?'it':'them'} from this device. Log out anyway?`))return;void fetch('/api/auth/logout',{method:'POST'}).catch(()=>undefined).then(()=>{forgetUser(user.email);location.reload();});}}>Log out</button></section>}{message&&<p className="notice" role="status">{message}</p>}</>;
}

const IMPORT_LIMIT=2800000;
type User = { email: string; name: string };
const FEATURES = [[BookOpen, 'Linked Markdown notes', 'Write in Markdown, link ideas with [[Note Title]], and see backlinks and a graph of how your notes connect.'], [Layers, 'Cards from your own words', 'Turn any passage into cloze drafts that keep the exact source sentence. You approve every card.'], [Sun, 'Reviews that adapt', 'FSRS scheduling brings each card back right before you would forget it, with a daily limit on new cards.'], [Timer, 'Focus sessions', 'A built-in Pomodoro timer keeps study blocks short and steady.']] as const;
function Landing() {
    const [mode, setMode] = useState<'login' | 'signup'>('signup');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault(); setBusy(true); setError('');
        try {
            const r = await fetch('/api/auth/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });
            const d = await r.json().catch(() => ({ error: 'Something went wrong. Please try again.' })) as { error?: string };
            if (!r.ok) throw Error(d.error);
            location.reload();
        }
        catch (err) { setError((err as Error).message); setBusy(false); }
    }
    const choose = (m: 'login' | 'signup') => { setMode(m); setError(''); document.getElementById('auth')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    return <div className="landing">
        <header className="landing-top"><span className="brand"><span className="brandmark"><Layers size={21}/></span>StudySprint<span className="brand-dot">.</span></span><div className="actions"><button className="text-button" onClick={() => choose('login')}>Log in</button><button className="primary" onClick={() => choose('signup')}>Sign up</button></div></header>
        <section className="landing-hero">
            <div className="landing-copy"><span className="pill"><Sparkles size={12}/>YOUR NOTES, REMEMBERED</span><h1>Connect your notes.<br/><span className="indigo">Remember what matters.</span></h1><p>StudySprint turns the material you already study into linked notes and flashcards, then schedules short reviews so it sticks.</p><ul className="landing-points">{['Your own private workspace', 'Open it on any device', 'Export everything any time'].map(t => <li key={t}><Check size={15}/>{t}</li>)}</ul></div>
            <section className="panel auth-card" id="auth">
                <div className="segmented" role="tablist">{(['signup', 'login'] as const).map(m => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'selected' : ''} onClick={() => { setMode(m); setError(''); }}>{m === 'signup' ? 'Sign up' : 'Log in'}</button>)}</div>
                <h2>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
                <form key={mode} onSubmit={submit}>
                    {mode === 'signup' && <label>Name<input name="name" autoComplete="name" required maxLength={100}/></label>}
                    <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>
                    <label>Password<input name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 8 : 1} maxLength={200}/></label>
                    {mode === 'signup' && <p className="small">At least 8 characters.</p>}
                    {error && <p role="alert" className="danger-text">{error}</p>}
                    <button className="primary full-width" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}</button>
                </form>
                <p className="small">{mode === 'signup' ? <>Already have an account? <button className="text-button" onClick={() => choose('login')}>Log in</button></> : <>New to StudySprint? <button className="text-button" onClick={() => choose('signup')}>Create an account</button></>}</p>
            </section>
        </section>
        <section className="landing-features">{FEATURES.map(([Icon, title, text]) => <div className="panel" key={title}><span className="subject-icon"><Icon size={18}/></span><h3>{title}</h3><p>{text}</p></div>)}</section>
        <footer className="landing-footer"><span><Leaf size={14}/>A little, often.</span><span>StudySprint</span></footer>
    </div>;
}
const sameTags = (a: string[] | undefined, b: string[] | undefined) => (a ?? []).join('\n') === (b ?? []).join('\n');
// Tag entry with a styled suggestion list of tags already used in the workspace (a <datalist> cannot be styled).
function TagInput({ tags, onChange, suggestions }: { tags: string[]; onChange: (tags: string[]) => void; suggestions: { tag: string; count: number }[] }) {
    const [draft, setDraft] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const listId = useId();
    const full = tags.length >= MAX_TAGS;
    const q = draft.trim().replace(/^#+/, '').toLowerCase();
    const unused = suggestions.filter(s => !tags.some(t => t.toLowerCase() === s.tag.toLowerCase()));
    // Prefix matches before other matches; with nothing typed, the most used tags first.
    const options = (q ? [...unused.filter(s => s.tag.toLowerCase().startsWith(q)), ...unused.filter(s => !s.tag.toLowerCase().startsWith(q) && s.tag.toLowerCase().includes(q))] : [...unused].sort((a, b) => b.count - a.count)).slice(0, 8);
    const exact = options.findIndex(s => s.tag.toLowerCase() === q);
    const creating = !!q && exact < 0 && !tags.some(t => t.toLowerCase() === q) ? normalizeTags([draft])[0] : undefined;
    // Row 0 is "Create #…" when the typed tag is new, so Enter adds exactly what was typed unless a suggestion is chosen.
    const offset = creating ? 1 : 0, rows = options.length + offset;
    // -2 means "just typed": highlight Create, else the exact match, else the first suggestion.
    const current = active === -2 ? (creating ? 0 : Math.max(exact, 0)) : active;
    const add = (value: string) => { const known = suggestions.find(s => s.tag.toLowerCase() === value.trim().replace(/^#+/, '').toLowerCase()); const next = normalizeTags([...tags, ...(known ? [known.tag] : value.split(','))]); if (!sameTags(next, tags)) onChange(next); setDraft(''); setActive(-1); };
    const pick = (index: number) => { if (index >= offset && index < rows) add(options[index - offset].tag); else if (draft.trim()) add(draft); };
    const type = (value: string) => { if (value.includes(',')) return add(value); setDraft(value); setOpen(true); const nq = value.trim().replace(/^#+/, '').toLowerCase(); setActive(nq ? -2 : -1); };
    const show = open && !full && rows > 0;
    const mark = (tag: string) => { const at = q ? tag.toLowerCase().indexOf(q) : -1; return at < 0 ? tag : <>{tag.slice(0, at)}<mark>{tag.slice(at, at + q.length)}</mark>{tag.slice(at + q.length)}</>; };
    return <div className="tag-field"><Tag size={13} aria-hidden="true"/>{tags.map(t => <span className="tag-chip" key={t}>#{t}<button className="icon" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter(x => x !== t))}><X size={11}/></button></span>)}
        <div className="tag-input">
            <input role="combobox" aria-label="Add a tag" aria-autocomplete="list" aria-expanded={show} aria-controls={listId} aria-activedescendant={show && current >= 0 ? `${listId}-${current}` : undefined} value={draft} disabled={full} placeholder={full ? `${MAX_TAGS} tags maximum` : tags.length ? 'Add tag' : 'Add tags…'} maxLength={40}
                onChange={e => type(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setActive(-1); if (draft.trim()) add(draft); }}
                onKeyDown={e => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); if (rows) setActive(current < 0 ? (e.key === 'ArrowDown' ? 0 : rows - 1) : (current + (e.key === 'ArrowDown' ? 1 : rows - 1)) % rows); }
                    else if (e.key === 'Enter' && (draft.trim() || (show && current >= 0))) { e.preventDefault(); pick(show ? current : -1); }
                    else if (e.key === 'Escape' && show) { e.preventDefault(); setOpen(false); setActive(-1); }
                    else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1)); }}/>
            {show && <ul className="tag-menu" role="listbox" id={listId} aria-label="Tag suggestions">
                {creating && <li id={`${listId}-0`} role="option" aria-selected={current === 0} className={`tag-create${current === 0 ? ' active' : ''}`} onMouseDown={e => { e.preventDefault(); add(draft); }} onMouseEnter={() => setActive(0)}><Plus size={13}/><span>Create <strong>#{creating}</strong></span></li>}
                {options.map((s, i) => <li key={s.tag} id={`${listId}-${i + offset}`} role="option" aria-selected={current === i + offset} className={current === i + offset ? 'active' : ''} onMouseDown={e => { e.preventDefault(); add(s.tag); }} onMouseEnter={() => setActive(i + offset)}><span>#{mark(s.tag)}</span><small>{s.count} {s.count === 1 ? 'note' : 'notes'}</small></li>)}
            </ul>}
        </div></div>;
}
const CARD_FILE_LIMIT = 2800000;
// Bulk flashcard import: a file or pasted text is parsed here for a preview, then validated and saved on the server.
function CardImport({ w, mutate, done }: { w: WorkspaceSnapshot; mutate: (a: string, p: any) => Promise<WorkspaceSnapshot>; done: (message: string) => void }) {
    const [mode, setMode] = useState<'file' | 'paste'>('file');
    const [file, setFile] = useState<{ name: string; text: string }>();
    const [pasted, setPasted] = useState('');
    const [fileError, setFileError] = useState('');
    const [subject, setSubject] = useState(w.subjects[0]?.id || '');
    const [newSubject, setNewSubject] = useState('');
    const [life, setLife] = useState<'active' | 'draft'>('active');
    const [saving, setSaving] = useState(false);
    const text = mode === 'file' ? file?.text || '' : pasted;
    const parsed = useMemo(() => text.trim() ? parseCards(text) : undefined, [text]);
    // Cards already in the workspace, or repeated in this file, are left out of the import.
    const { fresh, duplicates } = useMemo(() => { const seen = new Set(w.cards.map(cardKey)), fresh: ParsedCard[] = []; let duplicates = 0; for (const c of parsed?.cards || []) { const k = cardKey(c); if (seen.has(k)) duplicates++; else { seen.add(k); fresh.push(c); } } return { fresh, duplicates }; }, [parsed, w.cards]);
    const tooMany = fresh.length > MAX_IMPORT_CARDS;
    async function choose(f: File | undefined) { setFileError(''); setFile(undefined); if (!f) return; if (f.size > CARD_FILE_LIMIT) return setFileError('Choose a file smaller than 2.8 MB, or split it into batches.'); if (!/\.(csv|tsv|txt|tab)$/i.test(f.name) && !/^text\//.test(f.type)) return setFileError('Choose a .csv, .tsv or .txt file. In Anki use File → Export → Notes in Plain Text.'); setFile({ name: f.name, text: await f.text() }); }
    const sep = parsed && ({ '\t': 'tabs', ',': 'commas', ';': 'semicolons', '|': 'pipes' } as Record<string, string>)[parsed.separator];
    const subjectLabel = subject === 'new' ? newSubject.trim() || 'a new subject' : w.subjects.find(s => s.id === subject)?.name || 'no subject';
    return <form className="card-import" onSubmit={e => { e.preventDefault(); if (saving || !fresh.length) return; setSaving(true); const before = w.cards.length;
        void mutate('importCards', { cards: fresh, subject: subject === 'new' ? undefined : subject, newSubject: subject === 'new' ? newSubject : undefined, life }).then(next => { const imported = next.cards.length - before; done(`Imported ${imported} ${imported === 1 ? 'flashcard' : 'flashcards'}${life === 'draft' ? ' as drafts to approve in Cards' : ', ready to review'}${duplicates ? ` · skipped ${duplicates} already in your workspace` : ''}.`); }).catch(() => { }).finally(() => setSaving(false)); }}>
        <h2>Import flashcards.</h2>
        <p>One card per row: the prompt in the first column, the answer in the second. A header row such as <em>Front, Back</em> is skipped. A prompt with one <code>[...]</code>, or Anki’s <code>{'{{c1::answer}}'}</code>, becomes a cloze card.</p>
        <div className="segmented" role="tablist">{(['file', 'paste'] as const).map(m => <button type="button" key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'selected' : ''} onClick={() => setMode(m)}>{m === 'file' ? 'Upload a file' : 'Paste text'}</button>)}</div>
        {mode === 'file' ? <div className="actions"><label className="file-button"><Upload size={15}/>{file ? 'Choose another file' : 'Choose file'}<input type="file" accept=".csv,.tsv,.txt,.tab,text/csv,text/tab-separated-values,text/plain" onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }}/></label>{file && <span className="small">{file.name}</span>}</div>
            : <label>Cards<textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={7} placeholder={'What does TCP stand for?\tTransmission Control Protocol\nThe [...] layer routes packets\tnetwork'} spellCheck={false}/><small>Separate prompt and answer with a tab (as copied from a spreadsheet), a comma or a semicolon.</small></label>}
        {fileError && <p role="alert" className="danger-text">{fileError}</p>}
        <div className="card-import-options">
            <label>Subject<select value={subject} onChange={e => setSubject(e.target.value)}>{w.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="">No subject</option><option value="new">New subject…</option></select></label>
            {subject === 'new' && <label>New subject name<input value={newSubject} onChange={e => setNewSubject(e.target.value)} required maxLength={100} placeholder="e.g. Spanish vocabulary"/></label>}
            <label>Add cards as<select value={life} onChange={e => setLife(e.target.value as 'active' | 'draft')}><option value="active">Ready to review</option><option value="draft">Drafts to approve first</option></select></label>
        </div>
        {parsed && <>
            <p className="small" role="status"><strong>{fresh.length} {fresh.length === 1 ? 'card' : 'cards'} ready</strong>{sep ? ` · columns separated by ${sep}` : ''}{parsed.header ? ' · header row skipped' : ''}{duplicates ? ` · ${duplicates} already in your workspace` : ''}{parsed.problems.length ? ` · ${parsed.problems.length} ${parsed.problems.length === 1 ? 'row' : 'rows'} skipped` : ''}</p>
            {fresh.length > 0 && <div className="card-preview" tabIndex={0} aria-label="Cards to import"><table><thead><tr><th>Prompt</th><th>Answer</th><th>Type</th></tr></thead><tbody>{fresh.slice(0, 100).map((c, i) => <tr key={i}><td>{c.front}</td><td>{c.answer}</td><td>{c.type === 'cloze' ? 'Cloze' : 'Basic'}</td></tr>)}</tbody></table>{fresh.length > 100 && <p className="small muted">…and {fresh.length - 100} more</p>}</div>}
            {parsed.problems.length > 0 && <details className="card-problems"><summary>{parsed.problems.length} {parsed.problems.length === 1 ? 'row was' : 'rows were'} skipped</summary><ul>{parsed.problems.slice(0, 50).map((p, i) => <li key={i}>Line {p.row}: {p.reason}</li>)}</ul></details>}
            {!fresh.length && <p role="alert" className="danger-text">{parsed.cards.length ? 'Every card here is already in your workspace.' : 'No cards were found. Check that each row has a prompt and an answer.'}</p>}
            {tooMany && <p role="alert" className="danger-text">Import up to {MAX_IMPORT_CARDS.toLocaleString('en')} cards at a time; this has {fresh.length.toLocaleString('en')}.</p>}
        </>}
        <button className="primary" disabled={saving || !fresh.length || tooMany}><Upload size={16}/>{saving ? 'Importing…' : fresh.length ? `Import ${fresh.length} ${fresh.length === 1 ? 'card' : 'cards'} into ${subjectLabel}` : 'Import cards'}</button>
    </form>;
}
