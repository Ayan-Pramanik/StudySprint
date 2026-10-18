import { z } from 'zod';
import { makeCard, type Workspace } from './study.ts';

// Bulk flashcard import from delimited text: CSV, TSV, Anki's "Notes in Plain Text" export and Quizlet exports.
// The first column is the prompt and the second the answer; further columns are ignored. A prompt with exactly one
// [...] becomes a cloze card, and Anki cloze text ({{c1::answer}}) becomes one cloze card per deletion number.

export type ParsedCard = { front: string; answer: string; type: 'basic' | 'cloze' };
export type CardParse = { cards: ParsedCard[]; problems: { row: number; reason: string }[]; separator: string; header: boolean };
export const MAX_FIELD = 4000, MAX_IMPORT_CARDS = 5000;

/** RFC 4180-style rows: a field that starts with a quote may contain the separator, newlines and doubled quotes. */
export const splitRows = (text: string, sep: string) => records(text, sep).map(r => r.cells);
/** Rows with the (0-based) line each one starts on, so problems point at the right line of the file. */
function records(text: string, sep: string) {
    const rows: { cells: string[]; line: number }[] = [];
    let row: string[] = [], field = '', quoted = false, started = false, line = 0, first = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\n') line++;
        if (quoted) { if (ch !== '"') field += ch; else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; continue; }
        if (ch === '"' && !started) { quoted = true; started = true; }
        else if (ch === sep) { row.push(field); field = ''; started = false; }
        else if (ch === '\n') { row.push(field); rows.push({ cells: row, line: first }); row = []; field = ''; started = false; first = line; }
        else { field += ch; started = true; }
    }
    if (started || row.length) { row.push(field); rows.push({ cells: row, line: first }); }
    return rows;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Anki exports fields as HTML; keep line breaks and plain text. */
export const fromHtml = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const SEPARATORS: Record<string, string> = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', colon: ':', space: ' ' };
const HEADER_FRONT = /^(front|question|prompt|term|word|side ?1)$/i, HEADER_BACK = /^(back|answer|definition|meaning|side ?2)$/i;
const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g;

/** Expands Anki cloze text into one card per deletion number, revealing the other deletions. */
function anki(text: string): ParsedCard[] {
    const numbers = [...new Set([...text.matchAll(CLOZE)].map(m => m[1]))];
    return numbers.map(n => {
        const hidden: string[] = [];
        const front = text.replace(CLOZE, (_, k: string, answer: string) => k === n ? (hidden.push(answer), '[...]') : answer);
        // Our cloze cards hide one phrase; a number used several times becomes a basic card listing every answer.
        return { front, answer: hidden.join(', '), type: hidden.length === 1 ? 'cloze' : 'basic' };
    });
}

export function parseCards(input: string): CardParse {
    const lines = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    let separator = '', html = false, start = 0;
    // Anki file headers: #separator:tab, #html:true, #columns:…, #deck:… and similar.
    for (; start < lines.length; start++) {
        const m = lines[start].match(/^#([a-z ]+):(.*)$/i);
        if (!m) break;
        const key = m[1].trim().toLowerCase(), value = m[2].trim();
        if (key === 'separator') separator = SEPARATORS[value.toLowerCase()] ?? value.slice(0, 1);
        if (key === 'html') html = value.toLowerCase() === 'true';
    }
    const body = lines.slice(start).join('\n');
    // Otherwise guess from the first line: tabs (Anki, Quizlet), then semicolons (European CSV), then commas.
    if (!separator) { const first = lines.slice(start).find(l => l.trim()) || ''; const count = (s: string) => first.split(s).length - 1; separator = count('\t') ? '\t' : count(';') > count(',') ? ';' : count(',') ? ',' : '\t'; }
    const rows = records(body, separator);
    const looksHtml = html || /<(br|div|p|b|i|u|span|strong|em)\b[^>]*>|&(nbsp|amp|lt|gt);/i.test(body);
    const cell = (s: string | undefined) => { const v = (s ?? '').trim(); return looksHtml ? fromHtml(v) : v; };
    const result: CardParse = { cards: [], problems: [], separator, header: false };
    rows.forEach(({ cells, line }, i) => {
        const row = start + line + 1, front = cell(cells[0]), answer = cell(cells[1]);
        if (!front && !answer) return;
        if (i === 0 && HEADER_FRONT.test(front) && HEADER_BACK.test(answer)) { result.header = true; return; }
        const made: ParsedCard[] = /\{\{c\d+::/.test(front) ? anki(front) : [{ front, answer, type: (front.match(/\[\.\.\.\]/g) || []).length === 1 ? 'cloze' : 'basic' }];
        for (const c of made) {
            if (!c.front) result.problems.push({ row, reason: 'The prompt is empty.' });
            else if (!c.answer) result.problems.push({ row, reason: 'There is no answer in the second column.' });
            else if (c.front.length > MAX_FIELD || c.answer.length > MAX_FIELD) result.problems.push({ row, reason: `A side is longer than ${MAX_FIELD.toLocaleString('en')} characters.` });
            else result.cards.push(c);
        }
    });
    return result;
}

/** Duplicate check used by the preview and the server: same prompt and answer, ignoring case and spacing. */
export const cardKey = (c: { front: string; answer: string }) => [c.front, c.answer].map(s => s.toLowerCase().replace(/\s+/g, ' ').trim()).join('\u0000');

const schema = z.object({
    cards: z.array(z.object({ front: z.string().trim().min(1).max(MAX_FIELD), answer: z.string().trim().min(1).max(MAX_FIELD), type: z.enum(['basic', 'cloze']) })
        .refine(c => c.type !== 'cloze' || (c.front.match(/\[\.\.\.\]/g) || []).length === 1, 'A cloze prompt needs exactly one [...] placeholder.'))
        .min(1, 'There are no cards to import.').max(MAX_IMPORT_CARDS, `Import up to ${MAX_IMPORT_CARDS} cards at a time.`),
    subject: z.string().max(100).optional(), newSubject: z.string().trim().max(100).optional(), life: z.enum(['active', 'draft']),
});

/** Adds imported cards to the workspace, skipping ones it already has. Returns the counts for the summary. */
export function importCards(w: Workspace, input: unknown) {
    const p = schema.parse(input);
    let subject = p.subject && w.subjects.some(s => s.id === p.subject) ? p.subject : '';
    if (!subject && p.newSubject) { const name = p.newSubject; let s = w.subjects.find(s => s.name.toLowerCase() === name.toLowerCase()); if (!s) { s = { id: crypto.randomUUID(), name }; w.subjects.push(s); } subject = s.id; }
    const seen = new Set(w.cards.map(cardKey));
    let imported = 0, skipped = 0;
    for (const c of p.cards) {
        const key = cardKey(c);
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
        const card = makeCard(undefined, c.front, c.answer, '', p.life);
        card.type = c.type; card.subject = subject;
        w.cards.push(card);
        imported++;
    }
    return { imported, skipped };
}
