'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownWideNarrow, ArrowLeft, ArrowRight, ArrowUpNarrowWide, Check, CircleCheck, CircleX, Download, FolderOpen, History, LayoutGrid, List, ListChecks, MoreHorizontal, RotateCcw, Shuffle, Trophy, Upload } from 'lucide-react';
import { type Run, activeQuiz, clearActive, clearRun, loadRun, runProgress, saveRun } from '../lib/quiz-progress';
import { notify } from '../lib/notifications';
import { attemptXp } from '../lib/gamification';
import { type Picked, batches, readPicked } from '../lib/upload-files';
import type { WorkspaceSnapshot } from '../lib/study';
import { type DraftQuiz, type Quiz, type QuizAnswer, type QuizAttempt, type QuizParse, TEMPLATE_CSV, describeAnswer, describeCorrect, grade, isChoice, letter, parseQuizFile, LIMITS } from '../lib/quiz';

type Mutate = (action: string, data: object) => Promise<WorkspaceSnapshot>;
type View = { kind: 'list' } | { kind: 'setup'; quiz: string; only?: string[] } | { kind: 'run'; run: Run } | { kind: 'result'; attempt: QuizAttempt; saved: 'saving' | 'saved' | 'failed'; answers?: Record<string, QuizAnswer> } | { kind: 'history'; quiz: string };
const UNSORTED = '__none';
// How the quiz list is shown and sorted; remembered in this browser.
type Layout = 'tiles' | 'list';
type SortBy = 'name' | 'questions' | 'attempted' | 'best';
type ListPrefs = { layout: Layout; sort: SortBy; dir: 'asc' | 'desc' };
const PREFS_KEY = 'ss-quiz-list';
const SORTS: { value: SortBy; label: string }[] = [{ value: 'name', label: 'Name' }, { value: 'questions', label: 'Number of questions' }, { value: 'attempted', label: 'Last attempted' }, { value: 'best', label: 'Best score' }];
function readPrefs(): ListPrefs {
    try {
        const v = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        return { layout: v.layout === 'list' ? 'list' : 'tiles', sort: SORTS.some(s => s.value === v.sort) ? v.sort : 'name', dir: v.dir === 'desc' ? 'desc' : 'asc' };
    } catch { return { layout: 'tiles', sort: 'name', dir: 'asc' }; }
}
const percent = (score: number, total: number) => total ? Math.round(score / total * 100) : 0;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const plural = (n: number, word: string, many = word + 's') => `${n} ${n === 1 ? word : many}`;
function shuffled<T>(list: T[]) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export const downloadQuizTemplate = () => download('studysprint-quiz-template.csv', TEMPLATE_CSV, 'text/csv');

type QuizInfo = { q: Quiz; last?: QuizAttempt; best?: number };
const directionLabel = (p: ListPrefs) => p.sort === 'name' ? (p.dir === 'asc' ? 'A–Z' : 'Z–A') : p.sort === 'attempted' ? (p.dir === 'asc' ? 'Oldest first' : 'Newest first') : (p.dir === 'asc' ? 'Lowest first' : 'Highest first');
const byName = (a: QuizInfo, b: QuizInfo) => a.q.title.localeCompare(b.q.title, undefined, { numeric: true, sensitivity: 'base' });
/** Sorts quizzes; quizzes without a value (never attempted, no full-length score) always go last. */
export function sortQuizzes<T extends QuizInfo>(items: T[], { sort, dir }: Pick<ListPrefs, 'sort' | 'dir'>): T[] {
    const sign = dir === 'asc' ? 1 : -1;
    const value = (i: QuizInfo): number | string | undefined => sort === 'questions' ? i.q.questions.length : sort === 'attempted' ? i.last?.at : sort === 'best' ? i.best : undefined;
    return [...items].sort((a, b) => {
        if (sort === 'name') return sign * byName(a, b);
        const x = value(a), y = value(b);
        if (x === undefined || y === undefined) return x === y ? byName(a, b) : x === undefined ? 1 : -1;
        const order = typeof x === 'string' ? x.localeCompare(String(y)) : x - Number(y);
        return order ? sign * order : byName(a, b);
    });
}

export function QuizTab({ w, mutate, upload, confirm, modal, launch }: { w: WorkspaceSnapshot; mutate: Mutate; upload: () => void; confirm: (title: string, description: string, action: () => void) => void; modal: (node?: ReactNode) => void; /** Opens straight into a quiz's start screen, e.g. to practise questions picked in Insights. */ launch?: { quiz: string; only?: string[] } }) {
    const quizzes = w.quizzes || [], attempts = w.quizAttempts || [];
    // An attempt left open when switching away from Quiz (or reloading) reopens where it was.
    const [view, setView] = useState<View>(() => {
        if (launch) return { kind: 'setup', ...launch };
        const id = activeQuiz(), quiz = id && quizzes.find(q => q.id === id);
        const run = quiz ? loadRun(quiz) : undefined;
        return run ? { kind: 'run', run } : { kind: 'list' };
    });
    const [subject, setSubject] = useState('');
    const [prefs, setPrefsState] = useState<ListPrefs>(readPrefs);
    const setPrefs = (next: Partial<ListPrefs>) => setPrefsState(current => { const merged = { ...current, ...next }; try { localStorage.setItem(PREFS_KEY, JSON.stringify(merged)); } catch { /* still applies to this page */ } return merged; });
    // Every change to an attempt is saved; leaving the attempt for the list keeps it but stops it reopening by itself.
    const viewRef = useRef(view);
    useEffect(() => { viewRef.current = view; if (view.kind === 'run') saveRun(view.run, true); else clearActive(); }, [view]);
    useEffect(() => {
        // Also saved when the tab is hidden, the page closes, or the Quiz tab unmounts, so time spent is accurate.
        const flush = () => { const v = viewRef.current; if (v.kind === 'run') saveRun(v.run, true); };
        window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', flush);
        return () => { flush(); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', flush); };
    }, []);
    const byId = (id: string) => quizzes.find(q => q.id === id);
    const known = new Set(w.subjects.map(s => s.id));
    const groupOf = (q: Quiz) => q.subject && known.has(q.subject) ? q.subject : UNSORTED;

    function finish(run: Run) {
        const quiz = byId(run.quiz)!;
        const answers = Object.fromEntries(run.order.map(id => { const q = quiz.questions.find(q => q.id === id)!; return [id, run.answers[id] ?? (isChoice(q) ? [] : '')]; }));
        const results = run.order.map(id => ({ question: id, answer: answers[id], correct: grade(quiz.questions.find(q => q.id === id)!, answers[id]) }));
        const attempt: QuizAttempt = { id: run.id, quiz: quiz.id, at: new Date().toISOString(), mode: run.mode, seconds: Math.round((Date.now() - run.started) / 1000), results, score: results.filter(r => r.correct).length, total: results.length };
        clearRun(quiz.id);
        viewRef.current = { kind: 'list' };
        setView({ kind: 'result', attempt, saved: 'saving', answers });
        save(attempt, answers);
    }
    function save(attempt: QuizAttempt, answers: Record<string, QuizAnswer>) {
        void mutate('quizAttempt', { id: attempt.id, quiz: attempt.quiz, mode: attempt.mode, seconds: attempt.seconds, answers })
            .then(() => setView(v => v.kind === 'result' && v.attempt.id === attempt.id ? { ...v, saved: 'saved' } : v))
            .catch(() => setView(v => v.kind === 'result' && v.attempt.id === attempt.id ? { ...v, saved: 'failed' } : v));
    }
    function manage(quiz: Quiz) {
        modal(<form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void mutate('quiz', { id: quiz.id, title: f.get('title'), subject: f.get('subject') }).then(() => modal(undefined)).catch(() => { }); }}>
            <h2>Edit quiz</h2>
            <label>Title<input name="title" defaultValue={quiz.title} required maxLength={LIMITS.title} autoFocus/></label>
            <label>Subject<select name="subject" defaultValue={known.has(quiz.subject) ? quiz.subject : ''}>{w.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="">Uncategorised</option></select></label>
            <div className="actions"><button className="primary">Save</button><button type="button" className="danger-text" onClick={() => { modal(undefined); confirm('Delete this quiz?', `“${quiz.title}” and its ${plural(attempts.filter(a => a.quiz === quiz.id).length, 'saved attempt')} will be removed, along with the XP they earned. Badges you’ve unlocked stay.`, () => void mutate('deleteQuiz', { id: quiz.id }).catch(() => { })); }}>Delete quiz</button></div>
        </form>);
    }

    // Each view needs its quiz; one deleted meanwhile (here or on another device) falls through to the list.
    if (view.kind === 'setup') { const quiz = byId(view.quiz); if (quiz) return <QuizSetup quiz={quiz} only={view.only} saved={loadRun(quiz)} resume={run => setView({ kind: 'run', run: loadRun(quiz) ?? run })} back={() => setView({ kind: 'list' })} start={(mode, shuffle) => { const ids = view.only || quiz.questions.map(q => q.id); setView({ kind: 'run', run: { quiz: quiz.id, order: shuffle ? shuffled(ids) : ids, mode, index: 0, answers: {}, checked: {}, started: Date.now(), id: crypto.randomUUID() } }); }}/>; }
    if (view.kind === 'run') { const quiz = byId(view.run.quiz); if (quiz) return <QuizRunner quiz={quiz} run={view.run} update={run => setView({ kind: 'run', run })} finish={finish} confirm={confirm} exit={() => { saveRun(view.run, false); const p = runProgress(view.run); setView({ kind: 'list' }); notify({ kind: 'success', title: 'Progress saved', message: `“${quiz.title}”: ${p.done} of ${plural(p.total, 'question')} done. Resume from the quiz card any time.` }); }}/>; }
    if (view.kind === 'result') { const quiz = byId(view.attempt.quiz); if (quiz) return <QuizResults quiz={quiz} attempt={view.attempt} saved={view.saved} retrySave={view.answers ? () => { setView({ ...view, saved: 'saving' }); save(view.attempt, view.answers!); } : undefined}
        retry={only => setView({ kind: 'setup', quiz: quiz.id, only })} back={() => setView({ kind: 'list' })} history={() => setView({ kind: 'history', quiz: quiz.id })}/>; }
    if (view.kind === 'history') { const quiz = byId(view.quiz); if (quiz) return <QuizHistory quiz={quiz} attempts={attempts.filter(a => a.quiz === quiz.id)} open={attempt => setView({ kind: 'result', attempt, saved: 'saved' })} start={() => setView({ kind: 'setup', quiz: quiz.id })} back={() => setView({ kind: 'list' })}/>; }

    function info(q: Quiz) {
        const mine = attempts.filter(a => a.quiz === q.id), last = mine.at(-1), full = mine.filter(a => a.total === q.questions.length);
        const saved = loadRun(q), progress = saved && runProgress(saved);
        const best = full.length ? Math.max(...full.map(a => percent(a.score, a.total))) : undefined;
        return { q, mine, last, best, saved, progress };
    }
    const actions = (q: Quiz, saved: Run | undefined, attempted: boolean) => <>{saved ? <><button className="primary" onClick={() => setView({ kind: 'run', run: loadRun(q) ?? saved })}>Resume<ArrowRight size={15}/></button><button onClick={() => setView({ kind: 'setup', quiz: q.id })}>Start over</button></> : <button className="primary" onClick={() => setView({ kind: 'setup', quiz: q.id })}>Start<ArrowRight size={15}/></button>}{attempted && <button onClick={() => setView({ kind: 'history', quiz: q.id })}>Review</button>}</>;
    const groups = [...w.subjects.map(s => ({ id: s.id, name: s.name })), { id: UNSORTED, name: 'Uncategorised' }].map(g => ({ ...g, quizzes: quizzes.filter(q => groupOf(q) === g.id) })).filter(g => g.quizzes.length);
    const shown = groups.filter(g => !subject || g.id === subject);
    return <>
        <div className="page-heading row"><div><div className="eyebrow">TEST YOURSELF</div><h1>Quizzes<span className="indigo">.</span></h1><p>Practise by subject, check your answers, and review where you slipped.</p></div><div className="actions heading-actions"><button className="primary" onClick={upload}><Upload size={16}/>Upload quiz</button></div></div>
        {!quizzes.length ? <section className="empty"><ListChecks size={36}/><h2>No quizzes yet.</h2><p>Upload a CSV or JSON quiz, from a spreadsheet or another app, to start practising.</p><div className="actions" style={{ justifyContent: 'center' }}><button className="primary" onClick={upload}><Upload size={16}/>Upload quiz</button><button onClick={downloadQuizTemplate}><Download size={16}/>Download template</button></div></section> : <>
            {groups.length > 1 && <div className="quiz-filter" role="tablist" aria-label="Filter quizzes by subject">{[{ id: '', name: 'All subjects', count: quizzes.length }, ...groups.map(g => ({ id: g.id, name: g.name, count: g.quizzes.length }))].map(g => <button key={g.id} role="tab" aria-selected={subject === g.id} className={subject === g.id ? 'selected' : ''} onClick={() => setSubject(g.id)}>{g.name}<span>{g.count}</span></button>)}</div>}
            <div className="quiz-toolbar">
                <label className="quiz-sort">Sort by<select value={prefs.sort} onChange={e => setPrefs({ sort: e.target.value as SortBy })}>{SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                <button className="quiz-dir" onClick={() => setPrefs({ dir: prefs.dir === 'asc' ? 'desc' : 'asc' })} aria-label={`Sort ${prefs.dir === 'asc' ? 'ascending' : 'descending'}; switch to ${prefs.dir === 'asc' ? 'descending' : 'ascending'}`} title={prefs.dir === 'asc' ? 'Ascending' : 'Descending'}>{prefs.dir === 'asc' ? <ArrowUpNarrowWide size={15}/> : <ArrowDownWideNarrow size={15}/>}{directionLabel(prefs)}</button>
                <div className="segmented quiz-layout" role="radiogroup" aria-label="Quiz layout">{([['tiles', 'Tiles', LayoutGrid], ['list', 'List', List]] as const).map(([value, label, Icon]) => <button key={value} role="radio" aria-checked={prefs.layout === value} className={prefs.layout === value ? 'selected' : ''} onClick={() => setPrefs({ layout: value })} title={label + ' view'}><Icon size={14}/>{label}</button>)}</div>
            </div>
            {shown.map(g => { const items = sortQuizzes(g.quizzes.map(info), prefs);
                return <section key={g.id} className="quiz-group" aria-label={g.name}><div className="section-heading"><h2>{g.name} <span className="number">{g.quizzes.length}</span></h2></div>
                {prefs.layout === 'tiles' ? <div className="quiz-grid">{items.map(({ q, mine, last, best, saved, progress }) =>
                    <article key={q.id} className="quiz-card"><div className="row"><span className="subject-icon"><ListChecks size={18}/></span><button className="icon" aria-label={`Edit or delete ${q.title}`} onClick={() => manage(q)}><MoreHorizontal size={17}/></button></div>
                    <h3>{q.title}</h3><p className="small">{plural(q.questions.length, 'question')}</p>
                    {saved && progress && <p className="quiz-resume-note"><History size={13}/>In progress · {progress.done} of {progress.total} done · {saved.mode === 'practice' ? 'Practice' : 'Test'}</p>}
                    <div className="quiz-stats">{last ? <>{best !== undefined && <span><Trophy size={13}/>Best <strong>{best}%</strong></span>}<span>Last {percent(last.score, last.total)}%</span><span>{plural(mine.length, 'attempt')}</span></> : <span>Not attempted yet</span>}</div>
                    <div className="actions">{actions(q, saved, !!last)}</div></article>)}</div>
                : <div className="quiz-list" role="list">{items.map(({ q, mine, last, best, saved, progress }) =>
                    <div key={q.id} className="quiz-row" role="listitem"><span className="subject-icon"><ListChecks size={16}/></span>
                        <div className="quiz-row-main"><strong>{q.title}</strong><small>{plural(q.questions.length, 'question')}{saved && progress ? <span className="quiz-resume-note"><History size={12}/>In progress · {progress.done} of {progress.total} done</span> : null}</small></div>
                        <div className="quiz-row-stats">{last ? <>{best !== undefined && <span title="Best score"><Trophy size={13}/><strong>{best}%</strong></span>}<span title="Last score">Last {percent(last.score, last.total)}%</span><span>{plural(mine.length, 'attempt')}</span><span className="muted">{new Date(last.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></> : <span className="muted">Not attempted yet</span>}</div>
                        <div className="actions">{actions(q, saved, !!last)}<button className="icon" aria-label={`Edit or delete ${q.title}`} onClick={() => manage(q)}><MoreHorizontal size={17}/></button></div></div>)}</div>}
                </section>; })}
        </>}
    </>;
}

function QuizSetup({ quiz, only, saved, resume, back, start }: { quiz: Quiz; only?: string[]; saved?: Run; resume: (run: Run) => void; back: () => void; start: (mode: 'practice' | 'test', shuffle: boolean) => void }) {
    const [mode, setMode] = useState<'practice' | 'test'>('practice');
    const [shuffle, setShuffle] = useState(!only);
    const count = only?.length ?? quiz.questions.length;
    return <div className="quiz-run">
        <button className="text-button quiz-back" onClick={back}><ArrowLeft size={15}/>All quizzes</button>
        {saved && (() => { const p = runProgress(saved); return <div className="quiz-resume panel"><History size={18}/><div className="grow"><strong>You have an unfinished attempt</strong><p className="small">{p.done} of {plural(p.total, 'question')} done · {saved.mode === 'practice' ? 'Practice' : 'Test'} · question {saved.index + 1}. Starting a new attempt replaces it.</p></div><button className="primary" onClick={() => resume(saved)}>Resume<ArrowRight size={15}/></button></div>; })()}
        <section className="panel quiz-setup"><div className="eyebrow">{only ? 'PRACTISE SELECTED QUESTIONS' : 'READY WHEN YOU ARE'}</div><h1>{quiz.title}</h1><p>{plural(count, 'question')}{only && only.length < quiz.questions.length ? ` of ${quiz.questions.length}` : ''}.</p>
            <div className="quiz-modes" role="radiogroup" aria-label="Quiz mode">{([['practice', 'Practice', 'Check each answer as you go, with explanations.'], ['test', 'Test', 'Answer everything first, then see your score.']] as const).map(([value, label, text]) => <button key={value} role="radio" aria-checked={mode === value} className={mode === value ? 'selected' : ''} onClick={() => setMode(value)}><strong>{label}</strong><span>{text}</span></button>)}</div>
            <label className="checkbox"><input type="checkbox" checked={shuffle} onChange={e => setShuffle(e.target.checked)}/><Shuffle size={14}/>Shuffle question order</label>
            <button className="primary" autoFocus onClick={() => start(mode, shuffle)}>Start {mode}<ArrowRight size={16}/></button>
        </section>
    </div>;
}

function QuizRunner({ quiz, run, update, finish, confirm, exit }: { quiz: Quiz; run: Run; update: (run: Run) => void; finish: (run: Run) => void; confirm: (title: string, description: string, action: () => void) => void; exit: () => void }) {
    const q = quiz.questions.find(q => q.id === run.order[run.index])!;
    const choice = isChoice(q), multi = q.correct.length > 1, last = run.index === run.order.length - 1;
    const answer = run.answers[q.id], locked = run.mode === 'practice' && !!run.checked[q.id];
    const chosen = Array.isArray(answer) ? answer : [];
    const has = choice ? chosen.length > 0 : typeof answer === 'string' && !!answer.trim();
    const right = locked && grade(q, answer);
    const setAnswer = (value: QuizAnswer) => update({ ...run, answers: { ...run.answers, [q.id]: value } });
    const toggle = (i: number) => { if (locked) return; setAnswer(multi ? (chosen.includes(i) ? chosen.filter(x => x !== i) : [...chosen, i].sort((a, b) => a - b)) : [i]); };
    const go = (index: number) => update({ ...run, index });
    function primary() {
        if (run.mode === 'practice' && !locked) { update({ ...run, answers: { ...run.answers, [q.id]: answer ?? (choice ? [] : '') }, checked: { ...run.checked, [q.id]: true } }); return; }
        if (!last) return go(run.index + 1);
        const open = run.order.filter(id => { const a = run.answers[id]; return Array.isArray(a) ? !a.length : !(typeof a === 'string' && a.trim()); }).length;
        if (run.mode === 'test' && open) confirm('Finish with unanswered questions?', `${plural(open, 'question')} ${open === 1 ? 'has' : 'have'} no answer and will count as incorrect.`, () => finish(run)); else finish(run);
    }
    const keys = useRef({ primary, toggle, has, locked });
    useEffect(() => { keys.current = { primary, toggle, has, locked }; });
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.overlay')) return;
            const typing = (e.target as HTMLElement).closest('input,textarea,select');
            if (!typing && choice && /^[1-9]$/.test(e.key) && Number(e.key) <= q.options.length) { e.preventDefault(); keys.current.toggle(Number(e.key) - 1); }
            else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button,textarea') && (keys.current.has || keys.current.locked || run.mode === 'test')) { e.preventDefault(); keys.current.primary(); }
        }
        window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
    }, [q.id, choice, q.options.length, run.mode]);
    const label = run.mode === 'practice' && !locked ? 'Check answer' : last ? (run.mode === 'practice' ? 'See results' : 'Finish quiz') : 'Next question';
    return <div className="quiz-run">
        <div className="quiz-run-top"><button className="text-button quiz-back" onClick={exit} title="Your answers are kept; resume from the quiz card"><ArrowLeft size={15}/>Save &amp; exit</button><span className="quiz-run-title">{quiz.title}</span><span className="small muted">{run.mode === 'practice' ? 'Practice' : 'Test'} · {run.index + 1} / {run.order.length}</span></div>
        <div className="quiz-progress" role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={run.order.length} aria-valuenow={run.index + 1}><i style={{ width: `${(run.index + (locked || run.mode === 'test' && has ? 1 : 0)) / run.order.length * 100}%` }}/></div>
        <section className="panel quiz-question" aria-live="polite">
            <div className="eyebrow">QUESTION {run.index + 1} · {choice ? multi ? 'SELECT ALL THAT APPLY' : 'CHOOSE ONE' : 'TYPE YOUR ANSWER'}</div>
            <h2 className="quiz-prompt">{q.prompt}</h2>
            {choice ? <div className="quiz-options" role={multi ? 'group' : 'radiogroup'} aria-label="Options">{q.options.map((o, i) => {
                const selected = chosen.includes(i), correct = q.correct.includes(i);
                const state = locked ? correct ? ' right' : selected ? ' wrong' : ' faded' : selected ? ' selected' : '';
                return <button key={i} role={multi ? 'checkbox' : 'radio'} aria-checked={selected} aria-disabled={locked} className={'quiz-option' + state} onClick={() => toggle(i)}><span className="quiz-letter">{letter(i)}</span><span className="grow">{o}</span>{locked && correct && <CircleCheck size={17}/>}{locked && selected && !correct && <CircleX size={17}/>}</button>;
            })}</div>
                : <input key={q.id} className={'quiz-text' + (locked ? right ? ' right' : ' wrong' : '')} aria-label="Your answer" value={typeof answer === 'string' ? answer : ''} readOnly={locked} autoFocus placeholder="Type your answer…" maxLength={LIMITS.option} onChange={e => setAnswer(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (keys.current.has || locked || run.mode === 'test') primary(); } }}/>}
            {locked && <div className={'quiz-feedback ' + (right ? 'right' : 'wrong')} role="status"><strong>{right ? <><CircleCheck size={16}/>Correct</> : <><CircleX size={16}/>{has ? 'Not quite' : 'Skipped'}</>}</strong>{!right && <p>Answer: {describeCorrect(q)}</p>}{q.explanation && <p className="quiz-explanation">{q.explanation}</p>}</div>}
        </section>
        <div className="quiz-nav">
            {run.mode === 'test' ? <button disabled={run.index === 0} onClick={() => go(run.index - 1)}><ArrowLeft size={15}/>Previous</button> : !locked ? <button className="text-button" onClick={() => update({ ...run, answers: { ...run.answers, [q.id]: choice ? [] : '' }, checked: { ...run.checked, [q.id]: true } })}>I don’t know — show the answer</button> : <span/>}
            <span className="small muted quiz-hint">{choice ? `Keys 1–${Math.min(q.options.length, 9)} choose · ` : ''}Enter continues</span>
            <button className="primary" disabled={run.mode === 'practice' && !locked && !has} onClick={primary}>{label}{label !== 'Check answer' && <ArrowRight size={15}/>}</button>
        </div>
    </div>;
}

function QuizResults({ quiz, attempt, saved, retrySave, retry, back, history }: { quiz: Quiz; attempt: QuizAttempt; saved: 'saving' | 'saved' | 'failed'; retrySave?: () => void; retry: (only?: string[]) => void; back: () => void; history: () => void }) {
    const [mistakes, setMistakes] = useState(false);
    const pct = percent(attempt.score, attempt.total), wrong = attempt.results.filter(r => !r.correct && quiz.questions.some(q => q.id === r.question));
    const headline = pct >= 90 ? 'Excellent work.' : pct >= 70 ? 'Good going.' : pct >= 50 ? 'Getting there.' : 'Keep practising.';
    const shown = attempt.results.filter(r => !mistakes || !r.correct);
    return <div className="quiz-run quiz-result">
        <button className="text-button quiz-back" onClick={back}><ArrowLeft size={15}/>All quizzes</button>
        <section className="panel quiz-score"><div className="quiz-ring" style={{ ['--pct' as string]: pct }} aria-hidden="true"><span>{pct}%</span></div>
            <div><div className="eyebrow">{quiz.title.toUpperCase()}</div><h1>{headline}</h1><p>{attempt.score} of {plural(attempt.total, 'question')} correct · +{attemptXp(attempt)} XP · {clock(attempt.seconds)} · {attempt.mode === 'practice' ? 'Practice' : 'Test'}{attempt.total < quiz.questions.length ? ' · retry' : ''} · {new Date(attempt.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                <p className="small" role="status">{saved === 'saving' ? 'Saving your result…' : saved === 'saved' ? <><Check size={13}/> Saved to your history</> : <span className="danger-text">This result could not be saved (you may be offline). {retrySave && <button className="text-button" onClick={retrySave}>Try again</button>}</span>}</p>
                <div className="actions"><button className="primary" onClick={() => retry()}><RotateCcw size={15}/>Retry quiz</button>{wrong.length > 0 && <button onClick={() => retry(wrong.map(r => r.question))}>Retry {plural(wrong.length, 'wrong answer')}</button>}<button onClick={history}>All attempts</button></div></div></section>
        <div className="section-heading"><h2>Review answers</h2>{attempt.score < attempt.total && <label className="checkbox"><input type="checkbox" checked={mistakes} onChange={e => setMistakes(e.target.checked)}/>Show only mistakes</label>}</div>
        {shown.map(r => { const q = quiz.questions.find(q => q.id === r.question); const n = attempt.results.indexOf(r) + 1;
            return <article key={r.question} className={'quiz-review ' + (r.correct ? 'right' : 'wrong')}><div className="quiz-review-head">{r.correct ? <CircleCheck size={16}/> : <CircleX size={16}/>}Question {n}</div>
                {q ? <><h3>{q.prompt}</h3><p><span className="muted">Your answer:</span> {describeAnswer(q, r.answer)}</p>{!r.correct && <p><span className="muted">Correct answer:</span> {describeCorrect(q)}</p>}{q.explanation && <p className="quiz-explanation">{q.explanation}</p>}</> : <p className="muted">This question is no longer in the quiz.</p>}</article>; })}
    </div>;
}

function QuizHistory({ quiz, attempts, open, start, back }: { quiz: Quiz; attempts: QuizAttempt[]; open: (a: QuizAttempt) => void; start: () => void; back: () => void }) {
    const list = [...attempts].reverse();
    return <div className="quiz-run">
        <button className="text-button quiz-back" onClick={back}><ArrowLeft size={15}/>All quizzes</button>
        <div className="page-heading row"><div><div className="eyebrow">ATTEMPT HISTORY</div><h1>{quiz.title}</h1><p>{plural(attempts.length, 'attempt')} · {plural(quiz.questions.length, 'question')}</p></div><div className="actions heading-actions"><button className="primary" onClick={start}>Start again<ArrowRight size={15}/></button></div></div>
        {!list.length ? <p className="muted">No attempts yet.</p> : <div className="recent-list">{list.map(a => <button key={a.id} className="recent-row" onClick={() => open(a)}><span className={'quiz-pill ' + (percent(a.score, a.total) >= 70 ? 'right' : 'wrong')}>{percent(a.score, a.total)}%</span><span><strong>{a.score} / {a.total} correct</strong><small>{new Date(a.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {a.mode === 'practice' ? 'Practice' : 'Test'} · {clock(a.seconds)}{a.total < quiz.questions.length ? ' · retry of wrong answers' : ''}</small></span><ArrowRight size={15}/></button>)}</div>}
    </div>;
}

const FILE_LIMIT = 2800000;
const QUIZ_FILES = /\.(csv|tsv|txt|json)$/i;
/** Upload dialog, opened from Settings and the Quiz tab. Takes one or many files, or a whole folder. */
export function QuizImport({ w, mutate, done }: { w: WorkspaceSnapshot; mutate: Mutate; done: (message: string) => void }) {
    const [picked, setPicked] = useState<Picked>();
    const [error, setError] = useState('');
    // undefined = use the title from the file.
    const [title, setTitle] = useState<string>();
    const [subject, setSubject] = useState(w.subjects[0]?.id || '');
    const [newSubject, setNewSubject] = useState('');
    const [useFolders, setUseFolders] = useState(true);
    const [saving, setSaving] = useState('');
    const fromFolder = !!picked?.files.some(f => f.folder);
    // Every file is parsed on its own; a quiz without a subject takes its folder's name when that option is on.
    const parsed: QuizParse | undefined = useMemo(() => {
        if (!picked) return undefined;
        const result: QuizParse = { quizzes: [], problems: picked.skipped.map(reason => ({ where: reason.split(': ')[0], reason: reason.split(': ').slice(1).join(': ') })) };
        for (const f of picked.files) {
            const one = parseQuizFile(f.text, f.name);
            result.quizzes.push(...one.quizzes.map(q => !q.subject && useFolders && f.folder ? { ...q, subject: f.folder } : q));
            result.problems.push(...one.problems.map(pr => ({ where: picked.files.length > 1 && !pr.where.includes(f.name) ? `${f.path} · ${pr.where}` : pr.where, reason: pr.reason })));
        }
        return result;
    }, [picked, useFolders]);
    const shownTitle = title ?? (parsed?.quizzes.length === 1 ? parsed.quizzes[0].title : '');
    const quizzes: DraftQuiz[] = (parsed?.quizzes || []).map((q, i) => i === 0 && parsed!.quizzes.length === 1 && shownTitle.trim() ? { ...q, title: shownTitle.trim() } : q);
    const needsSubject = quizzes.some(q => !q.subject);
    const questions = quizzes.reduce((t, q) => t + q.questions.length, 0);
    const fallbackName = subject === 'new' ? newSubject.trim() || 'New subject' : w.subjects.find(s => s.id === subject)?.name || 'Uncategorised';
    async function choose(list: FileList | null) {
        setError(''); setPicked(undefined); setTitle(undefined);
        if (!list?.length) return;
        const result = await readPicked(Array.from(list), QUIZ_FILES, FILE_LIMIT);
        if (!result.files.length) return setError(result.skipped.length ? 'None of these files can be imported. Choose .csv, .tsv, .txt or .json quiz files under 2.8 MB.' : 'This folder has no quiz files.');
        setPicked(result);
    }
    async function upload() {
        if (saving || !quizzes.length) return;
        const before = w.quizzes?.length || 0, parts = batches(quizzes, LIMITS.quizzes);
        let next: WorkspaceSnapshot | undefined;
        try {
            for (let i = 0; i < parts.length; i++) {
                setSaving(parts.length > 1 ? `Uploading ${i + 1} of ${parts.length}…` : 'Uploading…');
                next = await mutate('importQuizzes', { quizzes: parts[i], subject: subject === 'new' ? undefined : subject, newSubject: subject === 'new' ? newSubject : undefined });
            }
        } catch { if (!next) { setSaving(''); return; } }
        const imported = (next!.quizzes?.length || 0) - before, skipped = quizzes.length - imported;
        setSaving('');
        done(imported ? `Imported ${plural(imported, 'quiz', 'quizzes')}${picked && picked.files.length > 1 ? ` from ${plural(picked.files.length, 'file')}` : ''}${skipped ? ` · skipped ${skipped} already in your workspace${imported + skipped < quizzes.length ? ' or not uploaded' : ''}` : ''}. Open Quiz to practise.` : 'These quizzes are already in your workspace.');
    }
    const files = picked?.files || [];
    return <form className="quiz-import" onSubmit={e => { e.preventDefault(); void upload(); }}>
        <h2>Upload quizzes.</h2>
        <p>Choose one or more quiz files, or a whole folder of them. Use a spreadsheet saved as CSV with a header row — <em>Question</em>, <em>Option A</em>, <em>Option B</em>…, <em>Answer</em> and optionally <em>Explanation</em>, <em>Quiz</em> and <em>Subject</em> — or a JSON file. Answers can be option letters (<code>B</code>, <code>A,C</code>), option text, or numbers counted from 1. Leave the options empty for a typed answer (<code>Paris|Paris, France</code>) or answer <code>True</code>/<code>False</code>.</p>
        <div className="actions"><label className="file-button"><Upload size={15}/>{files.length ? 'Choose other files' : 'Choose files'}<input type="file" multiple accept=".csv,.tsv,.txt,.json,text/csv,application/json,text/plain" onChange={e => { void choose(e.target.files); e.target.value = ''; }}/></label><label className="file-button"><FolderOpen size={15}/>Choose folder<input type="file" ref={el => { el?.setAttribute('webkitdirectory', ''); }} onChange={e => { void choose(e.target.files); e.target.value = ''; }}/></label><button type="button" className="text-button" onClick={downloadQuizTemplate}><Download size={14}/>Download template (.csv)</button></div>
        {files.length > 0 && <p className="small">{files.length === 1 ? files[0].path : `${files.length} files selected`}</p>}
        {fromFolder && <label className="checkbox"><input type="checkbox" checked={useFolders} onChange={e => setUseFolders(e.target.checked)}/>Use folder names as subjects (when a quiz doesn’t name one)</label>}
        {error && <p role="alert" className="danger-text">{error}</p>}
        {parsed && <>
            {quizzes.length === 1 && <label>Quiz title<input value={shownTitle} onChange={e => setTitle(e.target.value)} required maxLength={LIMITS.title}/></label>}
            {needsSubject && <div className="card-import-options"><label>Subject{quizzes.length > 1 ? ' for quizzes without one' : ''}<select value={subject} onChange={e => setSubject(e.target.value)}>{w.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="">Uncategorised</option><option value="new">New subject…</option></select></label>
                {subject === 'new' && <label>New subject name<input value={newSubject} onChange={e => setNewSubject(e.target.value)} required maxLength={100} placeholder="e.g. Networking"/></label>}</div>}
            <p className="small" role="status"><strong>{plural(quizzes.length, 'quiz', 'quizzes')} · {plural(questions, 'question')} ready</strong>{files.length > 1 ? ` from ${plural(files.length, 'file')}` : ''}{parsed.problems.length ? ` · ${plural(parsed.problems.length, 'problem')} found` : ''}</p>
            {quizzes.length > 0 && <ul className="import-list quiz-import-list">{quizzes.map((q, i) => <li key={i}><ListChecks size={14}/><details><summary><strong>{q.title}</strong><small>{q.subject || fallbackName} · {plural(q.questions.length, 'question')}</small></summary><ol>{q.questions.slice(0, 50).map((x, j) => <li key={j}>{x.prompt}<small>{x.options.length ? `${x.options.length} options · answer ${x.correct.map(letter).join(', ')}` : `typed · ${x.accepted.join(' or ')}`}</small></li>)}{q.questions.length > 50 && <li className="muted">…and {q.questions.length - 50} more</li>}</ol></details></li>)}</ul>}
            {parsed.problems.length > 0 && <details className="card-problems" open={!quizzes.length}><summary>{plural(parsed.problems.length, 'problem')} — these will be left out</summary><ul>{parsed.problems.slice(0, 50).map((p, i) => <li key={i}>{p.where}: {p.reason}</li>)}</ul></details>}
        </>}
        <button className="primary" disabled={!!saving || !quizzes.length || (quizzes.length === 1 && !shownTitle.trim())}><Upload size={16}/>{saving || (quizzes.length ? `Upload ${plural(quizzes.length, 'quiz', 'quizzes')}` : 'Upload quizzes')}</button>
    </form>;
}
