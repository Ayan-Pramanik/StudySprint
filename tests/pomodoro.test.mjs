import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, start, pause, tick, skip, leave, back, locked, remaining, completedToday, focusDays, formatDuration, cleanSettings, defaultSettings, formatTime } from '../lib/pomodoro.ts';

const s = { ...defaultSettings, focus: 25, short: 5, long: 15, rounds: 2 };
const min = 60000, t0 = Date.parse('2026-10-18T09:00:00');

test('a completed focus round counts and moves to a break', () => {
  let st = start(initial(s), t0);
  assert.equal(remaining(st, t0 + 5 * min), 20 * min);
  assert.ok(locked(st));
  const r = tick(st, s, t0 + 25 * min);
  assert.equal(r.finished, 'focus');
  assert.equal(r.state.phase, 'short');
  assert.equal(r.state.status, 'idle');
  assert.equal(completedToday(r.state, t0 + 25 * min), 1);
  assert.equal(locked(r.state), false);
});

test('a long break follows the configured number of rounds, then the cycle restarts', () => {
  let st = initial(s), now = t0;
  for (const expected of ['short', 'focus', 'long', 'focus']) {
    st = start(st, now); now += st.remaining; st = tick(st, s, now).state;
    assert.equal(st.phase, expected);
  }
  assert.equal(st.round, 0);
  assert.equal(completedToday(st, now), 2);
});

test('skipping focus does not count it', () => {
  const st = skip(start(initial(s), t0), s, t0 + min);
  assert.equal(st.phase, 'short');
  assert.equal(completedToday(st, t0), 0);
});

test('leaving pauses focus when pauseAway is on, and returning resumes it', () => {
  let st = start(initial(s), t0);
  st = leave(st, s, t0 + 10 * min);
  assert.equal(st.status, 'paused');
  assert.ok(locked(st), 'still guarded while paused only because of leaving');
  assert.equal(st.interruptions, 1);
  const r = back(st, t0 + 13 * min);
  assert.equal(r.away, 3 * min);
  assert.equal(r.paused, true);
  assert.equal(r.state.status, 'running');
  assert.equal(remaining(r.state, t0 + 13 * min), 15 * min, 'away time is not counted');
  assert.equal(r.state.awayMs, 3 * min);
});

test('leaving only records the interruption when pauseAway is off', () => {
  const open = { ...s, pauseAway: false };
  let st = leave(start(initial(open), t0), open, t0 + 10 * min);
  assert.equal(st.status, 'running');
  st = back(st, t0 + 12 * min).state;
  assert.equal(remaining(st, t0 + 12 * min), 13 * min);
  assert.equal(st.interruptions, 1);
});

test('breaks and manual pauses are not guarded', () => {
  const paused = pause(start(initial(s), t0), t0 + min);
  assert.equal(locked(paused), false);
  assert.equal(leave(paused, s, t0 + 2 * min), paused);
  const onBreak = start(skip(initial(s), s, t0), t0);
  assert.equal(locked(onBreak), false);
});

test('settings are clamped and time is formatted', () => {
  assert.deepEqual(cleanSettings({ focus: 0, short: 999, long: 'x', rounds: 3.6, pauseAway: 'yes' }), { focus: 1, short: 60, long: 15, rounds: 4, pauseAway: true });
  assert.equal(formatTime(25 * min), '25:00');
  assert.equal(formatTime(61001), '01:02');
});

test('completed focus time is totalled per day and overall; skipped rounds are not', () => {
  let st = initial(s), now = t0;
  st = start(st, now); now += 25 * min; st = tick(st, s, now).state;          // focus done
  st = skip(st, s, now);                                                      // skip break
  st = start(st, now); st = skip(st, s, now + 10 * min);                      // skipped focus
  assert.deepEqual(st.total, { ms: 25 * min, rounds: 1 });
  const nextDay = t0 + 24 * 60 * min;
  st = start(skip(st, s, nextDay), nextDay); st = tick(st, s, nextDay + 25 * min).state;
  assert.deepEqual(st.total, { ms: 50 * min, rounds: 2 });
  const week = focusDays(st, nextDay + 25 * min);
  assert.equal(week.length, 7);
  assert.deepEqual(week.slice(-2).map(d => d.ms), [25 * min, 25 * min]);
  assert.equal(completedToday(st, nextDay + 25 * min), 1);
});

test('old days are pruned from history but kept in the total', () => {
  let st = { ...initial(s), history: { '2025-01-01': { ms: 5 * min, rounds: 1 } }, total: { ms: 5 * min, rounds: 1 } };
  st = tick(start(st, t0), s, t0 + 25 * min).state;
  assert.equal('2025-01-01' in st.history, false);
  assert.deepEqual(st.total, { ms: 30 * min, rounds: 2 });
  assert.equal(formatDuration(85 * min), '1 h 25 min');
  assert.equal(formatDuration(120 * min), '2 h');
  assert.equal(formatDuration(0), '0 min');
});
