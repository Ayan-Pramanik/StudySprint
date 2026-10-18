import { createEmptyCard, fsrs, type Grade } from 'ts-fsrs';
import type { Quiz, QuizAttempt } from './quiz.ts';
export type Subject = {
    id: string;
    name: string;
};
export type Note = {
    id: string;
    subject: string;
    title: string;
    body: string;
    aliases: string[];
    bindings?: Record<string, string>;
    versions?: {
        version: number;
        body: string;
        at: string;
    }[];
    updated: string;
    version: number;
    tags?: string[];
};
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
    /** Absent in workspaces created before quizzes existed. */
    quizzes?: Quiz[];
    quizAttempts?: QuizAttempt[];
};
export const empty = (): Workspace => ({ subjects: [], notes: [], cards: [], events: [], limit: 10, zone: 'UTC' });
export const uid = () => crypto.randomUUID();
export const scheduler = fsrs({ enable_fuzz: false });
export function day(at: string | Date, zone: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(at)); }
export function queue(w: Workspace, now = new Date(), subject = '') { const introduced = w.events.filter(e => e.introduced && day(e.at, w.zone) === day(now, w.zone)).length; const active = w.cards.filter(c => c.life === 'active' && (!subject || c.subject === subject)); return [...active.filter(c => c.schedule.state !== 0 && new Date(c.schedule.due) <= now).sort((a, b) => +new Date(a.schedule.due) - +new Date(b.schedule.due)), ...active.filter(c => c.schedule.state === 0).slice(0, Math.max(0, w.limit - introduced))]; }
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
export function changed(c: Card, w: Workspace) { const n = w.notes.find(n => n.id === c.note); return !!n && n.version !== c.sourceVersion; }
export function links(body: string) { return [...body.replace(/```[\s\S]*?```|`[^`]*`/g, '').matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]); }
// Tags are short labels without spaces or a leading '#'. Duplicates are dropped case-insensitively, keeping the first spelling.
export const MAX_TAGS = 20, MAX_TAG_LENGTH = 40;
export function normalizeTags(input: unknown): string[] {
    const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
    const seen = new Set<string>(), tags: string[] = [];
    for (const value of raw) {
        if (typeof value !== 'string') continue;
        const tag = value.trim().replace(/^#+/, '').replace(/[\s,]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_TAG_LENGTH);
        if (tag && !seen.has(tag.toLowerCase()) && tags.length < MAX_TAGS) { seen.add(tag.toLowerCase()); tags.push(tag); }
    }
    return tags;
}
export const hasTag = (n: Pick<Note, 'tags'>, tag: string) => !!n.tags?.some(t => t.toLowerCase() === tag.toLowerCase());
/** Every tag in use with its note count, merged case-insensitively and sorted by name. */
export function allTags(w: Pick<Workspace, 'notes'>) { const counts = new Map<string, { tag: string; count: number }>(); for (const n of w.notes) for (const tag of n.tags || []) { const entry = counts.get(tag.toLowerCase()); if (entry) entry.count++; else counts.set(tag.toLowerCase(), { tag, count: 1 }); } return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' })); }
export function matches(w: Workspace, title: string, subject: string) { const found = w.notes.filter(n => n.title === title || n.aliases.includes(title)); const local = found.filter(n => n.subject === subject); return local.length ? local : found; }
export function makeCard(n: Note | undefined, front: string, answer: string, excerpt = '', life: Card['life'] = 'draft'): Card { return { id: uid(), subject: n?.subject || '', note: n?.id, front, answer, type: 'basic', excerpt, sourceVersion: n?.version || 0, checked: true, life, schedule: createEmptyCard() }; }
export function bindLinks(w: Workspace, n: Note) { n.bindings ||= {}; for (const title of links(n.body)) {
    if (n.bindings[title] && w.notes.some(x => x.id === n.bindings![title]))
        continue;
    delete n.bindings[title];
    const found = matches(w, title, n.subject);
    if (found.length === 1)
        n.bindings[title] = found[0].id;
} }
export function resolveLink(w: Workspace, title: string, n: Note) { const id = n.bindings?.[title]; return id ? w.notes.filter(x => x.id === id) : matches(w, title, n.subject); }
