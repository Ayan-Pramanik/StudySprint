const ignored = new Set('a an and are as at be been being but by can could did do does for from had has have how i if in into is it its of on or our that the their them then there these this those to was were what when where which while who why will with would you your'.split(' '));
const normalize = (value: string) => value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const terms = (value: string) => normalize(value).split(' ').filter(word => word.length > 1 && !ignored.has(word));

/** Accept an exact answer or a concise response that contains the key terms from the saved answer. */
export function adventureAnswerMatches(input: string, answer: string) {
  const candidate = normalize(input), expected = normalize(answer);
  if (!candidate || !expected) return false;
  if (candidate === expected || expected.includes(candidate)) return candidate.length >= 4;
  const given = terms(input), target = terms(answer);
  if (!given.length || !target.length) return false;
  const overlap = given.filter(word => target.includes(word)).length;
  if (target.length === 1) return overlap === 1;
  if (given.length === 1) return false;
  return overlap >= Math.max(2, Math.ceil(Math.min(given.length, target.length) * 0.6)) && overlap / target.length >= 0.45;
}

export function adventureCreatureName(front: string, answer: string) {
  const question = front.match(/^what\s+(?:is|are|does)\s+[“"']?(.+?)[”"']?\??$/i)?.[1]?.trim();
  if (question && question.length <= 32) return question.replace(/[?!.]+$/, '');
  if (front.includes('[...]') && answer.trim().length <= 32) return answer.trim();
  const words = front.replace(/\[\.\.\.\]/g, '').match(/[A-Za-z][A-Za-z'-]*/g) || [];
  return words.slice(0, 3).join(' ') || 'Unknown concept';
}
