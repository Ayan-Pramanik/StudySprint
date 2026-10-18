import {z} from 'zod';
import {validateNoteBody, normalizeTags, type Note, type Workspace} from './study.ts';
// Markdown note import/export. Front matter carries the title, subject and tags so exports round-trip;
// other front matter keys (aliases and the like from other apps) are left in the note body untouched.
export type MarkdownFile = {path: string; content: string};
export type ParsedNote = {title: string; body: string; subject?: string; tags?: string[]};
const quote = (v: string) => JSON.stringify(v);
function unquote(v: string) { v = v.trim(); if (v.startsWith('"')) { try { return String(JSON.parse(v)); } catch { return v.slice(1, -1); } } if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'"); return v; }
export function noteToMarkdown(n: Pick<Note, 'title' | 'body' | 'tags'>, subject?: string) { return `---\ntitle: ${quote(n.title)}\n${subject ? `subject: ${quote(subject)}\n` : ''}${n.tags?.length ? `tags: [${n.tags.map(quote).join(', ')}]\n` : ''}---\n\n${n.body}`; }
export function safeFileName(title: string) { return title.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150) || 'Untitled'; }
export function parseMarkdownNote(path: string, text: string, folderSubjects = true): ParsedNote {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    const file = parts.pop() || 'Untitled.md';
    const result: ParsedNote = {title: file.replace(/\.(md|markdown)$/i, '').trim() || 'Untitled', body: text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')};
    if (folderSubjects && parts.length) result.subject = parts[parts.length - 1];
    const front = result.body.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
    if (front) {
        const kept: string[] = [], lines = front[1].split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Tags as `tags: [a, b]`, `tags: a, b`, or a YAML list of `  - a` lines, as Obsidian writes them.
            const tags = line.match(/^tags:\s*(.*)$/);
            if (tags) {
                const items = tags[1].trim() ? tags[1].trim().replace(/^\[|\]$/g, '').split(',') : [];
                while (!tags[1].trim() && /^\s+-\s*/.test(lines[i + 1] ?? '')) items.push(lines[++i].replace(/^\s+-\s*/, ''));
                result.tags = normalizeTags(items.map(unquote));
                continue;
            }
            const m = line.match(/^(title|subject):\s*(.*)$/);
            if (m && unquote(m[2])) result[m[1] as 'title' | 'subject'] = unquote(m[2]); else kept.push(line);
        }
        const rest = result.body.slice(front[0].length).replace(/^\n+/, '');
        result.body = kept.some(l => l.trim()) ? `---\n${kept.join('\n')}\n---\n\n${rest}` : rest;
    }
    result.title = result.title.trim().slice(0, 200) || 'Untitled';
    if (result.subject) result.subject = result.subject.trim().slice(0, 100) || undefined;
    return result;
}
// Files for a bulk export, grouped into one folder per subject, with unique file names.
export function notesToFiles(w: Workspace, notes = w.notes): MarkdownFile[] {
    const used = new Set<string>();
    return notes.map(n => {
        const subject = w.subjects.find(s => s.id === n.subject)?.name;
        const folder = safeFileName(subject || 'Uncategorised');
        const name = safeFileName(n.title);
        let path = `${folder}/${name}.md`;
        for (let i = 2; used.has(path.toLowerCase()); i++) path = `${folder}/${name} (${i}).md`;
        used.add(path.toLowerCase());
        return {path, content: noteToMarkdown(n, subject)};
    });
}
const importSchema = z.object({notes: z.array(z.object({title: z.string().trim().min(1).max(200), body: z.string().max(1048576).refine(v=>new TextEncoder().encode(v).length<=1048576, 'Note exceeds 1 MiB of text'), subject: z.string().trim().min(1).max(100).optional(), tags: z.array(z.string().max(200)).max(200).optional()})).min(1, 'Choose at least one Markdown file').max(1000), subject: z.string().max(100).optional(), newSubject: z.string().trim().max(100).optional()});
// Adds notes to the workspace. Subjects are matched by name (created when missing); notes without
// one use the chosen fallback subject, or stay uncategorised. Notes identical to an existing note are skipped.
export function importMarkdownNotes(w: Workspace, input: unknown) {
    const p = importSchema.parse(input);
    const byName = (name: string) => { if (/^uncategori[sz]ed$/i.test(name) && !w.subjects.some(s => s.name.toLowerCase() === name.toLowerCase())) return ''; let s = w.subjects.find(s => s.name.toLowerCase() === name.toLowerCase()); if (!s) { s = {id: crypto.randomUUID(), name}; w.subjects.push(s); } return s.id; };
    let fallback = p.subject && w.subjects.some(s => s.id === p.subject) ? p.subject : '';
    if (!fallback && p.newSubject) fallback = byName(p.newSubject);
    let imported = 0, skipped = 0;
    for (const n of p.notes) {
        validateNoteBody(n.body);
        const subject = n.subject ? byName(n.subject) : fallback;
        if (w.notes.some(x => x.subject === subject && x.title === n.title && x.body === n.body)) { skipped++; continue; }
        w.notes.push({id: crypto.randomUUID(), title: n.title, body: n.body, subject, ...(n.tags?.length ? {tags: normalizeTags(n.tags)} : {}), aliases: [], version: 1, updated: new Date().toISOString()});
        imported++;
    }
    return {imported, skipped};
}
// Minimal ZIP support: stored (uncompressed) archives for export; stored or deflated entries on import.
const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(data: Uint8Array) { let c = 0xffffffff; for (const b of data) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zip(files: MarkdownFile[], now = new Date()) {
    const enc = new TextEncoder(), local: Uint8Array[] = [], central: Uint8Array[] = [];
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.path), data = enc.encode(f.content), crc = crc32(data);
        const head = new Uint8Array(30 + name.length), h = new DataView(head.buffer);
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
        h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); head.set(name, 30);
        const dir = new Uint8Array(46 + name.length), d = new DataView(dir.buffer);
        d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true); d.setUint16(12, time, true); d.setUint16(14, date, true);
        d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); dir.set(name, 46);
        local.push(head, data); central.push(dir); offset += head.length + data.length;
    }
    const size = central.reduce((t, c) => t + c.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
    const out = new Uint8Array(offset + size + 22); let at = 0;
    for (const part of [...local, ...central, end]) { out.set(part, at); at += part.length; }
    return out;
}
async function inflate(data: Uint8Array) { const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return new Uint8Array(await new Response(stream).arrayBuffer()); }
export async function unzipMarkdown(bytes: Uint8Array, maxBytes = 2900000): Promise<MarkdownFile[]> {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw Error('This file is not a readable ZIP archive.');
    const count = v.getUint16(end + 10, true); let p = v.getUint32(end + 16, true);
    if (count === 0xffff || p === 0xffffffff) throw Error('ZIP64 archives are not supported.');
    const files: MarkdownFile[] = []; let total = 0;
    const utf8 = new TextDecoder();
    for (let i = 0; i < count; i++) {
        if (v.getUint32(p, true) !== 0x02014b50) throw Error('This ZIP archive is damaged.');
        const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), compressed = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
        const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true), offset = v.getUint32(p + 42, true);
        const path = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        if (!/\.(md|markdown)$/i.test(path) || /(^|\/)(__MACOSX|\.)[^/]*\//.test(path) || /(^|\/)\._/.test(path)) continue;
        if (flags & 1) throw Error('Encrypted ZIP archives are not supported.');
        if ((total += size) > maxBytes) throw Error(`Markdown files in this archive exceed ${(maxBytes / 1e6).toFixed(1)} MB.`);
        const start = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true), raw = bytes.subarray(start, start + compressed);
        if (method !== 0 && method !== 8) throw Error(`“${path}” uses an unsupported ZIP compression method.`);
        files.push({path, content: utf8.decode(method === 0 ? raw : await inflate(raw))});
    }
    return files;
}
