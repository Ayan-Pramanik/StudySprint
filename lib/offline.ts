import type { Workspace } from './study';

// Offline note editing. When the server cannot be reached, note saves become queued operations kept in this
// browser's localStorage (one outbox per account) and are uploaded, in order, once the server answers again.
// Only notes are queued: every other action needs the server to compute its result.

/** A pending note save. `base` is the server's `updated` stamp the edit started from; `create` marks a note made offline. */
export type NoteOp = { id: string; title: string; body: string; subject: string; tags?: string[]; base?: string; create?: boolean; at: string };

/** Adds an edit, collapsing it into an earlier queued edit of the same note while keeping that edit's base. */
export function mergeOp(ops: NoteOp[], op: NoteOp): NoteOp[] {
    const prior = ops.find(o => o.id === op.id);
    return prior ? ops.map(o => o === prior ? { ...op, base: prior.base, create: prior.create } : o) : [...ops, op];
}

/** Removes an uploaded edit, unless a newer edit of the same note was queued while it was uploading. */
export const removeOp = (ops: NoteOp[], op: NoteOp) => ops.filter(o => !(o.id === op.id && o.at === op.at));

/** The workspace as the user should see it: the server's copy with queued edits laid over it. */
export function applyOutbox(w: Workspace, ops: NoteOp[]): Workspace {
    if (!ops.length) return w;
    const notes = w.notes.map(n => { const o = ops.find(o => o.id === n.id); return o ? { ...n, title: o.title, body: o.body, subject: o.subject, ...(o.tags ? { tags: o.tags } : {}) } : n; });
    for (const o of ops)
        if (!notes.some(n => n.id === o.id)) notes.push({ id: o.id, title: o.title, body: o.body, subject: o.subject, tags: o.tags || [], aliases: [], version: 1, updated: o.base ?? o.at });
    return { ...w, notes };
}

/** Fetch failed outright, or a proxy/tunnel answered because the app server is down. */
export const unreachable = (r: Response | undefined) => !r || [502, 503, 504].includes(r.status) || (r.status >= 520 && r.status <= 530) || !r.headers.get('content-type')?.includes('application/json');

// Storage is best-effort: private windows or full quotas fall back to memory-only behaviour.
const read = <T>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };
export const loadOutbox = (user: string) => read<NoteOp[]>('ss-outbox:' + user, []);
export const saveOutbox = (user: string, ops: NoteOp[]) => write('ss-outbox:' + user, ops);
/** The last workspace received from the server, so the app can open while offline. */
export const loadCache = (user: string) => read<{ workspace: Workspace; version: number } | null>('ss-cache:' + user, null);
export const saveCache = (user: string, workspace: Workspace, version: number) => write('ss-cache:' + user, { workspace, version });
export const lastUser = () => read<{ email: string; name: string } | null>('ss-user', null);
export const rememberUser = (user: { email: string; name: string }) => write('ss-user', user);
/** Logging out removes this account's copy from the device. */
export function forgetUser(user: string) { try { ['ss-outbox:', 'ss-cache:'].forEach(k => localStorage.removeItem(k + user)); localStorage.removeItem('ss-user'); } catch { /* storage unavailable */ } }
