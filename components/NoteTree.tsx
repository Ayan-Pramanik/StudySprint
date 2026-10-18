'use client';
import { useRef, useState, type DragEvent } from 'react';
import { ArrowDownAZ, ChevronRight, ChevronsDownUp, ChevronsUpDown, Clock, Download, FileText, FolderPlus, Plus, Search, SquarePen, Upload } from 'lucide-react';
import type { Note, Workspace } from '../lib/study';
import { UNCATEGORISED } from '../lib/note-graph';

type Sort = 'name' | 'updated';
type Props = {
    w: Workspace;
    selected: string;
    /** Subject id of the active folder ('' for none); shared with the rest of the app's subject filter. */
    folder: string;
    search: string;
    onSearch: (q: string) => void;
    onSelect: (note: Note) => void;
    onFolder: (id: string) => void;
    onNewNote: (subject: string) => void;
    onNewFolder: () => void;
    onImport: () => void;
    /** Exports the active folder's notes, or every note when no folder is active; absent when there is nothing to export. */
    onExport?: () => void;
    /** Drop a note on a folder (subject id) or on the root (''). */
    onMove: (note: Note, subject: string) => void;
};
const ROOT = '\u0000root';

// Per-browser view preferences.
const KEY = 'studysprint-note-tree';
function readPrefs(): { collapsed: string[]; sort: Sort } {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return { collapsed: Array.isArray(v.collapsed) ? v.collapsed.filter((x: unknown) => typeof x === 'string') : [], sort: v.sort === 'updated' ? 'updated' : 'name' }; }
    catch { return { collapsed: [], sort: 'name' }; }
}
function savePrefs(collapsed: Set<string>, sort: Sort) { try { localStorage.setItem(KEY, JSON.stringify({ collapsed: [...collapsed], sort })); } catch { /* view still works */ } }

const byName = (a: { name?: string; title?: string }, b: { name?: string; title?: string }) => (a.name ?? a.title ?? '').localeCompare(b.name ?? b.title ?? '', undefined, { numeric: true, sensitivity: 'base' });

/** Folder view of the notes: subjects are folders, notes without a subject sit at the root. */
export function NoteTree({ w, selected, folder, search, onSearch, onSelect, onFolder, onNewNote, onNewFolder, onImport, onExport, onMove }: Props) {
    const [prefs] = useState(readPrefs);
    const [collapsed, setCollapsed] = useState(() => new Set(prefs.collapsed));
    const [sort, setSort] = useState<Sort>(prefs.sort);
    const update = (next: Set<string>, nextSort = sort) => { setCollapsed(next); setSort(nextSort); savePrefs(next, nextSort); };

    // Opening a note from elsewhere (a link, the graph, a card) reveals its folder.
    const selectedSubject = w.notes.find(n => n.id === selected)?.subject ?? '';
    const [revealed, setRevealed] = useState(selected);
    if (revealed !== selected) {
        setRevealed(selected);
        if (collapsed.has(selectedSubject)) { const next = new Set(collapsed); next.delete(selectedSubject); update(next); }
    }

    const q = search.trim().toLowerCase();
    // '#tag' finds notes with that tag; other text matches the title, body or tags.
    const matches = (n: Note) => !q || (q.startsWith('#') && q.length > 1 ? !!n.tags?.some(t => t.toLowerCase().startsWith(q.slice(1))) : `${n.title} ${n.body} ${(n.tags || []).join(' ')}`.toLowerCase().includes(q));
    const order = (notes: Note[]) => [...notes].sort(sort === 'name' ? byName : (a, b) => b.updated.localeCompare(a.updated));
    const known = new Set(w.subjects.map(s => s.id));
    const folders = [...w.subjects].sort(byName).map(s => ({ ...s, notes: order(w.notes.filter(n => n.subject === s.id && matches(n))), total: w.notes.filter(n => n.subject === s.id).length }));
    const loose = order(w.notes.filter(n => (!n.subject || !known.has(n.subject)) && matches(n)));
    const allCollapsed = folders.length > 0 && folders.every(f => collapsed.has(f.id));
    const toggle = (id: string) => { const next = new Set(collapsed); if (next.has(id)) next.delete(id); else next.add(id); update(next); };
    // Drag and drop between folders.
    const [dragId, setDragId] = useState(''), [dropTarget, setDropTarget] = useState('');
    const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const dragged = w.notes.find(n => n.id === dragId);
    const currentFolder = (n: Note) => n.subject && known.has(n.subject) ? n.subject : '';
    const endDrag = () => { clearTimeout(openTimer.current); setDragId(''); setDropTarget(''); };
    const over = (target: string) => (e: DragEvent) => {
        if (!dragged || currentFolder(dragged) === (target === ROOT ? '' : target)) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (dropTarget === target) return;
        setDropTarget(target);
        clearTimeout(openTimer.current);
        // Hovering a collapsed folder opens it, so the drop lands somewhere visible.
        if (target !== ROOT && collapsed.has(target)) openTimer.current = setTimeout(() => { const next = new Set(collapsed); next.delete(target); update(next); }, 600);
    };
    const leave = (target: string) => (e: DragEvent) => { if (dropTarget === target && !e.currentTarget.contains(e.relatedTarget as Node | null)) { clearTimeout(openTimer.current); setDropTarget(''); } };
    const drop = (target: string) => (e: DragEvent) => {
        if (!dragged) return;
        e.preventDefault(); e.stopPropagation();
        const subject = target === ROOT ? '' : target;
        if (subject && collapsed.has(subject)) { const next = new Set(collapsed); next.delete(subject); update(next); }
        if (currentFolder(dragged) !== subject) onMove(dragged, subject);
        endDrag();
    };
    const dropProps = (target: string) => ({ onDragOver: over(target), onDragEnter: over(target), onDragLeave: leave(target), onDrop: drop(target) });

    const visibleCount = folders.reduce((n, f) => n + f.notes.length, 0) + loose.length;

    const noteRow = (n: Note, depth: number) => <li key={n.id}><button draggable onDragStart={e => { e.dataTransfer.setData('text/plain', n.title); e.dataTransfer.effectAllowed = 'move'; setDragId(n.id); }} onDragEnd={endDrag}
        className={'tree-row tree-note' + (selected === n.id ? ' selected' : '') + (dragId === n.id ? ' dragging' : '')} style={{ paddingLeft: 10 + depth * 18 }} aria-current={selected === n.id ? 'page' : undefined} onClick={() => onSelect(n)} title={n.title}>
        <FileText size={14} aria-hidden="true"/><span>{n.title}</span></button></li>;

    return <section className="note-browser tree" aria-label="Notes">
        <div className="tree-toolbar" role="toolbar" aria-label="Note tools">
            <button className="icon" onClick={() => onNewNote(folder === UNCATEGORISED ? '' : folder)} aria-label="New note" title="New note"><SquarePen size={16}/></button>
            <button className="icon" onClick={onNewFolder} aria-label="New folder" title="New folder"><FolderPlus size={16}/></button>
            <button className="icon" onClick={() => update(collapsed, sort === 'name' ? 'updated' : 'name')} aria-label={sort === 'name' ? 'Sorted by name. Sort by last edited' : 'Sorted by last edited. Sort by name'} title={sort === 'name' ? 'Sorted A–Z' : 'Sorted by last edited'}>{sort === 'name' ? <ArrowDownAZ size={16}/> : <Clock size={16}/>}</button>
            <button className="icon" disabled={!folders.length} onClick={() => update(allCollapsed ? new Set() : new Set(folders.map(f => f.id)))} aria-label={allCollapsed ? 'Expand all folders' : 'Collapse all folders'} title={allCollapsed ? 'Expand all' : 'Collapse all'}>{allCollapsed ? <ChevronsUpDown size={16}/> : <ChevronsDownUp size={16}/>}</button>
            <button className="icon" onClick={onImport} aria-label="Import Markdown notes" title="Import Markdown"><Upload size={16}/></button>
            <button className="icon" disabled={!onExport} onClick={onExport} aria-label={folder ? 'Export this folder as .zip' : 'Export all notes as .zip'} title={folder ? 'Export folder (.zip)' : 'Export all (.zip)'}><Download size={16}/></button>
        </div>
        <label className="search"><Search size={16}/><input aria-label="Search notes" placeholder="Find a note…" value={search} onChange={e => onSearch(e.target.value)}/></label>
        <ul className={'tree' + (dropTarget === ROOT ? ' drop-target' : '')} {...dropProps(ROOT)}>
            {folders.map(f => {
                // While searching, folders with matches open and empty ones hide.
                if (q && !f.notes.length) return null;
                const open = q ? true : !collapsed.has(f.id);
                return <li key={f.id} className={'tree-folder' + (dropTarget === f.id ? ' drop-target' : '')} {...dropProps(f.id)}>
                    <div className={'tree-row tree-folder-row' + (folder === f.id ? ' active' : '')}>
                        <button className="tree-toggle" aria-expanded={open} onClick={() => { toggle(f.id); onFolder(f.id); }} title={f.name}>
                            <ChevronRight size={14} className={open ? 'open' : ''} aria-hidden="true"/><span>{f.name}</span><small>{f.total}</small></button>
                        <button className="icon tree-add" onClick={() => onNewNote(f.id)} aria-label={`New note in ${f.name}`} title="New note in this folder"><Plus size={14}/></button>
                    </div>
                    {open && (f.notes.length ? <ul>{f.notes.map(n => noteRow(n, 1))}</ul> : <p className="tree-empty">No notes yet</p>)}
                </li>;
            })}
            {loose.map(n => noteRow(n, 0))}
            {dragged && currentFolder(dragged) && <li className="tree-root-drop" aria-hidden="true">Drop here to take it out of its folder</li>}
        </ul>
        {q && !visibleCount && <p className="tree-empty">No notes match “{search}”.</p>}
        {!q && !w.notes.length && !w.subjects.length && <p className="tree-empty">Create a note or a folder to begin.</p>}
    </section>;
}
