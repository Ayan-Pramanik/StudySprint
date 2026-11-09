import test from 'node:test';
import assert from 'node:assert/strict';
import { BADGES, CATEGORIES, TIERS, earnedBadges, nextBadges, stats, goalsOf, importFocusDays, level, mergeGamification, recordFocusRound, setGoals, today, unlock, week, xp } from '../lib/gamification.ts';

const ws = (extra = {}) => ({ zone: 'UTC', subjects: [], notes: [], cards: [], events: [], quizAttempts: [], ...extra });
const ev = (at, introduced = false) => ({ id: at, card: 'c', rating: 3, at, due: at, introduced });
const attempt = (at, score, total, mode = 'test') => ({ id: at, quiz: 'q', at, mode, seconds: 60, results: [], score, total });

test('XP comes from reviews, quiz attempts and focus minutes', () => {
    const w = ws({ events: [ev('2026-11-02T10:00:00Z', true), ev('2026-11-02T11:00:00Z')], quizAttempts: [attempt('2026-11-03T10:00:00Z', 5, 5), attempt('2026-11-03T11:00:00Z', 2, 4, 'practice')], focus: { days: { '2026-11-04': { ms: 25 * 60000, rounds: 1 } }, recent: [], imported: [] } });
    // reviews 2×10 + 5 new; quizzes (5×2+15+25) + (2×2+15); focus 25.
    assert.deepEqual(xp(w), { total: 25 + 69 + 25, reviews: 25, quizzes: 69, focus: 25 });
});

test('levels need 100 more XP each time', () => {
    assert.deepEqual(level(0), { level: 1, title: 'Curious', into: 0, needed: 100 });
    assert.deepEqual(level(99), { level: 1, title: 'Curious', into: 99, needed: 100 });
    assert.deepEqual(level(100), { level: 2, title: 'Steady', into: 0, needed: 200 });
    assert.deepEqual(level(650), { level: 4, title: 'Diligent', into: 50, needed: 400 });
    assert.equal(level(50 * 8 * 9).title, 'Luminary');
    assert.equal(level(50 * 12 * 13).title, 'Legend 2');
});

test('today and this week use the workspace time zone and never reset mid-week', () => {
    // 23:30 UTC on Sunday is already Monday in Sydney.
    const w = ws({ zone: 'Australia/Sydney', events: [ev('2026-11-08T23:30:00Z'), ev('2026-11-10T01:00:00Z')], quizAttempts: [attempt('2026-11-11T02:00:00Z', 1, 2)] });
    const now = new Date('2026-11-12T03:00:00Z'); // Thursday in Sydney
    assert.deepEqual(today(w, now), { key: '2026-11-12', reviews: 0, focusMinutes: 0 });
    const wk = week(w, now);
    assert.equal(wk.days[0].key, '2026-11-09');
    assert.deepEqual(wk.days.map(d => d.studied), [true, true, true, false, false, false, false]);
    assert.equal(wk.studied, 3);
    assert.equal(wk.days[3].today, true);
    assert.equal(wk.days[4].future, true);
});

test('badges show progress and stay unlocked once earned', () => {
    const w = ws({ events: Array.from({ length: 63 }, (_, i) => ev(new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString())), subjects: [{ id: 's' }] });
    const hundred = BADGES.find(b => b.id === 'reviews-100');
    assert.deepEqual(hundred.progress(w), { have: 63, need: 100 });
    const earned = earnedBadges(w);
    assert.ok(earned.has('first-review') && earned.has('first-subject'));
    assert.ok(!earned.has('reviews-100'));
    // Deleting the subject later doesn't take the badge away once its unlock was recorded.
    unlock(w, { ids: ['first-subject', 'not-a-badge'] }, new Date('2026-11-05T00:00:00Z'));
    assert.deepEqual(Object.keys(w.achievements), ['first-subject']);
    w.subjects = [];
    assert.ok(earnedBadges(w).has('first-subject'));
    unlock(w, { ids: ['first-subject'] }, new Date('2027-01-01T00:00:00Z'));
    assert.equal(w.achievements['first-subject'], '2026-11-05T00:00:00.000Z');
});

test('welcome back and best-week badges', () => {
    const w = ws({ events: ['2026-10-01', '2026-10-12', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map(d => ev(d + 'T09:00:00Z')) });
    const earned = earnedBadges(w);
    assert.ok(earned.has('welcome-back'));
    assert.ok(earned.has('week-5'));
});

test('a focus round counts once, and a device backfills its history once', () => {
    const w = ws({ zone: 'UTC' });
    assert.equal(recordFocusRound(w, { id: 'r1', at: '2026-11-09T10:00:00Z', ms: 1500000 }), true);
    assert.equal(recordFocusRound(w, { id: 'r1', at: '2026-11-09T10:00:00Z', ms: 1500000 }), false);
    assert.deepEqual(w.focus.days['2026-11-09'], { ms: 1500000, rounds: 1 });
    assert.equal(importFocusDays(w, { device: 'd1', days: { '2026-11-01': { ms: 3000000, rounds: 2 } } }), true);
    assert.equal(importFocusDays(w, { device: 'd1', days: { '2026-11-01': { ms: 3000000, rounds: 2 } } }), false);
    assert.equal(w.focus.days['2026-11-01'].rounds, 2);
    assert.throws(() => recordFocusRound(w, { id: 'r2', at: '2026-11-09T10:00:00Z', ms: 5 }));
});

test('goals are validated and have defaults', () => {
    assert.deepEqual(goalsOf({}), { reviews: 20, focusMinutes: 25, weekDays: 4, celebrate: true });
    const w = ws();
    setGoals(w, { reviews: 30, focusMinutes: 50, weekDays: 5, celebrate: false });
    assert.equal(goalsOf(w).weekDays, 5);
    assert.throws(() => setGoals(w, { reviews: 0, focusMinutes: 50, weekDays: 5, celebrate: true }));
    assert.throws(() => setGoals(w, { reviews: 10, focusMinutes: 50, weekDays: 8, celebrate: true }));
});

test('restoring a backup merges focus and badges without double counting', () => {
    const w = ws({ focus: { days: { '2026-11-01': { ms: 1500000, rounds: 1 } }, recent: ['a'], imported: [] }, achievements: { 'first-review': '2026-11-03T00:00:00Z' } });
    mergeGamification(w, { focus: { days: { '2026-11-01': { ms: 1500000, rounds: 1 }, '2026-11-02': { ms: 3000000, rounds: 2 } }, recent: ['a', 'b'], imported: ['d'] }, achievements: { 'first-review': '2026-11-01T00:00:00Z', 'bogus': 'x' }, goals: { reviews: 5, focusMinutes: 10, weekDays: 2, celebrate: true } });
    assert.deepEqual(w.focus.days, { '2026-11-01': { ms: 1500000, rounds: 1 }, '2026-11-02': { ms: 3000000, rounds: 2 } });
    assert.deepEqual(w.focus.recent, ['a', 'b']);
    assert.deepEqual(w.achievements, { 'first-review': '2026-11-01T00:00:00Z' });
    assert.equal(w.goals.reviews, 5);
});

test('badges come in ranked series with unique ids, and the old ids still exist', () => {
    const ids = BADGES.map(b => b.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(BADGES.length >= 90);
    for (const old of ['first-review', 'reviews-100', 'reviews-1000', 'cards-50', 'first-quiz', 'perfect-test', 'quizzes-10', 'first-focus', 'focus-10', 'focus-hours-10', 'notes-10', 'links-20', 'first-subject', 'week-5', 'days-30', 'welcome-back']) assert.ok(ids.includes(old), old);
    for (const b of BADGES) assert.ok(CATEGORIES.includes(b.category) && (!b.tier || (b.tier >= 1 && b.tier <= TIERS.length)), b.id);
    const reviews = BADGES.filter(b => b.category === 'Reviews' && b.icon === 'spark');
    assert.deepEqual(reviews.map(b => TIERS[b.tier - 1]), ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Legend']);
});

test('special badges: early bird, night owl, weekend, all-rounder, daily bests', () => {
    const w = ws({ events: [ev('2026-11-07T05:30:00Z'), ev('2026-11-08T23:30:00Z'), ...Array.from({ length: 50 }, (_, i) => ev(`2026-11-10T10:${String(i).padStart(2, '0')}:00Z`))], quizAttempts: [attempt('2026-11-10T12:00:00Z', 4, 5)], focus: { days: { '2026-11-10': { ms: 120 * 60000, rounds: 4 } }, recent: [], imported: [] } });
    const s = stats(w);
    assert.equal(s.earlyBird, true);
    assert.equal(s.nightOwl, true);
    assert.equal(s.weekend, true); // Sat 7 Nov and Sun 8 Nov
    assert.equal(s.allRounder, true);
    assert.equal(s.bestReviewDay, 50);
    assert.equal(s.bestFocusDay, 120);
    const earned = earnedBadges(w);
    for (const id of ['early-bird', 'night-owl', 'weekend-warrior', 'all-rounder', 'day-reviews-50', 'day-focus-100']) assert.ok(earned.has(id), id);
});

test('closest-to-unlocking lists locked badges with the most progress first', () => {
    const w = ws({ events: Array.from({ length: 90 }, (_, i) => ev(new Date(Date.UTC(2026, 10, 2, 0, i)).toISOString())) });
    const next = nextBadges(w);
    assert.equal(next[0].badge.id, 'reviews-100');
    assert.deepEqual([next[0].have, next[0].need], [90, 100]);
    assert.ok(next.every(n => !earnedBadges(w).has(n.badge.id)));
});
