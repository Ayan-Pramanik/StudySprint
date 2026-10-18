export type ConceptLevel = 'High' | 'Medium' | 'Low';
export type Concept = { id: string; label: string; level: ConceptLevel; score: number; similarity: number; evidence: string; contexts: string[] };
export type ConceptEdge = { source: string; target: string; similarity: number; reason: string };
export type ConceptGraph = { concepts: Concept[]; edges: ConceptEdge[] };

const stopWords = new Set(('a an and are as at be been being by can could did do does for from had has have how i if in into is it its of on or our out per that the their them then there these this those to was we were what when where which while who why will with would you your page question answer questions given state show find calculate explain write based').split(' '));
const clean = (text: string) => text.replace(/```[\s\S]*?```|`[^`]*`/g, ' ').replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/<[^>]*>/g, ' ').replace(/[#>*_~|]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (text: string) => (text.toLowerCase().match(/[a-z][a-z'-]{1,}/g) || []).filter(word => !stopWords.has(word));
const stem = (word: string) => word.replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, '').replace(/(.)\1$/, '$1');

type Candidate = { label: string; key: string; count: number; contexts: string[]; semantic: string[]; evidence: string; phrase: boolean };

export function buildConceptGraph(source: string): ConceptGraph {
  const text = clean(source);
  const sentences = (text.match(/[^.!?\n]+[.!?]?/g) || []).map(s => s.trim()).filter(s => words(s).length >= 3).slice(0, 500);
  if (!sentences.length) return { concepts: [], edges: [] };

  const candidates = new Map<string, Candidate>();
  const add = (label: string, sentenceIndex: number, sentence: string, phrase: boolean, tokens: string[], start: number, size: number) => {
    const parts = label.toLowerCase().split(' ');
    const key = parts.map(stem).join(' ');
    if (!key || parts.some(word => stopWords.has(word))) return;
    const from = Math.max(0, start - 4), to = Math.min(tokens.length, start + size + 4);
    const context = tokens.slice(from, to).filter((_, offset) => from + offset < start || from + offset >= start + size).map(stem).filter(Boolean);
    const found = candidates.get(key);
    if (found) {
      found.count++;
      if (!found.contexts.includes(String(sentenceIndex))) found.contexts.push(String(sentenceIndex));
      found.semantic = [...new Set([...found.semantic, ...context])];
      if (phrase && !found.phrase) { found.label = label; found.phrase = true; }
    } else candidates.set(key, { label, key, count: 1, contexts: [String(sentenceIndex)], semantic: context, evidence: sentence.slice(0, 170), phrase });
  };

  sentences.forEach((sentence, index) => {
    const tokens = (sentence.toLowerCase().match(/[a-z][a-z'-]{1,}/g) || []).filter(word => !stopWords.has(word));
    for (let i = 0; i < tokens.length; i++) {
      const one = tokens[i];
      add(one, index, sentence, false, tokens, i, 1);
      for (let size = 2; size <= 3 && i + size <= tokens.length; size++) {
        const phrase = tokens.slice(i, i + size).join(' ');
        add(phrase, index, sentence, true, tokens, i, size);
      }
    }
  });

  const all = [...candidates.values()]
    .filter(item => item.count >= 2 || item.phrase && item.contexts.length >= 2)
    .map(item => {
      const spread = item.contexts.length;
      // Frequency, document coverage, and meaningful multiword concepts form a TF-IDF-style importance score.
      const score = Math.log1p(item.count) * (1 + Math.log1p(spread)) * (item.phrase ? 1.28 : 1);
      return { ...item, spread, score, vector: new Set(item.semantic) };
    })
    .sort((a, b) => b.score - a.score || Number(b.phrase) - Number(a.phrase) || a.label.localeCompare(b.label))
    .slice(0, 12);

  if (!all.length) {
    const tokens = words(text);
    const counts = new Map<string, number>();
    tokens.forEach(token => counts.set(token, (counts.get(token) || 0) + 1));
    for (const [word, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      const sentence = sentences.find(s => words(s).some(item => stem(item) === stem(word))) || '';
      all.push({ label: word, key: stem(word), count, contexts: [], semantic: words(sentence).map(stem), evidence: sentence.slice(0, 170), phrase: false, spread: 1, score: count, vector: new Set(words(sentence).map(stem)) });
    }
  }

  const highCut = Math.ceil(all.length / 3);
  const mediumCut = Math.ceil(all.length * 2 / 3);
  const highestScore = all[0]?.score || 1;
  const concepts: Concept[] = all.map((item, index) => ({
    id: item.key,
    label: item.label.replace(/\b\w/g, letter => letter.toUpperCase()),
    // Rank relevance to this source into three readable rings; the score combines frequency and spread.
    level: index < highCut ? 'High' : index < mediumCut ? 'Medium' : 'Low',
    score: item.score,
    similarity: item.score / highestScore,
    evidence: item.evidence,
    contexts: item.contexts
  }));

  const edges: ConceptEdge[] = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    const intersection = [...a.vector].filter(word => b.vector.has(word)).length;
    const semantic = a.vector.size && b.vector.size ? intersection / Math.sqrt(a.vector.size * b.vector.size) : 0;
    const sharedSentence = a.contexts.some(value => b.contexts.includes(value));
    const similarity = Math.min(1, semantic * 0.88 + (sharedSentence ? 0.08 : 0));
    if (similarity >= 0.15) edges.push({ source: a.key, target: b.key, similarity, reason: sharedSentence ? 'Appears in the same passage with overlapping context' : 'Shares surrounding terms and topic context' });
  }
  // Keep the visual readable and ensure every concept is connected to its closest related idea.
  const kept: ConceptEdge[] = [];
  const degree = new Map(concepts.map(concept => [concept.id, 0]));
  const ranked = edges.sort((a, b) => b.similarity - a.similarity);
  for (const edge of ranked) {
    if (edge.similarity < 0.22) continue;
    if ((degree.get(edge.source) || 0) >= 2 || (degree.get(edge.target) || 0) >= 2) continue;
    kept.push(edge); degree.set(edge.source, (degree.get(edge.source) || 0) + 1); degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  for (const concept of concepts) {
    if ((degree.get(concept.id) || 0) > 0) continue;
    const closest = ranked.find(edge => edge.source === concept.id || edge.target === concept.id);
    if (closest) { kept.push(closest); degree.set(closest.source, (degree.get(closest.source) || 0) + 1); degree.set(closest.target, (degree.get(closest.target) || 0) + 1); }
  }
  return { concepts, edges: [...new Map(kept.map(edge => [`${edge.source}|${edge.target}`, edge])).values()] };
}
