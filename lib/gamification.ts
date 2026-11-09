import { z } from 'zod';
import { day, linksForNote, type FocusRecord, type LinkedNote, type StudyGoals } from './study.ts';
import type { QuizAttempt } from './quiz.ts';
import { SPECIALS, SPECIAL_UNLOCKS, groveFacts, groveOf, mergeGrove, speciesById, type GroveFacts } from './grove.ts';
import type { Grove } from './study.ts';

/*
 * Gentle gamification: XP, levels, goals and badges. Everything is computed from activity the
 * workspace already records (review events, quiz attempts, notes, cards, synced focus time), so
 * existing history counts and nothing can drift. Nothing resets: there are no streaks to lose.
 * Only goal settings, focus totals and badge unlock dates are stored (see Workspace in study.ts).
 */

export type GameWorkspace = {
    zone: string;
    subjects: { id: string }[];
    notes: LinkedNote[];
    cards: { life: string }[];
    events: { at: string; introduced: boolean }[];
    quizAttempts?: QuizAttempt[];
    focus?: FocusRecord;
    goals?: StudyGoals;
    achievements?: Record<string, string>;
    grove?: Grove;
};

export const DEFAULT_GOALS: StudyGoals = { reviews: 20, focusMinutes: 25, weekDays: 4, celebrate: true };
export const goalsOf = (w: Pick<GameWorkspace, 'goals'>): StudyGoals => ({ ...DEFAULT_GOALS, ...w.goals });

// ---------- XP and levels ----------
export const XP = { review: 10, newCard: 5, correctAnswer: 2, quizFinished: 15, perfectTest: 25, focusMinute: 1 } as const;
const perfectTest = (a: QuizAttempt) => a.mode === 'test' && a.total >= 5 && a.score === a.total;
export const attemptXp = (a: QuizAttempt) => a.score * XP.correctAnswer + XP.quizFinished + (perfectTest(a) ? XP.perfectTest : 0);
const focusMs = (w: GameWorkspace) => Object.values(w.focus?.days || {}).reduce((n, d) => n + d.ms, 0);

export function xp(w: GameWorkspace) {
    const reviews = w.events.length * XP.review + w.events.filter(e => e.introduced).length * XP.newCard;
    const quizzes = (w.quizAttempts || []).reduce((n, a) => n + attemptXp(a), 0);
    const focus = Math.floor(focusMs(w) / 60000) * XP.focusMinute;
    return { total: reviews + quizzes + focus, reviews, quizzes, focus };
}

const TITLES = ['Curious', 'Steady', 'Focused', 'Diligent', 'Scholar', 'Expert', 'Master', 'Sage', 'Luminary', 'Virtuoso', 'Mastermind', 'Legend'];
/** Level n starts at 50·(n−1)·n XP: 0, 100, 300, 600, 1000 … so each level needs 100 more than the last. */
export function level(total: number) {
    let n = 1;
    while (50 * n * (n + 1) <= total) n++;
    const start = 50 * (n - 1) * n;
    return { level: n, title: TITLES[n - 1] || `Legend ${n - TITLES.length + 1}`, into: total - start, needed: 100 * n };
}

// ---------- days, today and this week ----------
const toKey = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (key: string, n: number) => { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return toKey(d); };
/** Monday of the week containing `key`. */
const weekStart = (key: string) => { const d = new Date(key + 'T00:00:00Z'); return addDays(key, -((d.getUTCDay() + 6) % 7)); };

/** Every day (in the workspace time zone) with a review, a quiz attempt or focus time. */
export function studyDays(w: GameWorkspace): Set<string> {
    const days = new Set<string>();
    for (const e of w.events) days.add(day(e.at, w.zone));
    for (const a of w.quizAttempts || []) days.add(day(a.at, w.zone));
    for (const [key, d] of Object.entries(w.focus?.days || {})) if (d.ms > 0) days.add(key);
    return days;
}

export function today(w: GameWorkspace, now = new Date()) {
    const key = day(now, w.zone);
    return { key, reviews: w.events.filter(e => day(e.at, w.zone) === key).length, focusMinutes: Math.floor((w.focus?.days[key]?.ms || 0) / 60000) };
}

/** This week, Monday to Sunday: which days had any study. A count, never a streak that resets. */
export function week(w: GameWorkspace, now = new Date()) {
    const todayKey = day(now, w.zone), start = weekStart(todayKey), days = studyDays(w);
    const list = Array.from({ length: 7 }, (_, i) => { const key = addDays(start, i); return { key, studied: days.has(key), today: key === todayKey, future: key > todayKey }; });
    return { days: list, studied: list.filter(d => d.studied).length };
}

// ---------- badges ----------
/*
 * Badges come in ranked series (Bronze → Legend) for each kind of activity, plus level milestones
 * and a few special ones. Badge ids are stable: unlock dates are stored against them.
 */
export type BadgeIcon = 'tree' | 'spark' | 'layers' | 'trophy' | 'quiz' | 'timer' | 'note' | 'link' | 'folder' | 'calendar' | 'heart' | 'star' | 'sunrise' | 'moon' | 'flame' | 'target' | 'brain' | 'crown';
export type BadgeCategory = 'Reviews' | 'Flashcards' | 'Quizzes' | 'Focus' | 'Grove' | 'Notes' | 'Consistency' | 'Levels' | 'Special';
export const CATEGORIES: BadgeCategory[] = ['Reviews', 'Flashcards', 'Quizzes', 'Focus', 'Grove', 'Notes', 'Consistency', 'Levels', 'Special'];
export const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Legend'] as const;
export type Badge = { id: string; name: string; hint: string; icon: BadgeIcon; category: BadgeCategory; /** 1 = Bronze … 7 = Legend; absent for one-off badges. */ tier?: number; progress: (w: GameWorkspace) => { have: number; need: number } };

/** Everything the badges measure, computed once per workspace object. */
export type Stats = {
    reviews: number; remembered: number; easy: number; newCards: number; activeCards: number; bestReviewDay: number; reviewGoalDays: number;
    attempts: number; perfect: number; correct: number; highScores: number;
    focusRounds: number; focusHours: number; bestFocusDay: number; treesGrown: number; treeKinds: number; grove: GroveFacts; lands: number; weathers: number;
    notes: number; links: number; subjects: number;
    studyDays: number; bestWeek: number; goalWeeks: number; fullWeeks: number;
    level: number; cameBack: boolean; earlyBird: boolean; nightOwl: boolean; weekend: boolean; allRounder: boolean;
};
const cache = new WeakMap<object, Stats>();
const grove = (w: GameWorkspace) => groveFacts(groveOf(w), w.zone);
function hourIn(at: string, zone: string) { try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(at))); } catch { return new Date(at).getUTCHours(); } }
export function stats(w: GameWorkspace): Stats {
    const hit = cache.get(w); if (hit) return hit;
    const goals = goalsOf(w), attempts = w.quizAttempts || [], focusDays = Object.entries(w.focus?.days || {}).filter(([, d]) => d.ms > 0);
    const events = w.events as { at: string; introduced: boolean; rating?: number }[];
    const perDay = new Map<string, number>();
    for (const e of events) { const k = day(e.at, w.zone); perDay.set(k, (perDay.get(k) || 0) + 1); }
    const days = studyDays(w), sorted = [...days].sort();
    const weeks = new Map<string, number>();
    for (const k of days) weeks.set(weekStart(k), (weeks.get(weekStart(k)) || 0) + 1);
    const hours = [...events.map(e => e.at), ...attempts.map(a => a.at)].map(at => hourIn(at, w.zone));
    const quizDays = new Set(attempts.map(a => day(a.at, w.zone))), focusSet = new Set(focusDays.map(([k]) => k));
    const result: Stats = {
        reviews: events.length,
        remembered: events.filter(e => (e.rating ?? 3) >= 3).length,
        easy: events.filter(e => e.rating === 4).length,
        newCards: events.filter(e => e.introduced).length,
        activeCards: w.cards.filter(c => c.life === 'active').length,
        bestReviewDay: Math.max(0, ...perDay.values()),
        reviewGoalDays: [...perDay.values()].filter(n => n >= goals.reviews).length,
        attempts: attempts.length,
        perfect: attempts.filter(perfectTest).length,
        correct: attempts.reduce((n, a) => n + a.score, 0),
        highScores: attempts.filter(a => a.total >= 5 && a.score / a.total >= 0.9).length,
        focusRounds: focusDays.reduce((n, [, d]) => n + d.rounds, 0),
        focusHours: Math.floor(focusMs(w) / 3600000),
        bestFocusDay: Math.max(0, ...focusDays.map(([, d]) => Math.floor(d.ms / 60000))),
        treesGrown: (w.grove?.trees || []).filter(t => !t.withered).length,
        treeKinds: new Set(['oak', ...(w.grove?.owned || [])]).size,
        grove: grove(w),
        lands: groveOf(w).lands!.length,
        weathers: groveOf(w).weathers!.length,
        notes: w.notes.length,
        links: w.notes.reduce((n, note) => n + new Set(linksForNote(note)).size, 0),
        subjects: w.subjects.length,
        studyDays: days.size,
        bestWeek: Math.max(0, ...weeks.values()),
        goalWeeks: [...weeks.values()].filter(n => n >= goals.weekDays).length,
        fullWeeks: [...weeks.values()].filter(n => n >= 7).length,
        level: level(xp(w).total).level,
        cameBack: sorted.some((k, i) => i > 0 && (Date.parse(k) - Date.parse(sorted[i - 1])) / 86400000 >= 7),
        earlyBird: hours.some(h => h >= 4 && h < 7),
        nightOwl: hours.some(h => h >= 23 || h < 3),
        weekend: sorted.some(k => new Date(k + 'T00:00:00Z').getUTCDay() === 6 && days.has(addDays(k, 1))),
        allRounder: [...perDay.keys()].some(k => quizDays.has(k) && focusSet.has(k)),
    };
    cache.set(w, result);
    return result;
}

const count = (need: number, have: number) => ({ have: Math.min(have, need), need });
const flag = (yes: boolean) => ({ have: yes ? 1 : 0, need: 1 });
type Rung = [id: string, need: number, name: string];
/** A ranked series: each rung needs more of the same measure, and ranks Bronze, Silver, Gold… */
function series(category: BadgeCategory, icon: BadgeIcon, measure: (s: Stats) => number, hint: (n: string) => string, rungs: Rung[]): Badge[] {
    return rungs.map(([id, need, name], i) => ({ id, name, hint: hint(need.toLocaleString('en')), icon, category, tier: Math.min(i + 1, TIERS.length), progress: w => count(need, measure(stats(w))) }));
}
const one = (category: BadgeCategory, icon: BadgeIcon, id: string, name: string, hint: string, test: (s: Stats) => boolean): Badge => ({ id, name, hint, icon, category, progress: w => flag(test(stats(w))) });

export const BADGES: Badge[] = [
    ...series('Reviews', 'spark', s => s.reviews, n => `Review ${n} flashcard${n === '1' ? '' : 's'}`, [['first-review', 1, 'First recall'], ['reviews-100', 100, 'Hundred recalls'], ['reviews-500', 500, 'Memory builder'], ['reviews-1000', 1000, 'Thousand recalls'], ['reviews-2500', 2500, 'Recall machine'], ['reviews-5000', 5000, 'Memory palace'], ['reviews-10000', 10000, 'Total recall']]),
    ...series('Reviews', 'brain', s => s.remembered, n => `Remember ${n} cards (Good or Easy)`, [['remembered-50', 50, 'It sticks'], ['remembered-250', 250, 'Sharp mind'], ['remembered-1000', 1000, 'Iron memory'], ['remembered-5000', 5000, 'Unforgettable']]),
    ...series('Reviews', 'flame', s => s.bestReviewDay, n => `Review ${n} cards in one day`, [['day-reviews-50', 50, 'Busy day'], ['day-reviews-100', 100, 'Review marathon'], ['day-reviews-250', 250, 'Ultra session']]),
    ...series('Flashcards', 'layers', s => s.activeCards, n => `Have ${n} active flashcards`, [['cards-10', 10, 'Starter deck'], ['cards-50', 50, 'Card collector'], ['cards-100', 100, 'Full deck'], ['cards-250', 250, 'Card library'], ['cards-500', 500, 'Card archive'], ['cards-1000', 1000, 'Card vault']]),
    ...series('Flashcards', 'star', s => s.newCards, n => `Learn ${n} new cards`, [['learned-25', 25, 'Fresh start'], ['learned-100', 100, 'Quick learner'], ['learned-500', 500, 'Knowledge sponge'], ['learned-1000', 1000, 'Walking encyclopedia']]),
    ...series('Quizzes', 'quiz', s => s.attempts, n => `Finish ${n} quiz attempt${n === '1' ? '' : 's'}`, [['first-quiz', 1, 'Quiz taker'], ['quizzes-10', 10, 'Quiz regular'], ['quizzes-25', 25, 'Quiz enthusiast'], ['quizzes-50', 50, 'Quiz veteran'], ['quizzes-100', 100, 'Quiz champion']]),
    ...series('Quizzes', 'trophy', s => s.perfect, n => `Score 100% on ${n} test${n === '1' ? '' : 's'} of 5+ questions`, [['perfect-test', 1, 'Perfect score'], ['perfect-5', 5, 'Flawless five'], ['perfect-10', 10, 'Perfectionist'], ['perfect-25', 25, 'Untouchable']]),
    ...series('Quizzes', 'target', s => s.correct, n => `Answer ${n} quiz questions correctly`, [['correct-100', 100, 'On target'], ['correct-500', 500, 'Sharpshooter'], ['correct-1000', 1000, 'Bullseye'], ['correct-5000', 5000, 'Oracle']]),
    ...series('Quizzes', 'star', s => s.highScores, n => `Score 90%+ on ${n} quizzes of 5+ questions`, [['high-5', 5, 'High achiever'], ['high-25', 25, 'Top of the class']]),
    ...series('Focus', 'timer', s => s.focusRounds, n => `Complete ${n} focus round${n === '1' ? '' : 's'}`, [['first-focus', 1, 'In the zone'], ['focus-10', 10, 'Deep worker'], ['focus-50', 50, 'Flow seeker'], ['focus-100', 100, 'Flow master'], ['focus-250', 250, 'Monk mode']]),
    ...series('Focus', 'flame', s => s.focusHours, n => `Focus for ${n} hour${n === '1' ? '' : 's'} in total`, [['focus-hours-1', 1, 'First focused hour'], ['focus-hours-10', 10, 'Ten focused hours'], ['focus-hours-25', 25, 'Quarter century'], ['focus-hours-50', 50, 'Fifty focused hours'], ['focus-hours-100', 100, 'Hundred-hour club']]),
    ...series('Focus', 'timer', s => s.bestFocusDay, n => `Focus for ${n} minutes in one day`, [['day-focus-100', 100, 'Long haul'], ['day-focus-200', 200, 'Deep day'], ['day-focus-300', 300, 'Marathon mind']]),
    ...series('Grove', 'tree', s => s.treesGrown, n => `Grow ${n} tree${n === '1' ? '' : 's'} in your grove`, [['trees-1', 1, 'First seedling'], ['trees-10', 10, 'Little grove'], ['trees-50', 50, 'Woodland'], ['trees-100', 100, 'Forest keeper'], ['trees-250', 250, 'Old-growth']]),
    ...series('Grove', 'tree', s => s.treeKinds, n => `Unlock ${n} kinds of tree`, [['tree-kinds-3', 3, 'Plant collector'], ['tree-kinds-6', 6, 'Arboretum'], ['tree-kinds-12', 12, 'Botanist'], ['tree-kinds-20', 20, 'Master gardener'], ['tree-kinds-26', 26, 'Botanical garden']]),
    // Grove: special trees, seasons and gardening feats.
    ...SPECIALS.map((t): Badge => ({ id: 'tree-' + t.id, name: t.name, hint: 'Unlock: ' + SPECIAL_UNLOCKS[t.id].hint.charAt(0).toLowerCase() + SPECIAL_UNLOCKS[t.id].hint.slice(1), icon: 'tree', category: 'Grove', progress: w => { const g = groveOf(w); return g.owned.includes(t.id) ? { have: 1, need: 1 } : SPECIAL_UNLOCKS[t.id].progress(grove(w), g); } })),
    ...(['spring', 'summer', 'autumn', 'winter'] as const).map((season): Badge => ({ id: 'season-' + season, name: `${season[0].toUpperCase() + season.slice(1)} gardener`, hint: `Grow the ${speciesById({ spring: 'springbloom', summer: 'sunflower', autumn: 'ember', winter: 'frost' }[season]).name} in ${season}`, icon: 'calendar', category: 'Grove', progress: w => count(1, grove(w).seasons.has(season) ? 1 : 0) })),
    { id: 'four-seasons', name: 'Four seasons', hint: 'Grow every seasonal tree', icon: 'crown', category: 'Grove', progress: w => count(4, grove(w).seasons.size) },
    ...series('Grove', 'star', s => s.lands, n => `Own ${n} lands for your grove`, [['lands-3', 3, 'Landscaper'], ['lands-6', 6, 'Explorer'], ['lands-11', 11, 'World builder']]),
    ...series('Grove', 'spark', s => s.weathers, n => `Own ${n} kinds of weather`, [['weathers-3', 3, 'Weather watcher'], ['weathers-6', 6, 'Storm chaser'], ['weathers-11', 11, 'Weather maker']]),
    one('Grove', 'heart', 'clean-week', 'Not a leaf lost', 'Grow 5 or more trees in a week with none withered', s => s.grove.cleanWeek),
    one('Grove', 'heart', 'second-chance', 'Second chance', 'Grow a tree on a day when one withered', s => s.grove.secondChance),
    one('Grove', 'timer', 'deep-60', 'Deep focus', 'Finish a focus round of an hour or more', s => s.grove.longest >= 60),
    ...series('Grove', 'flame', s => s.grove.bestDay, n => `Grow ${n} trees in one day`, [['grove-day-3', 3, 'Busy gardener'], ['grove-day-10', 10, 'Planting spree']]),
    ...series('Grove', 'trophy', s => s.grove.cleanRun, n => `Grow ${n} trees in a row without one withering`, [['unbroken-5', 5, 'Steady hands'], ['unbroken-25', 25, 'Unbroken'], ['unbroken-100', 100, 'Evergreen']]),
    ...series('Grove', 'star', s => s.grove.coins, n => `Save ${n} coins at once`, [['coins-500', 500, 'Piggy bank'], ['coins-2000', 2000, 'Treasure chest']]),
    ...series('Grove', 'crown', s => s.grove.spent, n => `Spend ${n} coins on trees`, [['spent-500', 500, 'Shopper'], ['spent-2000', 2000, 'Big spender'], ['spent-10000', 10000, 'Patron of the forest']]),
    ...series('Notes', 'note', s => s.notes, n => `Write ${n} note${n === '1' ? '' : 's'}`, [['first-note', 1, 'First page'], ['notes-10', 10, 'Note taker'], ['notes-25', 25, 'Notebook'], ['notes-50', 50, 'Chronicler'], ['notes-100', 100, 'Archivist'], ['notes-250', 250, 'Library builder']]),
    ...series('Notes', 'link', s => s.links, n => `Link notes together ${n} times with [[links]]`, [['links-5', 5, 'Bridge builder'], ['links-20', 20, 'Connector'], ['links-50', 50, 'Web weaver'], ['links-100', 100, 'Knowledge graph'], ['links-250', 250, 'Second brain']]),
    ...series('Notes', 'folder', s => s.subjects, n => `Create ${n} subject${n === '1' ? '' : 's'}`, [['first-subject', 1, 'Organised'], ['subjects-3', 3, 'Well rounded'], ['subjects-5', 5, 'Polymath'], ['subjects-10', 10, 'Renaissance mind']]),
    ...series('Consistency', 'calendar', s => s.studyDays, n => `Study on ${n} different days`, [['days-7', 7, 'First week'], ['days-30', 30, 'Thirty study days'], ['days-60', 60, 'Two months in'], ['days-100', 100, 'Hundred days'], ['days-200', 200, 'Two hundred days'], ['days-365', 365, 'A year of learning']]),
    ...series('Consistency', 'calendar', s => s.bestWeek, n => `Study on ${n} days in one week`, [['week-3', 3, 'Good rhythm'], ['week-5', 5, 'Good week'], ['week-7', 7, 'Perfect week']]),
    ...series('Consistency', 'target', s => s.goalWeeks, n => `Meet your weekly goal ${n} times`, [['goal-weeks-4', 4, 'On track'], ['goal-weeks-12', 12, 'Dependable'], ['goal-weeks-26', 26, 'Half-year habit'], ['goal-weeks-52', 52, 'Year-round learner']]),
    ...series('Consistency', 'spark', s => s.reviewGoalDays, n => `Meet your daily review goal on ${n} days`, [['goal-days-7', 7, 'Goal getter'], ['goal-days-30', 30, 'Goal crusher'], ['goal-days-100', 100, 'Goal machine']]),
    ...series('Levels', 'crown', s => s.level, n => `Reach level ${n}`, [['level-3', 3, 'Rising'], ['level-5', 5, 'Scholar'], ['level-10', 10, 'Expert'], ['level-15', 15, 'Master'], ['level-20', 20, 'Grandmaster'], ['level-30', 30, 'Legend']]),
    one('Special', 'heart', 'welcome-back', 'Welcome back', 'Return to studying after a week or more away', s => s.cameBack),
    one('Special', 'sunrise', 'early-bird', 'Early bird', 'Study between 4 and 7 in the morning', s => s.earlyBird),
    one('Special', 'moon', 'night-owl', 'Night owl', 'Study between 11 at night and 3 in the morning', s => s.nightOwl),
    one('Special', 'calendar', 'weekend-warrior', 'Weekend warrior', 'Study on both days of a weekend', s => s.weekend),
    one('Special', 'star', 'all-rounder', 'All-rounder', 'Review cards, take a quiz and focus on the same day', s => s.allRounder),
    one('Special', 'heart', 'easy-100', 'Second nature', 'Rate 100 cards Easy', s => s.easy >= 100),
];
export const BADGE_IDS = new Set(BADGES.map(b => b.id));

/** Badges whose condition is met now, plus any unlocked before (an unlock is never taken away). */
export function earnedBadges(w: GameWorkspace) {
    return new Set([...BADGES.filter(b => { const p = b.progress(w); return p.have >= p.need; }).map(b => b.id), ...Object.keys(w.achievements || {}).filter(id => BADGE_IDS.has(id))]);
}

/** The locked badges closest to being earned (by share of progress made). */
export function nextBadges(w: GameWorkspace, limit = 3) {
    const earned = earnedBadges(w);
    return BADGES.filter(b => !earned.has(b.id)).map(b => ({ badge: b, ...b.progress(w) })).filter(b => b.have > 0).sort((a, b) => b.have / b.need - a.have / a.need).slice(0, limit);
}

// ---------- server-side updates (validated) ----------
type Mutable = { zone: string; focus?: FocusRecord; goals?: StudyGoals; achievements?: Record<string, string> };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const focusOf = (w: Mutable) => (w.focus ||= { days: {}, recent: [], imported: [] });

const roundInput = z.object({ id: z.string().min(1).max(100), at: z.string().datetime(), ms: z.number().int().min(60000).max(4 * 3600000) });
/** Adds one completed focus round. Sending the same round again changes nothing. */
export function recordFocusRound(w: Mutable, input: unknown) {
    const p = roundInput.parse(input), f = focusOf(w);
    if (f.recent.includes(p.id)) return false;
    const key = day(p.at, w.zone), d = f.days[key] || { ms: 0, rounds: 0 };
    f.days[key] = { ms: d.ms + p.ms, rounds: d.rounds + 1 };
    f.recent = [...f.recent, p.id].slice(-500);
    return true;
}

const importInput = z.object({ device: z.string().min(1).max(100), days: z.record(z.string().regex(DAY), z.object({ ms: z.number().int().min(0).max(86400000), rounds: z.number().int().min(0).max(200) })).refine(d => Object.keys(d).length <= 1000) });
/** Adds one browser's focus history from before syncing existed, once per device. */
export function importFocusDays(w: Mutable, input: unknown) {
    const p = importInput.parse(input), f = focusOf(w);
    if (f.imported.includes(p.device)) return false;
    for (const [key, d] of Object.entries(p.days)) { const cur = f.days[key] || { ms: 0, rounds: 0 }; f.days[key] = { ms: cur.ms + d.ms, rounds: cur.rounds + d.rounds }; }
    f.imported = [...f.imported, p.device].slice(-50);
    return true;
}

const unlockInput = z.object({ ids: z.array(z.string().max(50)).max(BADGES.length) });
/** Records when badges were unlocked; the first date is kept. */
export function unlock(w: Mutable, input: unknown, now = new Date()) {
    const { ids } = unlockInput.parse(input);
    w.achievements ||= {};
    for (const id of ids) if (BADGE_IDS.has(id)) w.achievements[id] ||= now.toISOString();
}

const goalsInput = z.object({ reviews: z.number().int().min(1).max(500), focusMinutes: z.number().int().min(5).max(600), weekDays: z.number().int().min(1).max(7), celebrate: z.boolean() });
export function setGoals(w: Mutable, input: unknown) { w.goals = goalsInput.parse(input); }

/** Folds a restored backup's gamification data into a workspace without double counting. */
export function mergeGamification(target: Mutable, source: Partial<Mutable>) {
    if (source.focus && typeof source.focus === 'object') {
        const f = focusOf(target);
        for (const [key, d] of Object.entries(source.focus.days || {})) {
            if (!DAY.test(key) || typeof d?.ms !== 'number' || typeof d?.rounds !== 'number') continue;
            const cur = f.days[key] || { ms: 0, rounds: 0 };
            // The larger day wins: restoring your own backup must not double the time.
            if (d.ms > cur.ms) f.days[key] = { ms: Math.min(d.ms, 86400000), rounds: Math.min(Math.max(0, Math.round(d.rounds)), 200) };
        }
        f.recent = [...new Set([...f.recent, ...(source.focus.recent || []).filter(x => typeof x === 'string')])].slice(-500);
        f.imported = [...new Set([...f.imported, ...(source.focus.imported || []).filter(x => typeof x === 'string')])].slice(-50);
    }
    for (const [id, at] of Object.entries(source.achievements || {})) {
        if (!BADGE_IDS.has(id) || typeof at !== 'string') continue;
        target.achievements ||= {};
        if (!target.achievements[id] || at < target.achievements[id]) target.achievements[id] = at;
    }
    mergeGrove(target as { grove?: Grove }, source as { grove?: unknown });
    if (!target.goals && source.goals) { try { setGoals(target, source.goals); } catch { /* invalid goals in the backup are ignored */ } }
}
