import test from 'node:test';
import assert from 'node:assert/strict';
import { activeQuiz, clearActive, clearRun, loadRun, runProgress, saveRun } from '../lib/quiz-progress.ts';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const quiz = { id: 'q1', questions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
const run = (extra = {}) => ({ quiz: 'q1', order: ['a', 'b', 'c'], mode: 'test', index: 1, answers: { a: [1] }, checked: {}, started: 1000, id: 'attempt-1', ...extra });

test('an attempt left open is saved with its answers and reopens where it was', () => {
    const s = memory();
    saveRun(run(), true, 61000, s);
    assert.equal(activeQuiz(s), 'q1');
    const back = loadRun(quiz, 500000, s);
    assert.deepEqual(back.answers, { a: [1] });
    assert.equal(back.index, 1);
    assert.equal(back.id, 'attempt-1');
    // 60 s were spent before leaving; time away is not counted.
    assert.equal(back.started, 500000 - 60000);
});

test('leaving for the quiz list keeps the attempt but stops it reopening by itself', () => {
    const s = memory();
    saveRun(run(), true, 2000, s);
    clearActive(s);
    assert.equal(activeQuiz(s), undefined);
    assert.ok(loadRun(quiz, 3000, s));
    saveRun(run(), false, 2000, s);
    assert.equal(activeQuiz(s), undefined);
});

test('finishing clears the saved attempt', () => {
    const s = memory();
    saveRun(run(), true, 2000, s);
    clearRun('q1', s);
    assert.equal(loadRun(quiz, 3000, s), undefined);
    assert.equal(activeQuiz(s), undefined);
});

test('questions deleted since are dropped and the position follows the current question', () => {
    const s = memory();
    saveRun(run({ index: 2 }), true, 2000, s);
    const back = loadRun({ id: 'q1', questions: [{ id: 'b' }, { id: 'c' }] }, 3000, s);
    assert.deepEqual(back.order, ['b', 'c']);
    assert.equal(back.index, 1);
    assert.equal(loadRun({ id: 'q1', questions: [{ id: 'z' }] }, 3000, s), undefined);
});

test('progress counts answered questions in tests and checked ones in practice', () => {
    assert.deepEqual(runProgress(run({ answers: { a: [1], b: '  ', c: 'Paris' } })), { done: 2, total: 3 });
    assert.deepEqual(runProgress(run({ mode: 'practice', answers: { a: [1], b: [0] }, checked: { a: true } })), { done: 1, total: 3 });
});

test('corrupt storage is ignored', () => {
    const s = memory();
    s.setItem('ss-quiz-progress', '{not json');
    assert.equal(loadRun(quiz, 0, s), undefined);
    assert.equal(activeQuiz(s), undefined);
});
