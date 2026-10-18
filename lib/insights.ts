import type { Card, Event, Workspace } from './study.ts';
import { type Quiz, type QuizAttempt, type QuizQuestion, describeAnswer } from './quiz.ts';

// Derived, read-only views of saved practice: which flashcards keep being forgotten and which quiz questions keep
// being missed. Nothing here is stored; every figure comes from review events and quiz attempts.

export const percent = (part: number, whole: number) => whole ? Math.round(part / whole * 100) : 0;
const pct = (a: QuizAttempt) => percent(a.score, a.total);

export type CardInsight = { card: Card; reviews: number; again: number; hard: number; last: number; difficulty?: number; reasons: string[]; score: number };
/** Active or suspended cards whose saved ratings show they are not sticking, worst first. */
export function cardInsights(w: Pick<Workspace, 'cards' | 'events'>): CardInsight[] {
    const byCard = new Map<string, Event[]>();
    for (const e of w.events) { const list = byCard.get(e.card); if (list) list.push(e); else byCard.set(e.card, [e]); }
    const out: CardInsight[] = [];
    for (const card of w.cards) {
        const events = byCard.get(card.id);
        if (!events?.length || card.life === 'draft' || card.life === 'archived') continue;
        const again = events.filter(e => e.rating === 1).length, hard = events.filter(e => e.rating === 2).length, last = events.at(-1)!.rating;
        const difficulty = typeof card.schedule?.difficulty === 'number' && events.length >= 2 ? card.schedule.difficulty as number : undefined;
        const reasons: string[] = [];
        if (again >= 3) reasons.push(`Forgotten ${again} times`);
        else if (again && again / events.length >= 0.4) reasons.push(`Forgotten ${again} of ${events.length} reviews`);
        if (last === 1) reasons.push('Forgotten at the last review');
        if (hard >= 2 && hard / events.length >= 0.5) reasons.push(`Rated Hard ${hard} times`);
        if (difficulty !== undefined && difficulty >= 8) reasons.push(`High difficulty (${difficulty.toFixed(1)} / 10)`);
        if (!reasons.length) continue;
        const recentGood = events.slice(-5).filter(e => e.rating >= 3).length;
        out.push({ card, reviews: events.length, again, hard, last, difficulty, reasons, score: again * 3 + hard + (last === 1 ? 3 : 0) + (difficulty ?? 0) / 2 - recentGood });
    }
    return out.sort((a, b) => b.score - a.score);
}

export type QuestionInsight = { quiz: Quiz; question: QuizQuestion; answered: number; wrong: number; lastCorrect: boolean; commonWrong?: { answer: string; count: number }; score: number };
/** Quiz questions answered wrongly at the latest attempt or at least half the time, worst first. */
export function questionInsights(w: Pick<Workspace, 'quizzes' | 'quizAttempts'>): QuestionInsight[] {
    const out: QuestionInsight[] = [];
    for (const quiz of w.quizzes || []) {
        const stats = new Map<string, { answered: number; wrong: number; last: boolean; wrongAnswers: Map<string, number> }>();
        for (const a of (w.quizAttempts || []).filter(a => a.quiz === quiz.id)) for (const r of a.results) {
            const q = quiz.questions.find(q => q.id === r.question);
            if (!q) continue;
            const s = stats.get(q.id) ?? { answered: 0, wrong: 0, last: true, wrongAnswers: new Map() };
            s.answered++; s.last = r.correct;
            if (!r.correct) { s.wrong++; const text = describeAnswer(q, r.answer); if (text !== 'No answer') s.wrongAnswers.set(text, (s.wrongAnswers.get(text) || 0) + 1); }
            stats.set(q.id, s);
        }
        for (const question of quiz.questions) {
            const s = stats.get(question.id);
            if (!s?.wrong || (s.last && s.wrong / s.answered < 0.5)) continue;
            const [answer, count] = [...s.wrongAnswers].sort((a, b) => b[1] - a[1])[0] ?? [];
            out.push({ quiz, question, answered: s.answered, wrong: s.wrong, lastCorrect: s.last, commonWrong: answer && count! >= 2 ? { answer, count: count! } : undefined, score: s.wrong / s.answered * 10 + s.wrong + (s.last ? 0 : 3) });
        }
    }
    return out.sort((a, b) => b.score - a.score);
}

export type QuizSummary = { quiz: Quiz; attempts: number; best?: number; last?: number; first?: number; average?: number; weak: number };
/** Per-quiz scores. Best, first and average use full attempts only; retries of wrong answers would inflate them. */
export function quizSummaries(w: Pick<Workspace, 'quizzes' | 'quizAttempts'>, weak: QuestionInsight[]): QuizSummary[] {
    return (w.quizzes || []).map(quiz => {
        const all = (w.quizAttempts || []).filter(a => a.quiz === quiz.id), full = all.filter(a => a.total === quiz.questions.length);
        return { quiz, attempts: all.length, best: full.length ? Math.max(...full.map(pct)) : undefined, last: all.length ? pct(all.at(-1)!) : undefined, first: full.length ? pct(full[0]) : undefined, average: full.length ? Math.round(full.reduce((t, a) => t + pct(a), 0) / full.length) : undefined, weak: weak.filter(x => x.quiz.id === quiz.id).length };
    });
}

export type SubjectInsight = { id: string; name: string; quizAnswered: number; quizCorrect: number; reviews: number; recalled: number; weakQuestions: number; strugglingCards: number };
/** Quiz accuracy and flashcard recall (Good or Easy) per subject; '' collects uncategorised work. */
export function subjectInsights(w: Workspace, cards: CardInsight[], questions: QuestionInsight[]): SubjectInsight[] {
    const known = new Set(w.subjects.map(s => s.id)), of = (subject: string) => known.has(subject) ? subject : '';
    const rows = new Map<string, SubjectInsight>([...w.subjects, { id: '', name: 'Uncategorised' }].map(s => [s.id, { id: s.id, name: s.name, quizAnswered: 0, quizCorrect: 0, reviews: 0, recalled: 0, weakQuestions: 0, strugglingCards: 0 }]));
    const quizSubject = new Map((w.quizzes || []).map(q => [q.id, of(q.subject)]));
    for (const a of w.quizAttempts || []) { const row = rows.get(quizSubject.get(a.quiz) ?? ''); if (row && quizSubject.has(a.quiz)) { row.quizAnswered += a.total; row.quizCorrect += a.score; } }
    const cardSubject = new Map(w.cards.map(c => [c.id, of(c.subject)]));
    for (const e of w.events) { const row = cardSubject.has(e.card) ? rows.get(cardSubject.get(e.card)!) : undefined; if (row) { row.reviews++; if (e.rating >= 3) row.recalled++; } }
    for (const x of questions) rows.get(of(x.quiz.subject))!.weakQuestions++;
    for (const x of cards) rows.get(of(x.card.subject))!.strugglingCards++;
    return [...rows.values()].filter(r => r.quizAnswered || r.reviews);
}
