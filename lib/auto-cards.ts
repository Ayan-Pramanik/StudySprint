export type AutoCard = {
  id: string;
  noteId: string;
  front: string;
  answer: string;
  type: 'basic' | 'cloze';
  excerpt: string;
  similarity: number;
  kind: 'concept' | 'vocabulary';
  selected?: boolean;
};

type SourceNote = { id: string; title: string; body: string; version?: number };

const stopWords = new Set(('a an and are as at be been being but by can could did do does for from had has have how i if in into is it its may might of on or our out per that the their them then there these this those to was we were what when where which while who why will with would you your about after also all another any because before between both each during either every few first further here like many more most other same some such than through too under until very via when without question questions page given luckily available following suppose').split(' '));
const stem = (word: string) => word.toLowerCase().replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, '').replace(/(.)\1$/, '$1');
const tokenize = (text: string) => (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(word => !stopWords.has(word)).map(stem);

function cleanSentence(value: string) {
  return value.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)+/, '').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/[`*_~#]/g, '').replace(/\s+/g, ' ').trim();
}

function sourcePassage(source: string, evidence: string) {
  const parts = evidence.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(parts.map(escape).join('\\s+'), 'i'))?.[0] || '';
}

function sentencesFrom(body: string) {
  return (body.match(/[^.!?\n]+[.!?]?/g) || []).map(excerpt => ({ excerpt: excerpt.trim(), text: cleanSentence(excerpt) }))
    .filter(item => item.text.length >= 35 && tokenize(item.text).length >= 6 && !item.text.includes('?') && !/^(?:StudySprint concept graph node:|Extracted from |Supporting passage:|Related concepts:|Question\s*[—:-])/i.test(item.text));
}

function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0, aa = 0, bb = 0;
  for (const [term, value] of a) { dot += value * (b.get(term) || 0); aa += value * value; }
  for (const value of b.values()) bb += value * value;
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

/** Draft grounded cards with local TF-IDF salience and sentence-to-note cosine similarity. */
export function generateAutoCards(note: SourceNote, conceptNotes: SourceNote[] = []): AutoCard[] {
  const sourceSentences = sentencesFrom(note.body);
  const tokenSets = sourceSentences.map(sentence => new Set(tokenize(sentence.text)));
  const allTerms = tokenize(sourceSentences.map(sentence => sentence.text).join(' '));
  const counts = new Map<string, number>();
  allTerms.forEach(term => counts.set(term, (counts.get(term) || 0) + 1));
  const docFreq = new Map<string, number>();
  tokenSets.forEach(set => set.forEach(term => docFreq.set(term, (docFreq.get(term) || 0) + 1)));
  const weights = new Map([...counts].map(([term, count]) => [term, (1 + Math.log(count)) * (1 + Math.log((sourceSentences.length + 1) / ((docFreq.get(term) || 0) + 1)))]));
  const centroid = new Map<string, number>();
  for (const [term, weight] of weights) centroid.set(term, weight * (docFreq.get(term) || 1));
  const sentenceSimilarity = (sentence: string) => {
    const vector = new Map<string, number>();
    tokenize(sentence).forEach(term => vector.set(term, weights.get(term) || 0));
    return Math.round(cosine(vector, centroid) * 100);
  };
  const drafts: AutoCard[] = [];
  const add = (draft: Omit<AutoCard, 'id'>) => {
    const key = draft.front.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (draft.kind === 'concept' && drafts.some(item => item.kind === 'concept' && item.excerpt.toLocaleLowerCase().trim() === draft.excerpt.toLocaleLowerCase().trim())) return;
    if (!drafts.some(item => item.front.toLocaleLowerCase().replace(/\s+/g, ' ').trim() === key)) drafts.push({ id: `${draft.kind}-${drafts.length}`, ...draft });
  };

  for (const concept of conceptNotes) {
    if (!concept.body.includes('StudySprint concept graph node:')) continue;
    const evidence = concept.body.match(/Supporting passage:\s*\n>\s*([\s\S]+?)(?:\n\n|$)/)?.[1]?.trim();
    const excerpt = evidence ? sourcePassage(note.body, evidence) : '';
    if (!evidence || !excerpt || /\?/.test(evidence) || /^(?:question\b|[a-z]\)\s*what\b)/i.test(evidence)) continue;
    const stored = Number(concept.body.match(/similarity=(\d+)%/)?.[1]);
    const similarity = Number.isFinite(stored) ? stored : sentenceSimilarity(evidence);
    add({ noteId: note.id, front: `What is ${concept.title.trim()}?`, answer: evidence, type: 'basic', excerpt, similarity, kind: 'concept' });
  }

  for (const { excerpt, text } of sourceSentences) {
    const similarity = sentenceSimilarity(text);
    const definition = text.match(/^([^,.!?]{2,45}?)\s+(?:is|are|means|refers to|describes|denotes)\s+(.{8,})[.!?]?$/i);
    if (definition && tokenize(definition[1]).length <= 3) {
      const term = definition[1].replace(/^(?:a|an|the)\s+/i, '').trim();
      if (term.length >= 3 && !stopWords.has(term.toLowerCase())) add({ noteId: note.id, front: `What does “${term}” mean?`, answer: text, type: 'basic', excerpt, similarity, kind: 'concept' });
    }

    const surfaceTerms = (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(term => !stopWords.has(term));
    const terms = [...new Set(surfaceTerms.map(stem))].filter(term => term.length >= 4 && !/^\d+$/.test(term) && !stopWords.has(term));
    const answerStem = terms.sort((a, b) => (weights.get(b) || 0) - (weights.get(a) || 0) || b.length - a.length)[0];
    const answer = surfaceTerms.find(term => stem(term) === answerStem);
    if (answer) {
      const matched = new RegExp(`\\b${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (matched.test(text)) add({ noteId: note.id, front: text.replace(matched, '[...]'), answer, type: 'cloze', excerpt, similarity, kind: 'vocabulary' });
    }
  }
  return drafts.sort((a, b) => b.similarity - a.similarity || (a.kind === 'concept' ? -1 : 1)).slice(0, 12).map((draft, index) => ({ ...draft, id: `${draft.kind}-${index}` }));
}
