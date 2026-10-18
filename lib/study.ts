import { createEmptyCard, fsrs, type Grade } from 'ts-fsrs';
import type {DocumentAsset,ConversionInfo} from './documents';
export type Subject = {
    id: string;
    name: string;
};
export const UNLOADED_NOTE: unique symbol = Symbol('unloaded-note');
export type Note = {
    [UNLOADED_NOTE]?: true;
    id: string;
    subject: string;
    title: string;
    body: string;
    aliases: string[];
    bindings?: Record<string, string>;
    versions?: {
        version: number;
        body?: string;
        at: string;
    }[];
    updated: string;
    version: number;
    source?: SourceFile;
    assets?: DocumentAsset[];
    conversion?: ConversionInfo;
};
export type SourceFile = { id: string; name: string; mediaType: string; size: number; preview: 'pdf' | 'text'; derivedPreview: boolean; ocr: boolean };
export type NoteSummary = Omit<Note, 'body' | 'versions' | 'assets'> & { preview: string; linkTitles: string[]; versions?: { version: number; at: string }[] };
export type ImportJob = { id: string; name: string; title: string; kind: 'document' | 'restore' | 'reconvert' | 'prepare' | 'export'; status: 'queued' | 'processing' | 'ready' | 'failed' | 'cancelled'; noteId?: string; error?: string; updated: string; pendingApply?:boolean; appliedVersion?:number; expires?:string; annotationVersion?:number };
export type WorkspaceSnapshot = Omit<Workspace, 'notes'> & { notes: NoteSummary[] };
export type LinkedNote = Note | NoteSummary;
type StudyWorkspace = Omit<Workspace, 'notes'> & { notes: LinkedNote[] };
export const MAX_NOTE_BYTES = 1024 * 1024;
export function validateNoteBody(body: string) { if (new TextEncoder().encode(body).length > MAX_NOTE_BYTES) throw Error('This note exceeds 1 MiB of text. Split the document into smaller notes.'); return body; }
export function linksForNote(note: LinkedNote) { return UNLOADED_NOTE in note ? (note as unknown as NoteSummary).linkTitles : 'body' in note ? links(note.body) : note.linkTitles; }
export function notePreview(note: LinkedNote) { return UNLOADED_NOTE in note ? (note as unknown as NoteSummary).preview : 'body' in note ? note.body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>~]/g, '').replace(/\s+/g, ' ').trim().slice(0,240) : note.preview; }
export function summarizeNote(note: Note): NoteSummary { const { body, versions, assets, ...metadata } = note; return { ...metadata, preview: notePreview(note), linkTitles: [...new Set(links(body))], ...(versions ? { versions: versions.map(({version,at}) => ({version,at})) } : {}) }; }
export function snapshot(workspace: Workspace): WorkspaceSnapshot { return {...workspace,notes:workspace.notes.map(summarizeNote)}; }
export type Card = {
    id: string;
    subject: string;
    note?: string;
    front: string;
    answer: string;
    type: 'basic' | 'cloze';
    excerpt: string;
    sourceVersion: number;
    checked: boolean;
    life: 'draft' | 'active' | 'suspended' | 'archived';
    schedule: any;
};
export type Event = {
    id: string;
    card: string;
    rating: number;
    at: string;
    due: string;
    introduced: boolean;
};
export type Workspace = {
    subjects: Subject[];
    notes: Note[];
    cards: Card[];
    events: Event[];
    limit: number;
    zone: string;
};
export const empty = (): Workspace => ({ subjects: [], notes: [], cards: [], events: [], limit: 10, zone: 'UTC' });
export const uid = () => crypto.randomUUID();
export const scheduler = fsrs({ enable_fuzz: false });
export function day(at: string | Date, zone: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(at)); }
export function queue(w: StudyWorkspace, now = new Date(), subject = '') { const introduced = w.events.filter(e => e.introduced && day(e.at, w.zone) === day(now, w.zone)).length; const active = w.cards.filter(c => c.life === 'active' && (!subject || c.subject === subject)); return [...active.filter(c => c.schedule.state !== 0 && new Date(c.schedule.due) <= now).sort((a, b) => +new Date(a.schedule.due) - +new Date(b.schedule.due)), ...active.filter(c => c.schedule.state === 0).slice(0, Math.max(0, w.limit - introduced))]; }
export function preview(c: Card, now = new Date()) { return scheduler.repeat(c.schedule, now); }
export function rate(w: Workspace, id: string, rating: number, eventId: string, now = new Date()) {
    const previous=w.events.find(e=>e.id===eventId);
    if(previous){if(previous.card!==id||previous.rating!==rating)throw Error('This review identifier was already used for another rating.');return;}
    if (![1,2,3,4].includes(rating)) throw Error('Invalid rating');
    const c=w.cards.find(c=>c.id===id);
    const introducedToday=w.events.filter(e=>e.introduced&&day(e.at,w.zone)===day(now,w.zone)).length;
    if(!c||c.life!=='active'||(c.schedule.state===0?introducedToday>=w.limit:new Date(c.schedule.due)>now))throw Error('This card is no longer available for review.');
    const introduced=c.schedule.state===0;
    const result=scheduler.next(c.schedule,now,rating as Grade);
    c.schedule=result.card;
    w.events.push({id:eventId,card:id,rating,at:now.toISOString(),due:result.card.due.toISOString(),introduced});
}
export function changed(c: Card, w: StudyWorkspace) { const n = w.notes.find(n => n.id === c.note); return !!n && n.version !== c.sourceVersion; }
export function links(body: string) { return [...body.replace(/```[\s\S]*?```|`[^`]*`/g, '').matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]); }
export function matches(w: StudyWorkspace, title: string, subject: string) { const found = w.notes.filter(n => n.title === title || n.aliases.includes(title)); const local = found.filter(n => n.subject === subject); return local.length ? local : found; }
export function makeCard(n: Note | undefined, front: string, answer: string, excerpt = '', life: Card['life'] = 'draft'): Card { return { id: uid(), subject: n?.subject || '', note: n?.id, front, answer, type: 'basic', excerpt, sourceVersion: n?.version || 0, checked: true, life, schedule: createEmptyCard() }; }
export function bindLinks(w: Workspace, n: Note) { n.bindings ||= {}; for (const title of linksForNote(n)) {
    if (n.bindings[title] && w.notes.some(x => x.id === n.bindings![title]))
        continue;
    delete n.bindings[title];
    const found = matches(w, title, n.subject);
    if (found.length === 1)
        n.bindings[title] = found[0].id;
} }
export function resolveLink(w: StudyWorkspace, title: string, n: LinkedNote) { const id = n.bindings?.[title]; return id ? w.notes.filter(x => x.id === id) : matches(w, title, n.subject); }
