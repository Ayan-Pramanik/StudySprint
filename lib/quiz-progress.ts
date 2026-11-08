import type { QuizAnswer } from './quiz';

/*
 * Unfinished quiz attempts, saved in this browser so an attempt survives switching to another
 * part of the app, closing the tab or reloading, and can be resumed where it was left.
 * One saved attempt per quiz; `active` is the attempt that was on screen when the Quiz tab was
 * left, which reopens straight away on coming back.
 */
export type Run = { quiz: string; order: string[]; mode: 'practice' | 'test'; index: number; answers: Record<string, QuizAnswer>; checked: Record<string, boolean>; started: number; id: string };
type SavedRun = Omit<Run, 'started'> & { elapsed: number; saved: string };
type Store = { active?: string; runs: Record<string, SavedRun> };

const KEY = 'ss-quiz-progress';
const MAX_RUNS = 30;

/** Storage is passed in so the logic can be tested without a browser. */
export type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;
const browser = (): KeyValue | undefined => { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } };

function read(storage = browser()): Store {
    try {
        const v = JSON.parse(storage?.getItem(KEY) || 'null');
        if (v && typeof v === 'object' && v.runs && typeof v.runs === 'object') return { active: typeof v.active === 'string' ? v.active : undefined, runs: v.runs };
    } catch { /* corrupt or unavailable: start fresh */ }
    return { runs: {} };
}
function write(store: Store, storage = browser()) {
    // Keep the most recently saved attempts if many quizzes were left unfinished.
    const runs = Object.entries(store.runs).sort((a, b) => b[1].saved.localeCompare(a[1].saved)).slice(0, MAX_RUNS);
    try { storage?.setItem(KEY, JSON.stringify({ active: store.active, runs: Object.fromEntries(runs) })); } catch { /* storage full or blocked: the attempt still works on this page */ }
}

/** Saves an attempt in progress; `active` marks it as the one to reopen when the Quiz tab opens. */
export function saveRun(run: Run, active: boolean, now = Date.now(), storage = browser()) {
    const store = read(storage);
    const { started, ...rest } = run;
    store.runs[run.quiz] = { ...rest, elapsed: Math.max(0, now - started), saved: new Date(now).toISOString() };
    if (active) store.active = run.quiz; else if (store.active === run.quiz) store.active = undefined;
    write(store, storage);
}

/** Forgets the saved attempt for a quiz (finished, or replaced by a new start). */
export function clearRun(quiz: string, storage = browser()) {
    const store = read(storage);
    if (!store.runs[quiz] && store.active !== quiz) return;
    delete store.runs[quiz];
    if (store.active === quiz) store.active = undefined;
    write(store, storage);
}

/** No attempt reopens automatically (the person went back to the quiz list). */
export function clearActive(storage = browser()) {
    const store = read(storage);
    if (store.active === undefined) return;
    store.active = undefined;
    write(store, storage);
}

export function activeQuiz(storage = browser()) { return read(storage).active; }

/**
 * The saved attempt for a quiz, made to fit the quiz as it is now: questions deleted since are
 * dropped, and time already spent carries on from `now`. Undefined when nothing usable is saved.
 */
export function loadRun(quiz: { id: string; questions: { id: string }[] }, now = Date.now(), storage = browser()): Run | undefined {
    const saved = read(storage).runs[quiz.id];
    if (!saved || !Array.isArray(saved.order) || typeof saved.id !== 'string' || (saved.mode !== 'practice' && saved.mode !== 'test')) return undefined;
    const ids = new Set(quiz.questions.map(q => q.id));
    const order = saved.order.filter(id => ids.has(id));
    if (!order.length) return undefined;
    const current = saved.order[saved.index];
    const index = Math.max(0, Math.min(order.length - 1, order.indexOf(current) >= 0 ? order.indexOf(current) : Number(saved.index) || 0));
    const answers = saved.answers && typeof saved.answers === 'object' ? saved.answers : {};
    const checked = saved.checked && typeof saved.checked === 'object' ? saved.checked : {};
    return { quiz: quiz.id, order, mode: saved.mode, index, answers, checked, id: saved.id, started: now - (Number(saved.elapsed) || 0) };
}

const filled = (a: QuizAnswer | undefined) => Array.isArray(a) ? a.length > 0 : typeof a === 'string' && !!a.trim();

/** How far an attempt got: answered (test) or checked (practice) questions. */
export function runProgress(run: Run) {
    const done = run.order.filter(id => run.mode === 'practice' ? run.checked[id] : filled(run.answers[id])).length;
    return { done, total: run.order.length };
}
