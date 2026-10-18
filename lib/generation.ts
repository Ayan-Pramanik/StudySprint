/** Extractive generation: every answer and prompt comes verbatim from the student's source. */
export function clozeDrafts(source: string) {
  const prose = source.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '');
  const sentences = prose.match(/[^\n.!?]+(?:[.!?](?=\s|$)|$)/g) || [];
  const cards: {front:string;answer:string;excerpt:string;type:'cloze'}[] = [];
  for (const raw of sentences) {
    const excerpt = raw.trim();
    if (excerpt.length < 35 || excerpt.length > 450 || /^(#|\||>|!\[)/.test(excerpt) || excerpt.includes('[...]')) continue;
    // Definition-style phrases and quantities are preferable to arbitrary words.
    const definition = excerpt.match(/^(.{3,65}?)\s+(?:is|are|means|refers to|describes|provides|enables|prevents|converts|stores|controls)\s/i);
    const quantity = excerpt.match(/\b\d+(?:\.\d+)?\s*(?:percent|%|seconds?|minutes?|hours?|days?|bytes?|bits?|metres?|meters?|degrees?)\b/i);
    const term = excerpt.match(/\b[A-Z][A-Z\d-]{1,14}\b/);
    const words = [...excerpt.matchAll(/\b[a-zA-Z][a-zA-Z-]{7,24}\b/g)];
    const answer = (definition?.[1] || quantity?.[0] || term?.[0] || words.sort((a,b)=>b[0].length-a[0].length)[0]?.[0] || '').trim();
    if (!answer || !source.includes(excerpt) || /\[|\]|`|\*/.test(answer)) continue;
    cards.push({front:excerpt.replace(answer,'[...]'),answer,excerpt,type:'cloze'});
    if (cards.length === 5) break;
  }
  if (!cards.length) throw Error('Add a complete explanatory sentence, or create a card manually. Cloze drafts need enough context around the hidden phrase.');
  return cards;
}
