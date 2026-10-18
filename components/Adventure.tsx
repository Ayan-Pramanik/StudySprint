'use client';
import { useState } from 'react';
import { type Workspace, queue, uid } from '../lib/study';
import { adventureAnswerMatches, adventureCreatureName } from '../lib/adventure';

type Props = { w: Workspace; busy: boolean; mutate: (action: string, data?: any) => Promise<Workspace> };
const skillNames: Record<string, string> = { 'first-letter': 'First-letter clue', 'answer-length': 'Length scan' };
const ratingLabels = ['Again', 'Hard', 'Good', 'Easy'];
const ENEMY_HP = 100;

export function Adventure({ w, busy, mutate }: Props) {
  const [zone, setZone] = useState('');
  const [enemyId, setEnemyId] = useState('');
  const [enemyHp, setEnemyHp] = useState(ENEMY_HP);
  const [answerInput, setAnswerInput] = useState('');
  const [defeated, setDefeated] = useState(false);
  const [eventId, setEventId] = useState(uid());
  const [usedSkills, setUsedSkills] = useState<string[]>([]);
  const [hints, setHints] = useState<string[]>([]);
  const [message, setMessage] = useState('Choose a world, meet a wild vocabulary creature, and answer to battle.');
  const [dexOpen, setDexOpen] = useState(false);
  const available = queue(w, new Date(), zone);
  const enemy = enemyId ? w.cards.find(c => c.id === enemyId && c.life === 'active') : undefined;
  const subjects = w.subjects.filter(s => w.cards.some(c => c.life === 'active' && c.subject === s.id));
  const wildAvailable = w.cards.some(c => c.life === 'active' && !c.subject);
  const xp = w.events.reduce((sum, e) => sum + (e.adventure ? e.xp || 0 : 0), 0);
  const level = Math.floor(xp / 100) + 1;
  const captured = w.cards.filter(c => w.events.some(e => e.adventure && e.captured && e.card === c.id));

  function explore() {
    if (!available.length || w.adventure.hp <= 0) return;
    const next = available[Math.floor(Math.random() * available.length)];
    setEnemyId(next.id);
    setEnemyHp(ENEMY_HP);
    setAnswerInput('');
    setDefeated(false);
    setEventId(uid());
    setUsedSkills([]);
    setHints([]);
    setMessage('A wild creature appeared! Type your answer to attack. Wrong answers cost 35 HP.');
  }

  async function useSkill(skill: string) {
    if (!enemy || busy || usedSkills.includes(skill)) return;
    try {
      const next = await mutate('adventureSkill', { skill });
      const answer = enemy.answer.trim();
      setHints(current => [...current, skill === 'first-letter'
        ? `The answer starts with “${answer.slice(0, 1).toLocaleUpperCase()}”.`
        : `The answer has ${[...answer].length} characters.`]);
      setUsedSkills(current => [...current, skill]);
      if (next.adventure.hp <= 0) setMessage('Your HP reached zero. You lost this battle.');
    } catch { /* The shared workspace error banner reports save failures. */ }
  }

  async function submitAnswer(event: React.FormEvent) {
    event.preventDefault();
    if (!enemy || busy || defeated || w.adventure.hp <= 0 || !answerInput.trim()) return;
    const correct = adventureAnswerMatches(answerInput, enemy.answer);
    let next: Workspace;
    try { next = await mutate('adventureTurn', { id: enemy.id, answer: answerInput }); }
    catch { return; }
    setAnswerInput('');
    if (!correct) {
      if (next.adventure.hp <= 0) {
        try { await mutate('adventureRate', { id: enemy.id, rating: 1, eventId }); } catch { return; }
        setMessage('Battle lost! Your HP reached zero after three misses. Recover when you’re ready to explore again.');
      } else {
        setMessage(`Not quite! The wild ${adventureCreatureName(enemy.front, enemy.answer)} struck back for 35 damage. Try again.`);
      }
      return;
    }

    setEnemyHp(0);
    try {
      const result = await mutate('adventureRate', { id: enemy.id, rating: 3, eventId });
      const newlyUnlocked = result.adventure.skills.find(skill => !w.adventure.skills.includes(skill));
      setDefeated(true);
      setMessage(`Super effective! ${adventureCreatureName(enemy.front, enemy.answer)} was caught. +10 XP${newlyUnlocked ? ` · Loot unlocked: ${skillNames[newlyUnlocked]}!` : ''}`);
      setEventId(uid());
    } catch {
      setEnemyHp(ENEMY_HP);
    }
  }

  async function recover() {
    try {
      await mutate('adventureRecover');
      setEnemyId('');
      setEnemyHp(ENEMY_HP);
      setDefeated(false);
      setEventId(uid());
      setMessage('Your party recovered to full HP. Choose a world to continue.');
    } catch { /* The shared workspace error banner reports save failures. */ }
  }

  return <>
    <div className="page-heading"><div className="eyebrow">LEARN BY EXPLORING</div><h1>Study adventure<span className="indigo">.</span></h1><p>Explore study worlds. Your vocabulary and concepts become wild creatures. Type the answer to attack; three misses end the battle.</p></div>
    <div className="adventure-stats">
      <div className="panel adventure-stat"><span>❤️ Adventurer HP</span><strong>{w.adventure.hp}<small> / 100</small></strong><progress max={100} value={w.adventure.hp}/></div>
      <div className="panel adventure-stat"><span>✨ Experience</span><strong>{xp}<small> XP · Level {level}</small></strong><progress max={100} value={xp % 100}/></div>
      <button className="panel adventure-stat dex-stat" onClick={() => setDexOpen(open => !open)} aria-expanded={dexOpen}><span>📖 Collection</span><strong>{captured.length}<small> creatures caught</small></strong><span className="text-button">{dexOpen ? 'Close collection' : 'Open collection'}</span></button>
    </div>

    <section className="adventure-map panel">
      <div><div className="eyebrow">CHOOSE A STUDY WORLD</div><h2>Where will you explore?</h2><p>Each world draws from your active flashcards. Choose a subject or explore all subjects.</p></div>
      <label>World<select aria-label="Study world" value={zone} onChange={e => { setZone(e.target.value); setEnemyId(''); setEnemyHp(ENEMY_HP); setAnswerInput(''); setDefeated(false); }}><option value="">🌿 Wild meadow · All subjects</option>{subjects.map(s => <option key={s.id} value={s.id}>🗺️ {s.name} world</option>)}{wildAvailable && <option value="__uncategorised">🌱 Uncategorised grove</option>}</select></label>
      {zone === '__uncategorised' && <p className="small">Uncategorised creatures live here.</p>}
      {w.adventure.hp <= 0 && <div className="adventure-lost" role="status"><strong>💫 Your party is exhausted — you lost the battle.</strong><p>Recover to 100 HP before entering another world.</p><button className="primary" disabled={busy} onClick={() => void recover()}>Recover and return to world map</button></div>}
      {!enemy && w.adventure.hp > 0 && <div className="adventure-explore"><button className="primary" disabled={!available.length || busy} onClick={explore}>{available.length ? 'Explore for a wild creature' : 'No active cards ready in this world'}</button><span>{available.length} encounter{available.length === 1 ? '' : 's'} ready</span></div>}
      {enemy && w.adventure.hp > 0 && <div className="battle-panel" aria-live="polite">
        <div className="monster-scene"><span className="monster" aria-hidden="true">👾</span><div className="monster-name"><strong>Wild {adventureCreatureName(enemy.front, enemy.answer)}</strong><small>Lvl {Math.min(99, Math.max(1, enemy.schedule.reps + 1))}</small><div className="hp-track"><i style={{ width: `${enemyHp}%` }}/></div><small>{defeated ? 'Caught!' : `Creature HP · ${enemyHp} / ${ENEMY_HP}`}</small></div></div>
        <article className="battle-question"><span className="eyebrow">{enemy.type === 'cloze' ? 'FILL THE GAP TO ATTACK' : 'ANSWER TO ATTACK'}</span><h2>{enemy.front}</h2>
          {hints.map((hint, i) => <p className="adventure-hint" key={i}>💡 {hint}</p>)}
          {!defeated ? <>
            <form className="adventure-answer-form" onSubmit={submitAnswer}><label htmlFor="adventure-answer">Your answer<input id="adventure-answer" autoComplete="off" value={answerInput} onChange={e => setAnswerInput(e.target.value)} disabled={busy} placeholder="Type what you remember…"/></label><button className="primary" disabled={busy || !answerInput.trim()}>Attack</button></form>
            <div className="adventure-skills">{w.adventure.skills.map(skill => <button key={skill} disabled={busy || usedSkills.includes(skill) || w.adventure.hp <= 10} onClick={() => void useSkill(skill)}>{skillNames[skill]} · 10 HP</button>)}</div>
            <p className="review-hint">Answers are checked against the saved card text. Concise answers with key terms count.</p>
          </> : <><div className="answer"><span className="eyebrow">YOU GOT IT</span><p>{enemy.answer}</p></div><button className="primary" disabled={busy} onClick={explore}>Explore for the next creature</button></>}
        </article>
      </div>}
      {message && <p className="adventure-message" role="status">{message}</p>}
    </section>

    {dexOpen && <section className="panel adventure-dex"><div className="section-heading"><h2>Creature collection <span className="number">{captured.length}</span></h2><span className="muted small">Caught by answering correctly</span></div>{captured.length ? <div className="dex-grid">{captured.map(card => <article className="dex-card" key={card.id}><span aria-hidden="true">🌟</span><strong>{adventureCreatureName(card.front, card.answer)}</strong><small>{w.subjects.find(s => s.id === card.subject)?.name || 'Wild meadow'}</small><p>{card.answer}</p></article>)}</div> : <p className="empty compact">Answer correctly in battle to catch your first creature.</p>}</section>}
    <p className="muted small adventure-footnote">Correct answers defeat wild creatures and enter them in your collection. Three wrong answers drop your HP to zero and end the battle. Your battle result also updates the card’s review schedule.</p>
  </>;
}
