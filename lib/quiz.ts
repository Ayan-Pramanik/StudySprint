import { z } from 'zod';
import { splitRows } from './card-import.ts';
import type { Workspace } from './study.ts';

// Quizzes: multiple-choice (one or several correct options) and typed-answer questions, grouped by subject.
// Files are parsed in the browser for a preview; the server validates them again and grades every attempt.

/** A question with two or more options is multiple choice (`correct` holds option indexes); otherwise it is typed and `accepted` lists the answers that count. */
export type QuizQuestion = { id: string; prompt: string; options: string[]; correct: number[]; accepted: string[]; explanation: string };
export type Quiz = { id: string; title: string; subject: string; questions: QuizQuestion[]; created: string; updated: string };
export type QuizAnswer = number[] | string;
export type QuizResult = { question: string; answer: QuizAnswer; correct: boolean };
export type QuizAttempt = { id: string; quiz: string; at: string; mode: 'practice' | 'test'; seconds: number; results: QuizResult[]; score: number; total: number };
export type DraftQuestion = Omit<QuizQuestion, 'id'>;
export type DraftQuiz = { title: string; subject?: string; questions: DraftQuestion[] };
export type QuizParse = { quizzes: DraftQuiz[]; problems: { where: string; reason: string }[] };

export const LIMITS = { quizzes: 100, questions: 500, options: 10, prompt: 2000, option: 500, explanation: 2000, title: 200, attempts: 2000 };
export const isChoice = (q: Pick<QuizQuestion, 'options'>) => q.options.length >= 2;
export const letter = (i: number) => String.fromCharCode(65 + i);

/** Typed answers match ignoring case, spacing and surrounding punctuation or quotes. */
export const normalizeAnswer = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/^["'“‘(\[]+|["'”’)\].,!?;:]+$/g, '').trim();
export function grade(q: QuizQuestion, answer: QuizAnswer | undefined) {
    if (isChoice(q)) return Array.isArray(answer) && answer.length === q.correct.length && q.correct.every(i => answer.includes(i));
    return typeof answer === 'string' && !!answer.trim() && q.accepted.some(a => normalizeAnswer(a) === normalizeAnswer(answer));
}
export const describeAnswer = (q: QuizQuestion, answer: QuizAnswer | undefined) => isChoice(q) ? (Array.isArray(answer) && answer.length ? answer.map(i => `${letter(i)}. ${q.options[i] ?? ''}`).join(', ') : 'No answer') : typeof answer === 'string' && answer.trim() ? answer : 'No answer';
export const describeCorrect = (q: QuizQuestion) => isChoice(q) ? q.correct.map(i => `${letter(i)}. ${q.options[i]}`).join(', ') : q.accepted.join(' or ');

const text = (v: unknown) => typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
const TRUE_FALSE = /^(true|false)$/i;

/**
 * Builds a question from loose input. Answers may be option letters ("B", "A,C"), option text, or indexes:
 * 0-based numbers in JSON, 1-based in spreadsheets (as Kahoot and similar templates use). A true/false answer
 * without options makes a True/False question; no options at all makes a typed answer ("Paris|paris city").
 */
export function makeQuestion(prompt: string, rawOptions: string[], rawAnswer: unknown, explanation: string, oneBased: boolean): DraftQuestion | string {
    if (!prompt) return 'The question is empty.';
    let options = rawOptions.map(o => o.trim()).filter(Boolean);
    const answers = (Array.isArray(rawAnswer) ? rawAnswer : [rawAnswer]).flatMap(a => typeof a === 'string' ? (options.length ? a.split(/\s*[,;|]\s*/) : [a]) : [a]).map(a => typeof a === 'string' ? a.trim() : a).filter(a => a !== '' && a !== undefined && a !== null);
    if (!answers.length) return 'There is no answer.';
    if (!options.length && answers.length === 1 && (typeof answers[0] === 'boolean' || TRUE_FALSE.test(text(answers[0])))) options = ['True', 'False'];
    if (options.length > LIMITS.options) return `Use at most ${LIMITS.options} options.`;
    if (prompt.length > LIMITS.prompt || options.some(o => o.length > LIMITS.option) || explanation.length > LIMITS.explanation) return 'The question, an option or the explanation is too long.';
    if (options.length === 1) return 'A multiple-choice question needs at least two options.';
    if (!options.length) {
        const accepted = [...new Set(answers.flatMap(a => text(a).split('|')).map(a => a.trim()).filter(Boolean))];
        return accepted.some(a => a.length > LIMITS.option) ? 'The answer is too long.' : { prompt, options: [], correct: [], accepted, explanation };
    }
    const correct = new Set<number>();
    for (const a of answers) {
        const value = text(a), byText = options.findIndex(o => o.toLowerCase() === value.toLowerCase());
        const index = byText >= 0 ? byText : typeof a === 'number' || /^\d+$/.test(value) ? Number(value) - (oneBased || typeof a !== 'number' ? 1 : 0) : /^[a-j]$/i.test(value) ? value.toUpperCase().charCodeAt(0) - 65 : -1;
        if (!(index >= 0 && index < options.length)) return `The answer “${value}” does not match an option.`;
        correct.add(index);
    }
    return { prompt, options, correct: [...correct].sort((x, y) => x - y), accepted: [], explanation };
}

function parseJson(data: unknown, fallbackTitle: string): QuizParse {
    const result: QuizParse = { quizzes: [], problems: [] };
    const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { quizzes?: unknown }).quizzes) ? (data as { quizzes: unknown[] }).quizzes : [data];
    // An array of questions (no `questions` key on its items) is a single quiz.
    const quizzes = list.every(q => q && typeof q === 'object' && Array.isArray((q as { questions?: unknown }).questions)) ? list as Record<string, unknown>[] : [{ title: fallbackTitle, questions: list }];
    quizzes.forEach((raw, qi) => {
        const title = text(raw.title ?? raw.name) || (quizzes.length > 1 ? `${fallbackTitle} ${qi + 1}` : fallbackTitle);
        const quiz: DraftQuiz = { title: title.slice(0, LIMITS.title), subject: text(raw.subject ?? raw.category) || undefined, questions: [] };
        ((raw.questions as unknown[]) || []).forEach((item, i) => {
            const q = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
            const options = Array.isArray(q.options ?? q.choices) ? ((q.options ?? q.choices) as unknown[]).map(text) : [];
            const made = makeQuestion(text(q.question ?? q.prompt ?? q.q), options, q.answer ?? q.correct ?? q.answers, text(q.explanation ?? q.explain), false);
            if (typeof made === 'string') result.problems.push({ where: `${title}, question ${i + 1}`, reason: made }); else quiz.questions.push(made);
        });
        result.quizzes.push(quiz);
    });
    return result;
}

const COLUMN = { question: /^(question|prompt|q)$/i, answer: /^(answers?|correct( answers?| options?)?|key|solution)$/i, explanation: /^(explanation|explain|reason|feedback|notes?)$/i, quiz: /^(quiz|quiz title|quiz name|title)$/i, subject: /^(subject|category|topic)$/i, option: /^((option|choice|answer)[ _-]?([a-j]|\d{1,2})|[a-j])$/i };

function parseTable(input: string, fallbackTitle: string): QuizParse {
    const body = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const first = body.split('\n').find(l => l.trim()) || '', count = (s: string) => first.split(s).length - 1;
    const rows = splitRows(body, count('\t') ? '\t' : count(';') > count(',') ? ';' : ',');
    const header = (rows[0] || []).map(h => h.trim());
    const find = (re: RegExp) => header.findIndex(h => re.test(h));
    const cols = { question: find(COLUMN.question), answer: find(COLUMN.answer), explanation: find(COLUMN.explanation), quiz: find(COLUMN.quiz), subject: find(COLUMN.subject) };
    const optionCols = header.map((h, i) => COLUMN.option.test(h) && i !== cols.answer ? i : -1).filter(i => i >= 0);
    const result: QuizParse = { quizzes: [], problems: [] };
    if (cols.question < 0 || cols.answer < 0) { result.problems.push({ where: 'Line 1', reason: 'Add a header row with at least “Question” and “Answer” columns (plus “Option A”, “Option B”… for multiple choice).' }); return result; }
    const byTitle = new Map<string, DraftQuiz>();
    rows.slice(1).forEach((cells, i) => {
        const cell = (c: number) => c >= 0 ? (cells[c] ?? '').trim() : '';
        if (!cells.some(c => c.trim())) return;
        const title = (cell(cols.quiz) || fallbackTitle).slice(0, LIMITS.title);
        let quiz = byTitle.get(title.toLowerCase());
        if (!quiz) { quiz = { title, subject: cell(cols.subject) || undefined, questions: [] }; byTitle.set(title.toLowerCase(), quiz); result.quizzes.push(quiz); }
        const made = makeQuestion(cell(cols.question), optionCols.map(cell), cell(cols.answer), cell(cols.explanation), true);
        if (typeof made === 'string') result.problems.push({ where: `Row ${i + 2}`, reason: made }); else quiz.questions.push(made);
    });
    return result;
}

/** Reads a CSV/TSV (with a header row) or JSON quiz file. */
export function parseQuizFile(input: string, fileName: string): QuizParse {
    const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.title);
    const fallbackTitle = base ? base[0].toUpperCase() + base.slice(1) : 'Imported quiz';
    let parsed: QuizParse;
    if (/\.json$/i.test(fileName) || /^\s*[[{]/.test(input)) {
        try { parsed = parseJson(JSON.parse(input), fallbackTitle); } catch { return { quizzes: [], problems: [{ where: fileName, reason: 'This is not valid JSON.' }] }; }
    } else parsed = parseTable(input, fallbackTitle);
    for (const q of parsed.quizzes) {
        if (!q.questions.length) parsed.problems.push({ where: q.title, reason: 'This quiz has no usable questions.' });
        if (q.questions.length > LIMITS.questions) parsed.problems.push({ where: q.title, reason: `A quiz can hold up to ${LIMITS.questions} questions.` });
    }
    parsed.quizzes = parsed.quizzes.filter(q => q.questions.length && q.questions.length <= LIMITS.questions);
    return parsed;
}

const questionSchema = z.object({ prompt: z.string().trim().min(1).max(LIMITS.prompt), options: z.array(z.string().trim().min(1).max(LIMITS.option)).max(LIMITS.options), correct: z.array(z.number().int().nonnegative()).max(LIMITS.options), accepted: z.array(z.string().trim().min(1).max(LIMITS.option)).max(50), explanation: z.string().max(LIMITS.explanation) })
    .refine(q => q.options.length === 0 ? q.accepted.length > 0 : q.options.length >= 2 && q.correct.length > 0 && q.correct.every(i => i < q.options.length), 'Each question needs a valid answer.');
const draftSchema = z.object({ title: z.string().trim().min(1, 'Each quiz needs a title.').max(LIMITS.title), subject: z.string().trim().max(100).optional(), questions: z.array(questionSchema).min(1).max(LIMITS.questions) });
const importSchema = z.object({ quizzes: z.array(draftSchema).min(1, 'There are no quizzes to import.').max(LIMITS.quizzes, `Import up to ${LIMITS.quizzes} quizzes at a time.`), subject: z.string().max(100).optional(), newSubject: z.string().trim().max(100).optional() });
/** Stored quizzes, as validated when a backup is restored. */
export const quizSchema = draftSchema.extend({ id: z.string().min(1).max(100), subject: z.string().max(100), created: z.string().max(40), updated: z.string().max(40), questions: z.array(questionSchema.and(z.object({ id: z.string().min(1).max(100) }))).min(1).max(LIMITS.questions) });
export const attemptSchema = z.object({ id: z.string().min(1).max(100), quiz: z.string().min(1).max(100), at: z.string().max(40), mode: z.enum(['practice', 'test']), seconds: z.number().int().nonnegative(), results: z.array(z.object({ question: z.string().max(100), answer: z.union([z.array(z.number().int()), z.string().max(LIMITS.option)]), correct: z.boolean() })).max(LIMITS.questions), score: z.number().int().nonnegative(), total: z.number().int().nonnegative() });

const subjectByName = (w: Workspace, name: string) => { let s = w.subjects.find(s => s.name.toLowerCase() === name.toLowerCase()); if (!s) { s = { id: crypto.randomUUID(), name }; w.subjects.push(s); } return s.id; };
const signature = (title: string, subject: string, questions: DraftQuestion[]) => JSON.stringify([title.toLowerCase(), subject, questions.map(q => [q.prompt, q.options, q.correct, q.accepted])]);

/** Adds uploaded quizzes. A subject named in the file wins over the chosen one; identical quizzes are skipped. */
export function importQuizzes(w: Workspace, input: unknown) {
    const p = importSchema.parse(input);
    w.quizzes ||= [];
    let fallback = p.subject && w.subjects.some(s => s.id === p.subject) ? p.subject : '';
    if (!fallback && p.newSubject) fallback = subjectByName(w, p.newSubject);
    const existing = new Set(w.quizzes.map(q => signature(q.title, q.subject, q.questions)));
    let imported = 0, skipped = 0, questions = 0;
    for (const draft of p.quizzes) {
        const subject = draft.subject ? subjectByName(w, draft.subject) : fallback;
        const key = signature(draft.title, subject, draft.questions);
        if (existing.has(key)) { skipped++; continue; }
        existing.add(key);
        const now = new Date().toISOString();
        w.quizzes.push({ id: crypto.randomUUID(), title: draft.title, subject, questions: draft.questions.map(q => ({ ...q, id: crypto.randomUUID() })), created: now, updated: now });
        imported++; questions += draft.questions.length;
    }
    return { imported, skipped, questions };
}

const attemptInput = z.object({ id: z.string().uuid(), quiz: z.string(), mode: z.enum(['practice', 'test']), seconds: z.number().int().nonnegative().max(86400 * 7), answers: z.record(z.union([z.array(z.number().int().nonnegative()).max(LIMITS.options), z.string().max(LIMITS.option)])) });
/** Grades and stores an attempt (all questions, or a retry of some). Repeating the same attempt id changes nothing. */
export function recordAttempt(w: Workspace, input: unknown): QuizAttempt {
    const p = attemptInput.parse(input);
    w.quizAttempts ||= [];
    const done = w.quizAttempts.find(a => a.id === p.id);
    if (done) return done;
    const quiz = w.quizzes?.find(q => q.id === p.quiz);
    if (!quiz) throw Error('Quiz unavailable');
    const results = quiz.questions.filter(q => q.id in p.answers).map(q => ({ question: q.id, answer: p.answers[q.id], correct: grade(q, p.answers[q.id]) }));
    if (!results.length) throw Error('Answer at least one question.');
    const attempt: QuizAttempt = { id: p.id, quiz: quiz.id, at: new Date().toISOString(), mode: p.mode, seconds: p.seconds, results, score: results.filter(r => r.correct).length, total: results.length };
    w.quizAttempts.push(attempt);
    if (w.quizAttempts.length > LIMITS.attempts) w.quizAttempts.splice(0, w.quizAttempts.length - LIMITS.attempts);
    return attempt;
}

/** A spreadsheet template for the upload dialog. */
export const TEMPLATE_CSV = ['Quiz,Subject,Question,Option A,Option B,Option C,Option D,Answer,Explanation',
    'Networking basics,Networking,Which layer routes packets between networks?,Transport,Network,Data link,Session,B,The network layer (IP) chooses paths between networks.',
    'Networking basics,Networking,Which protocols are connection-oriented?,TCP,UDP,SCTP,ICMP,"A,C",TCP and SCTP set up a connection first.',
    'Networking basics,Networking,What does DNS translate names into?,,,,,IP addresses|IP address,Typed answer: any listed alternative counts.',
    'Networking basics,Networking,HTTPS uses TLS.,,,,,True,'].join('\n') + '\n';
