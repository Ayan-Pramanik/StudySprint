import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAutoCards } from '../lib/auto-cards.ts';

const body = 'Probability is the long-run proportion of times an event occurs across many repeated trials. A sample proportion estimates the true probability by dividing the observed successes by the number of trials. Increasing the number of independent trials usually reduces random variation in the sample proportion. The law of large numbers explains why sample proportions tend to approach the true probability as trials increase.';
const note = { id: 'note-1', title: 'Probability lecture', body };
const evidence = 'A sample proportion estimates the true probability by dividing the observed successes by the number of trials.';

test('auto cards make editable, source-grounded concept and vocabulary drafts', () => {
  const concepts = [
    { id: 'concept-1', title: 'Sample proportion', body: `Extracted from [[${note.title}]].\n\nStudySprint concept graph node: similarity=75%; layer=High.\n\nSupporting passage:\n> ${evidence}` },
    { id: 'unrelated', title: 'External article', body: 'An article from elsewhere with a fabricated claim.' },
  ];
  const cards = generateAutoCards(note, concepts);
  assert.ok(cards.some(card => card.kind === 'concept' && card.front === 'What is Sample proportion?'));
  assert.ok(cards.some(card => card.kind === 'vocabulary' && card.type === 'cloze'));
  for (const card of cards) {
    assert.ok(body.includes(card.excerpt), 'every saved citation is present verbatim in the note');
    assert.ok(card.front.trim().length >= 3);
    assert.ok(card.answer.trim().length > 0);
    assert.ok(!card.front.includes('External article'));
    if (card.type === 'cloze') {
      assert.equal((card.front.match(/\[\.\.\.\]/g) || []).length, 1);
      assert.ok(card.excerpt.toLowerCase().includes(card.answer.toLowerCase()));
    }
  }
  const concept = cards.find(card => card.kind === 'concept' && card.front === 'What is Sample proportion?');
  assert.equal(concept.answer, evidence);
  assert.equal(concept.excerpt, evidence);
  assert.ok(cards.every(card => card.similarity >= 0 && card.similarity <= 100));
});

test('concept nodes without a supporting passage in the selected note are ignored', () => {
  const cards = generateAutoCards(note, [
    { id: 'fake', title: 'Invented', body: 'StudySprint concept graph node: similarity=99%; layer=High.\n\nSupporting passage:\n> This claim is not in the note.' },
    { id: 'question', title: 'Companies', body: `StudySprint concept graph node: similarity=90%; layer=High.\n\nSupporting passage:\n> Question — You have $10,000 to invest in three companies?` },
  ]);
  assert.ok(!cards.some(card => card.front.includes('Invented')));
  assert.ok(!cards.some(card => card.front.includes('Companies')));
});

test('saved concept nodes can produce cards even when PDF line breaks leave no full prose sentence', () => {
  const body = 'Conditional probability is the probability of an event given that another event has already occurred.';
  const concept = { id: 'c2', title: 'Conditional probability', body: `Extracted from [[Probability PDF]].\n\nStudySprint concept graph node: similarity=68%; layer=High.\n\nSupporting passage:\n> ${body}` };
  const source = body.split(' ').join('\n');
  const cards = generateAutoCards({ id: 'pdf', title: 'Probability PDF', body: source }, [concept]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].front, 'What is Conditional probability?');
  assert.equal(cards[0].answer, body);
  assert.equal(cards[0].excerpt, source);
});

test('notes with too little prose do not produce empty or made-up cards', () => {
  assert.deepEqual(generateAutoCards({ id: 'short', title: 'Short', body: 'Probability.' }), []);
});

test('question labels and long sentence fragments are not treated as concept definitions', () => {
  const noisy = { id: 'noise', title: 'Noisy notes', body: 'Question — How often would you need to throw the coin to be certain that the probability is exactly 0.4? Luckily, a new rapid test is available which has a true positive rate above 90 percent in clinical settings.' };
  const cards = generateAutoCards(noisy);
  assert.ok(!cards.some(card => card.front.includes('How often')));
  assert.ok(!cards.some(card => card.kind === 'concept' && card.front.includes('Luckily')));
});
