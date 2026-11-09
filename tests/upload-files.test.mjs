import test from 'node:test';
import assert from 'node:assert/strict';
import { batches, folderOf, readPicked } from '../lib/upload-files.ts';

const file = (path, text) => { const f = new File([text], path.split('/').pop()); if (path.includes('/')) Object.defineProperty(f, 'webkitRelativePath', { value: path }); return f; };

test('the folder a file came from becomes its folder name', () => {
    assert.equal(folderOf('Quizzes/Week 1/a.csv'), 'Week 1');
    assert.equal(folderOf('Quizzes/a.csv'), 'Quizzes');
    assert.equal(folderOf('a.csv'), '');
});

test('a folder pick keeps supported files, skips hidden ones and reports the rest', async () => {
    const picked = await readPicked([file('Q/Week 2/b.csv', 'x'), file('Q/.DS_Store', 'x'), file('Q/__MACOSX/Week 1/._a.csv', 'x'), file('Q/notes.pdf', 'x'), file('Q/Week 1/a.json', '{}'), file('Q/big.csv', 'x'.repeat(50))], /\.(csv|json)$/i, 40);
    assert.deepEqual(picked.files.map(f => [f.path, f.folder]), [['Q/Week 1/a.json', 'Week 1'], ['Q/Week 2/b.csv', 'Week 2']]);
    assert.equal(picked.files[0].text, '{}');
    assert.deepEqual(picked.skipped, ['Q/notes.pdf: not a supported file type', 'Q/big.csv: larger than 0.0 MB']);
});

test('several individually chosen files have no folder', async () => {
    const picked = await readPicked([file('a.csv', '1'), file('b.csv', '2')], /\.csv$/i, 100);
    assert.deepEqual(picked.files.map(f => [f.name, f.folder]), [['a.csv', ''], ['b.csv', '']]);
});

test('large imports are split by count and by size', () => {
    assert.deepEqual(batches([1, 2, 3, 4, 5], 2).map(b => b.length), [2, 2, 1]);
    const big = Array.from({ length: 5 }, () => 'x'.repeat(100));
    assert.deepEqual(batches(big, 100, 250).map(b => b.length), [2, 2, 1]);
    assert.deepEqual(batches([], 10), []);
});
