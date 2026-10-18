'use client';
import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, CircleX, Layers, Lightbulb, ListChecks, Pencil, TrendingDown, TrendingUp } from 'lucide-react';
import type { Card, Workspace } from '../lib/study';
import { describeCorrect } from '../lib/quiz';
import { cardInsights, percent, questionInsights, quizSummaries, subjectInsights, type QuizSummary } from '../lib/insights';

const plural = (n: number, word: string, many = word + 's') => `${n} ${n === 1 ? word : many}`;
const known = (w: Workspace) => new Set(w.subjects.map(s => s.id));
const subjectName = (w: Workspace, id: string) => w.subjects.find(s => s.id === id)?.name || 'Uncategorised';

/** Quiz section of the Progress tab: totals, a progress bar per quiz and recent scores. */
export function QuizProgress({ w, openQuiz, openInsights }: { w: Workspace; openQuiz: () => void; openInsights: () => void }) {
    const quizzes = w.quizzes || [], attempts = w.quizAttempts || [];
    const summaries = useMemo(() => quizSummaries(w, questionInsights(w)), [w]);
    if (!quizzes.length) return <section className="panel"><h2>Quiz progress</h2><p>Upload a quiz to see your scores here.</p><button onClick={openQuiz}><ListChecks size={16}/>Go to Quiz</button></section>;
    const answered = attempts.reduce((t, a) => t + a.total, 0), correct = attempts.reduce((t, a) => t + a.score, 0);
    const recent = attempts.slice(-10);
    return <>
        <div className="stats"><Tile label="Quiz attempts" value={attempts.length} detail="Practice and test runs"/><Tile label="Questions answered" value={answered}/><Tile label="Quiz accuracy" value={`${percent(correct, answered)}%`} detail="Across every attempt"/><Tile label="Quizzes taken" value={`${summaries.filter(s => s.attempts).length} / ${quizzes.length}`}/></div>
        <div className="dashboard-grid">
            <section className="panel"><div className="section-heading"><h2>Quiz progress</h2><button className="text-button" onClick={openInsights}>See insights<ArrowRight size={13}/></button></div>
                {summaries.map(s => <QuizBar key={s.quiz.id} s={s} subject={subjectName(w, known(w).has(s.quiz.subject) ? s.quiz.subject : '')}/>)}
                <p className="small muted">The bar shows your best full attempt; the marker shows your latest.</p></section>
            <section className="panel"><h2>Recent quiz scores</h2>{!recent.length ? <p>Your scores appear here after your first attempt.</p> : <div className="bars">{recent.map(a => { const p = percent(a.score, a.total); return <div key={a.id} title={`${quizzes.find(q => q.id === a.quiz)?.title || 'Deleted quiz'} · ${a.score}/${a.total}`}><span>{p}%</span><div className="bar" style={{ height: `${Math.max(3, p * 1.5)}px` }}/><small>{new Date(a.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small></div>; })}</div>}</section>
        </div>
    </>;
}

function QuizBar({ s, subject }: { s: QuizSummary; subject: string }) {
    const trend = s.first !== undefined && s.last !== undefined && s.attempts > 1 ? s.last - s.first : 0;
    return <div className="quiz-bar"><div className="row"><span><strong>{s.quiz.title}</strong><small>{subject}</small></span><span className="small">{s.attempts ? <>{s.best !== undefined ? `Best ${s.best}%` : 'Retries only'} · {plural(s.attempts, 'attempt')}{trend > 0 && <TrendingUp size={13} className="up"/>}{trend < 0 && <TrendingDown size={13} className="down"/>}</> : 'Not attempted'}</span></div>
        <div className="quiz-bar-track" role="meter" aria-label={`${s.quiz.title} best score`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.best ?? 0}><i style={{ width: `${s.best ?? 0}%` }}/>{s.last !== undefined && <b style={{ left: `${s.last}%` }} title={`Latest ${s.last}%`}/>}</div></div>;
}

function Tile({ label, value, detail }: { label: string; value: number | string; detail?: string }) { return <div className="stat"><div className="row"><span>{label}</span></div><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }

/** One place for everything that needs another look: missed quiz questions and forgotten flashcards, by subject. */
export function InsightsTab({ w, practise, edit, source, openQuiz, openCards }: { w: Workspace; practise: (quiz: string, only: string[]) => void; edit: (c: Card) => void; source: (c: Card) => void; openQuiz: () => void; openCards: () => void }) {
    const [subject, setSubject] = useState('__all');
    const all = useMemo(() => { const cards = cardInsights(w), questions = questionInsights(w); return { cards, questions, subjects: subjectInsights(w, cards, questions), quizzes: quizSummaries(w, questions) }; }, [w]);
    const ids = known(w), of = (id: string) => ids.has(id) ? id : '';
    const keep = (id: string) => subject === '__all' || of(id) === subject;
    const cards = all.cards.filter(x => keep(x.card.subject)), questions = all.questions.filter(x => keep(x.quiz.subject));
    const quizzes = all.quizzes.filter(s => keep(s.quiz.subject) && s.attempts);
    const rows = all.subjects.filter(r => subject === '__all' || r.id === subject);
    const answered = rows.reduce((t, r) => t + r.quizAnswered, 0), correct = rows.reduce((t, r) => t + r.quizCorrect, 0), reviews = rows.reduce((t, r) => t + r.reviews, 0), recalled = rows.reduce((t, r) => t + r.recalled, 0);
    const byQuiz = [...new Map(questions.map(x => [x.quiz.id, x.quiz])).values()].map(quiz => ({ quiz, items: questions.filter(x => x.quiz.id === quiz.id) }));
    const nothing = !(w.quizAttempts || []).length && !w.events.length;
    return <>
        <div className="page-heading row"><div><div className="eyebrow">WHERE TO FOCUS</div><h1>Insights<span className="indigo">.</span></h1><p>Quiz questions you keep missing and flashcards that are not sticking, in one place.</p></div>
            {all.subjects.length > 0 && <label className="insights-filter">Subject<select value={subject} onChange={e => setSubject(e.target.value)}><option value="__all">All subjects</option>{all.subjects.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}</div>
        {nothing ? <section className="empty"><Lightbulb size={36}/><h2>Nothing to analyse yet.</h2><p>Review some flashcards or take a quiz; patterns in what you miss will show up here.</p><div className="actions" style={{ justifyContent: 'center' }}><button className="primary" onClick={openQuiz}><ListChecks size={16}/>Take a quiz</button><button onClick={openCards}><Layers size={16}/>Review cards</button></div></section> : <>
            <div className="stats"><Tile label="Quiz questions to revisit" value={questions.length} detail={answered ? `${plural(answered, 'answer')} analysed` : 'No quiz attempts yet'}/><Tile label="Flashcards that need work" value={cards.length} detail={reviews ? `${plural(reviews, 'review')} analysed` : 'No reviews yet'}/><Tile label="Quiz accuracy" value={answered ? `${percent(correct, answered)}%` : '—'}/><Tile label="Flashcard recall" value={reviews ? `${percent(recalled, reviews)}%` : '—'} detail="Rated Good or Easy"/></div>
            {rows.length > 1 && <section className="panel"><h2>By subject</h2><div className="insights-table" role="table" aria-label="Insights by subject"><div role="row" className="insights-head"><span role="columnheader">Subject</span><span role="columnheader">Quiz accuracy</span><span role="columnheader">Card recall</span><span role="columnheader">To revisit</span></div>
                {rows.map(r => <div role="row" key={r.id} className="insights-row"><span role="cell"><button className="text-button" title={`Show only ${r.name}`} onClick={() => setSubject(r.id)}><strong>{r.name}</strong></button></span><span role="cell"><Meter value={r.quizAnswered ? percent(r.quizCorrect, r.quizAnswered) : undefined}/></span><span role="cell"><Meter value={r.reviews ? percent(r.recalled, r.reviews) : undefined}/></span><span role="cell" className="small">{plural(r.weakQuestions, 'question')} · {plural(r.strugglingCards, 'card')}</span></div>)}</div></section>}
            <section className="panel"><div className="section-heading"><h2><ListChecks size={17}/>Quiz questions you keep missing <span className="number">{questions.length}</span></h2></div>
                {!questions.length ? <p>{answered ? 'Nothing stands out: no question was missed at your last attempt or at least half the time.' : 'Take a quiz to see which questions trip you up.'}</p> : byQuiz.map(({ quiz, items }) => <div key={quiz.id} className="insights-group"><div className="row"><span><strong>{quiz.title}</strong><small>{subjectName(w, of(quiz.subject))} · {plural(items.length, 'question')} to revisit</small></span><button className="primary" onClick={() => practise(quiz.id, items.map(x => x.question.id))}>Practise these<ArrowRight size={14}/></button></div>
                    {items.map(x => <article key={x.question.id} className="insight-item"><CircleX size={16} className="down"/><div><h3>{x.question.prompt}</h3><p className="small">Missed {x.wrong} of {plural(x.answered, 'time')}{x.lastCorrect ? '' : ' · wrong at the last attempt'}</p><p className="small"><span className="muted">Answer:</span> {describeCorrect(x.question)}{x.commonWrong && <> · <span className="muted">often chosen instead:</span> {x.commonWrong.answer}</>}</p></div><span className="insight-rate">{percent(x.wrong, x.answered)}%<small>missed</small></span></article>)}</div>)}</section>
            <section className="panel"><div className="section-heading"><h2><Layers size={17}/>Flashcards that need work <span className="number">{cards.length}</span></h2></div>
                {!cards.length ? <p>{reviews ? 'No card stands out: none has been forgotten repeatedly or at its last review.' : 'Review some cards to see which ones are not sticking.'}</p> : cards.slice(0, 100).map(x => <article key={x.card.id} className="insight-item"><Layers size={16} className="down"/><div><h3>{x.card.front}</h3><p className="small"><span className="muted">Answer:</span> {x.card.answer}</p><div className="insight-reasons">{x.reasons.map(r => <span key={r} className="pill amber">{r}</span>)}<span className="small muted">{subjectName(w, of(x.card.subject))} · {plural(x.reviews, 'review')}{x.card.life === 'suspended' ? ' · suspended' : ''}</span></div></div>
                    <div className="insight-actions"><button onClick={() => edit(x.card)}><Pencil size={14}/>Edit</button>{(x.card.note || x.card.excerpt) && <button onClick={() => source(x.card)}><BookOpen size={14}/>Source</button>}</div></article>)}
                {cards.length > 100 && <p className="small muted">Showing the 100 that need the most work.</p>}</section>
            {quizzes.length > 0 && <section className="panel"><h2>Quiz scores</h2>{quizzes.map(s => <QuizBar key={s.quiz.id} s={s} subject={subjectName(w, of(s.quiz.subject))}/>)}</section>}
            <p className="muted small">A card needs work when it was forgotten (rated Again) three or more times, in at least 40% of its reviews, or at its last review, or has high FSRS difficulty. A quiz question is listed when it was wrong at your latest attempt or at least half the time.</p>
        </>}
    </>;
}

function Meter({ value }: { value?: number }) { return value === undefined ? <span className="small muted">—</span> : <span className="insights-meter"><span className="quiz-bar-track"><i style={{ width: `${value}%` }}/></span><strong>{value}%</strong></span>; }
