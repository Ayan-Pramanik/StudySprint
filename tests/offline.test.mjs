import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOp, removeOp, applyOutbox, unreachable } from '../lib/offline.ts';

const note = { id: 'n1', subject: 's1', title: 'Cells', body: 'Old body', aliases: [], version: 3, updated: '2026-10-01T00:00:00.000Z' };
const w = { notes: [note], subjects: [{ id: 's1', name: 'Biology' }], cards: [], events: [], limit: 10, zone: 'UTC' };
const op = (patch) => ({ id: 'n1', title: 'Cells', body: 'Offline body', subject: 's1', base: note.updated, at: '2026-10-02T00:00:00.000Z', ...patch });

test('later edits of a note collapse into one queued edit that keeps the original base', () => {
    const ops = mergeOp(mergeOp([], op()), op({ body: 'Newer', base: 'ignored', at: '2026-10-03T00:00:00.000Z' }));
    assert.equal(ops.length, 1);
    assert.equal(ops[0].body, 'Newer');
    assert.equal(ops[0].base, note.updated);
});

test('a note created offline stays marked as created through later edits', () => {
    const ops = mergeOp(mergeOp([], op({ id: 'new', create: true, base: undefined })), op({ id: 'new', body: 'More', at: '2026-10-03T00:00:00.000Z' }));
    assert.equal(ops[0].create, true);
    assert.equal(ops[0].base, undefined);
});

test('removing an uploaded edit keeps a newer edit queued during the upload', () => {
    const first = op(), newer = op({ body: 'Typed during upload', at: '2026-10-04T00:00:00.000Z' });
    const queued = mergeOp([first], newer);
    assert.deepEqual(removeOp(queued, first), queued);
    assert.deepEqual(removeOp([first], first), []);
});

test('the outbox is laid over the server copy, adding offline-created notes at the end', () => {
    const shown = applyOutbox(w, [op(), op({ id: 'new', title: 'Fresh', body: 'Hi', create: true, base: undefined })]);
    assert.equal(shown.notes[0].body, 'Offline body');
    assert.equal(shown.notes[0].updated, note.updated);
    assert.equal(shown.notes.at(-1).id, 'new');
    assert.equal(shown.notes.at(-1).version, 1);
    assert.equal(w.notes[0].body, 'Old body');
    assert.equal(applyOutbox(w, []), w);
});

test('network failures and proxy errors count as unreachable, app errors do not', () => {
    const res = (status, type = 'application/json') => new Response('{}', { status, headers: { 'content-type': type } });
    assert.equal(unreachable(undefined), true);
    assert.equal(unreachable(res(502, 'text/html')), true);
    assert.equal(unreachable(res(530, 'text/html')), true);
    assert.equal(unreachable(res(200, 'text/html')), true);
    assert.equal(unreachable(res(400)), false);
    assert.equal(unreachable(res(409)), false);
    assert.equal(unreachable(res(200)), false);
});
