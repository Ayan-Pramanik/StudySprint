import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, buyTree, coinsFor, groveOf, mergeGrove, plantTree, selectTree, witherTree } from '../lib/grove.ts';
import { earnedBadges, recordFocusRound } from '../lib/gamification.ts';

const round = (id, minutes, extra = {}) => ({ id, at: '2026-11-09T10:00:00Z', ms: minutes * 60000, ...extra });

test('a new grove starts with the free oak selected and no coins', () => {
    assert.deepEqual(groveOf({}), { trees: [], coins: 0, owned: ['oak'], selected: 'oak', lands: ['meadow'], land: 'meadow', weathers: ['clear'], weather: 'clear' });
    const shop = SPECIES.filter(s => !s.kind);
    assert.equal(shop[0].price, 0);
    assert.ok(shop.every((s, i) => i === 0 || s.price > shop[i - 1].price), 'prices rise through the shop');
    assert.equal(new Set(SPECIES.map(s => s.id)).size, SPECIES.length);
});

test('a finished round grows the selected tree and earns a coin per minute, once', () => {
    const w = {};
    assert.equal(plantTree(w, round('focus-1', 25)), 25);
    assert.equal(plantTree(w, round('focus-1', 25)), 0);
    assert.equal(w.grove.coins, 25);
    assert.deepEqual(w.grove.trees, [{ id: 'focus-1', species: 'oak', at: '2026-11-09T10:00:00Z', minutes: 25 }]);
    assert.equal(coinsFor(59_999), 0);
});

test('an abandoned round leaves a withered tree and no coins', () => {
    const w = {};
    assert.equal(witherTree(w, round('wither-1', 7, { species: 'oak' })), true);
    assert.equal(witherTree(w, round('wither-1', 7)), false);
    assert.equal(w.grove.coins, 0);
    assert.equal(w.grove.trees[0].withered, true);
});

test('coins buy new kinds of tree, which are then grown', () => {
    const w = {};
    for (let i = 0; i < 4; i++) plantTree(w, round('f' + i, 25));
    assert.equal(w.grove.coins, 100);
    assert.throws(() => buyTree(w, { species: 'blossom' }), /need 150 more coins/);
    buyTree(w, { species: 'pine' });
    assert.equal(w.grove.coins, 0);
    assert.deepEqual(w.grove.owned, ['oak', 'pine']);
    assert.equal(w.grove.selected, 'pine');
    plantTree(w, round('f9', 25));
    assert.equal(w.grove.trees.at(-1).species, 'pine');
    // A tree you don't own can't be chosen, even if a client asks for it.
    plantTree(w, round('f10', 25, { species: 'golden' }));
    assert.equal(w.grove.trees.at(-1).species, 'pine');
    assert.throws(() => selectTree(w, { species: 'golden' }));
    selectTree(w, { species: 'oak' });
    assert.equal(w.grove.selected, 'oak');
    assert.throws(() => buyTree(w, { species: 'not-a-tree' }));
});

test('trees count toward badges, and the focus round itself is only counted once', () => {
    const w = { zone: 'UTC', subjects: [], notes: [], cards: [], events: [] };
    if (recordFocusRound(w, round('focus-a', 25))) plantTree(w, round('focus-a', 25));
    if (recordFocusRound(w, round('focus-a', 25))) plantTree(w, round('focus-a', 25));
    assert.equal(w.grove.trees.length, 1);
    assert.equal(w.focus.days['2026-11-09'].rounds, 1);
    assert.ok(earnedBadges(w).has('trees-1'));
});

test('restoring a backup merges trees by id and keeps owned trees', () => {
    const w = {};
    plantTree(w, round('a', 25));
    mergeGrove(w, { grove: { trees: [{ id: 'a', species: 'oak', at: '2026-11-09T10:00:00Z', minutes: 25 }, { id: 'b', species: 'pine', at: '2026-11-01T10:00:00Z', minutes: 25 }, { id: 'c', species: 'bogus', at: '2026-11-02T10:00:00Z', minutes: 9, withered: true }], coins: 10, owned: ['pine', 'bogus'] } });
    assert.deepEqual(w.grove.trees.map(t => [t.id, t.species]), [['b', 'pine'], ['c', 'oak'], ['a', 'oak']]);
    assert.equal(w.grove.coins, 25);
    assert.deepEqual(w.grove.owned, ['oak', 'pine']);
});

test('period ranges: day, Monday-to-Sunday week, whole month and year, stepping back', async () => {
    const { periodRange } = await import('../lib/grove.ts');
    const today = '2026-11-12'; // a Thursday
    assert.deepEqual([periodRange('day', today).start, periodRange('day', today, -1).start], ['2026-11-12', '2026-11-11']);
    assert.deepEqual([periodRange('week', today).start, periodRange('week', today).end], ['2026-11-09', '2026-11-15']);
    assert.equal(periodRange('week', today, -1).start, '2026-11-02');
    assert.deepEqual([periodRange('month', today, -9).start, periodRange('month', today, -9).end, periodRange('month', today, -9).slots.length], ['2026-02-01', '2026-02-28', 28]);
    assert.equal(periodRange('month', today, 2).start, '2027-01-01');
    assert.deepEqual([periodRange('year', today, -1).start, periodRange('year', today, -1).end, periodRange('year', today).slots.length], ['2025-01-01', '2025-12-31', 12]);
    assert.equal(periodRange('day', today).slots.length, 24);
});

test('a period counts grown and withered trees, minutes per slot and the most focused weekday', async () => {
    const { groveFor } = await import('../lib/grove.ts');
    const t = (id, at, minutes, withered) => ({ id, species: 'oak', at, minutes, ...(withered ? { withered: true } : {}) });
    const trees = [t('a', '2026-11-09T09:00:00Z', 25), t('b', '2026-11-09T10:00:00Z', 25), t('c', '2026-11-11T09:00:00Z', 50), t('d', '2026-11-11T11:00:00Z', 7, true), t('e', '2026-11-02T09:00:00Z', 25)];
    const dayOf = at => at.slice(0, 10);
    const week = groveFor(trees, 'week', '2026-11-12', 0, dayOf);
    assert.deepEqual([week.grown, week.withered, week.minutes], [3, 1, 100]);
    assert.deepEqual(week.slots.map(s => s.minutes), [50, 0, 50, 0, 0, 0, 0]);
    assert.equal(week.slots[2].withered, 1);
    assert.equal(week.bestWeekday, 0); // Monday and Wednesday tie at 50; the first wins
    const day = groveFor(trees, 'day', '2026-11-09', 0, dayOf, 'UTC');
    assert.deepEqual([day.grown, day.slots[9].minutes, day.slots[10].minutes], [2, 25, 25]);
    const year = groveFor(trees, 'year', '2026-11-12', 0, dayOf);
    assert.equal(year.slots[10].minutes, 125);
    assert.equal(groveFor(trees, 'month', '2026-11-12', -1, dayOf).bestWeekday, -1);
});

test('special trees are earned, not bought, and unlock from what the grove has done', async () => {
    const { canGrow, groveOf } = await import('../lib/grove.ts');
    const w = { zone: 'UTC' };
    assert.throws(() => buyTree(w, { species: 'moon' }), /earned, not bought/);
    // A round finished at 11 pm earns the Moon tree.
    plantTree(w, { id: 'night-1', at: '2026-11-09T23:00:00Z', ms: 25 * 60000 });
    assert.ok(w.grove.owned.includes('moon'));
    assert.ok(canGrow(groveOf(w), 'moon', 'UTC', '2026-11-10'));
    selectTree(w, { species: 'moon' });
    // A 90-minute round earns the Storm tree; five in a day earns the Firefly tree.
    plantTree(w, { id: 'long', at: '2026-11-10T09:00:00Z', ms: 90 * 60000 });
    for (let i = 0; i < 4; i++) plantTree(w, { id: 'd' + i, at: `2026-11-10T1${i}:00:00Z`, ms: 25 * 60000 });
    assert.ok(w.grove.owned.includes('storm') && w.grove.owned.includes('firefly'));
    assert.equal(w.grove.trees.find(t => t.id === 'long').species, 'moon');
    assert.throws(() => selectTree(w, { species: 'ancient' }), /Unlock this tree first/);
});

test('seasonal trees grow only in their season, by hemisphere', async () => {
    const { seasonOf } = await import('../lib/grove.ts');
    assert.equal(seasonOf('2026-07-10', 'Europe/London'), 'summer');
    assert.equal(seasonOf('2026-07-10', 'Australia/Sydney'), 'winter');
    assert.equal(seasonOf('2026-12-01', 'Australia/Sydney'), 'summer');
    const w = { zone: 'Australia/Sydney' };
    selectTree(w, { species: 'springbloom' }, new Date('2026-11-09T00:00:00Z')); // November is spring in Sydney
    plantTree(w, { id: 's1', at: '2026-11-09T00:00:00Z', ms: 25 * 60000 });
    assert.equal(w.grove.trees[0].species, 'springbloom');
    assert.throws(() => selectTree(w, { species: 'frost' }, new Date('2026-11-09T00:00:00Z')), /only grows in winter/);
    // Out of season, a round falls back to the oak.
    plantTree(w, { id: 's2', at: '2027-02-09T00:00:00Z', ms: 25 * 60000 });
    assert.equal(w.grove.trees[1].species, 'oak');
    assert.throws(() => buyTree(w, { species: 'sunflower' }), /free in their season/);
});

test('lucky finds are rare and fixed per round', async () => {
    const { isLucky } = await import('../lib/grove.ts');
    const hits = Array.from({ length: 3000 }, (_, i) => isLucky('focus-' + (1790000000000 + i * 1500000), 25 * 60000)).filter(Boolean).length;
    assert.ok(hits > 50 && hits < 150, `about 1 in 30, got ${hits}`);
    assert.equal(isLucky('focus-1', 25 * 60000), isLucky('focus-1', 25 * 60000));
    assert.equal(Array.from({ length: 300 }, (_, i) => isLucky('x' + i, 5 * 60000)).some(Boolean), false);
});

test('lands and weather are bought with coins and switched freely once owned', async () => {
    const { buyScene, groveOf } = await import('../lib/grove.ts');
    const w = {};
    for (let i = 0; i < 20; i++) plantTree(w, round('c' + i, 25));
    assert.equal(w.grove.coins, 500);
    buyScene(w, { kind: 'land', id: 'desert' });
    assert.deepEqual([w.grove.coins, w.grove.land, w.grove.lands], [200, 'desert', ['meadow', 'desert']]);
    buyScene(w, { kind: 'weather', id: 'sunny' });
    assert.deepEqual([w.grove.coins, w.grove.weather], [0, 'sunny']);
    assert.throws(() => buyScene(w, { kind: 'weather', id: 'rain' }), /400 more coins/);
    buyScene(w, { kind: 'land', id: 'meadow' });
    assert.deepEqual([w.grove.coins, groveOf(w).land], [0, 'meadow']);
    assert.throws(() => buyScene(w, { kind: 'land', id: 'mars' }));
});

test('rounds shorter than 10 minutes grow no tree and earn no coins', async () => {
    const { MIN_TREE_MINUTES } = await import('../lib/grove.ts');
    assert.equal(MIN_TREE_MINUTES, 10);
    const w = {};
    assert.equal(plantTree(w, round('short', 9)), 0);
    assert.equal((w.grove?.trees || []).length, 0);
    assert.equal(plantTree(w, round('ten', 10)), 10);
    assert.deepEqual([w.grove.trees.length, w.grove.coins], [1, 10]);
});
