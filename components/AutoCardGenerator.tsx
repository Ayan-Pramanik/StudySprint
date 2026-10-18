'use client';
import { useEffect, useMemo, useState } from 'react';
import { Check, Layers, Sparkles, X } from 'lucide-react';
import { generateAutoCards, type AutoCard } from '../lib/auto-cards';
import type { Note, Workspace } from '../lib/study';

export function AutoCardGenerator({ workspace, onClose, onCreate }: { workspace: Workspace; onClose: () => void; onCreate: (note: Note, cards: AutoCard[]) => Promise<void> }) {
  const [noteId, setNoteId] = useState(workspace.notes[0]?.id || '');
  const note = workspace.notes.find(item => item.id === noteId);
  const concepts = useMemo(() => note ? workspace.notes.filter(item => item.body.includes('StudySprint concept graph node:') && item.body.includes(`Extracted from [[${note.title}]]`)) : [], [note, workspace.notes]);
  const generated = useMemo(() => note ? generateAutoCards(note, concepts) : [], [note, concepts]);
  const [cards, setCards] = useState<AutoCard[]>(generated);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setCards(generated); setError(''); }, [generated]);
  const existing = useMemo(() => new Set(workspace.cards.filter(card => card.note === noteId && card.life !== 'archived').map(card => card.front.toLocaleLowerCase().replace(/\s+/g, ' ').trim())), [workspace.cards, noteId]);
  const update = (id: string, patch: Partial<AutoCard>) => setCards(current => current.map(card => card.id === id ? { ...card, ...patch } : card));
  const available = cards.filter(card => !existing.has(card.front.toLocaleLowerCase().replace(/\s+/g, ' ').trim()));
  const included = available.filter(card => card.selected !== false);
  async function create() {
    if (!note || !included.length) return;
    setSaving(true); setError('');
    try { await onCreate(note, included); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save these card drafts.'); setSaving(false); }
  }

  return <div className="overlay auto-card-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal auto-card-modal" role="dialog" aria-modal="true" aria-labelledby="auto-card-title">
      <button className="icon close" aria-label="Close card generator" onClick={onClose}><X size={18}/></button>
      <div className="eyebrow"><Sparkles size={14}/> FROM YOUR NOTES</div>
      <h2 id="auto-card-title">Generate study cards</h2>
      <p>Draft concept questions and vocabulary cloze cards from your notes. Cards are ranked with local TF-IDF term weights and sentence-to-note similarity; no AI service is required.</p>
      <label>Source note<select aria-label="Card source note" value={noteId} onChange={event => setNoteId(event.target.value)}>{workspace.notes.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      {!cards.length ? <div className="empty compact"><Layers size={24}/><h3>Not enough source text yet.</h3><p>Choose a note with a few clear sentences, definitions, or concept nodes.</p></div> : <>
        <div className="auto-card-summary"><span>{cards.length} suggestions{cards.length > available.length ? ` · ${cards.length - available.length} already exist` : ''}</span><span>{included.length} selected to save as drafts</span></div>
        <div className="auto-card-list">{cards.map(card => {
          const duplicate = existing.has(card.front.toLocaleLowerCase().replace(/\s+/g, ' ').trim());
          return <article className={`auto-card-draft${duplicate ? ' duplicate' : ''}`} key={card.id}>
            <label className="checkbox"><input type="checkbox" checked={!duplicate && card.selected !== false} disabled={duplicate || saving} onChange={event => update(card.id, { selected: event.target.checked })}/><strong>{card.kind === 'concept' ? 'Concept' : 'Vocabulary'} · {card.similarity}% similarity</strong>{duplicate && <small>Already exists</small>}</label>
            <label>Prompt<textarea aria-label={`${card.id} prompt`} rows={2} value={card.front} disabled={saving} onChange={event => update(card.id, { front: event.target.value })}/></label>
            <label>Answer<textarea aria-label={`${card.id} answer`} rows={2} value={card.answer} disabled={saving} onChange={event => update(card.id, { answer: event.target.value })}/></label>
            <div className="auto-card-meta"><label>Card type<select aria-label={`${card.id} type`} value={card.type} disabled={saving} onChange={event => update(card.id, { type: event.target.value as AutoCard['type'] })}><option value="basic">Basic</option><option value="cloze">Cloze</option></select></label><small>Source: “{card.excerpt.slice(0, 140)}{card.excerpt.length > 140 ? '…' : ''}”</small></div>
          </article>;
        })}</div>
      </>}
      {error&&<p className="danger-text" role="alert">{error}</p>}
      <div className="actions auto-card-footer"><button onClick={onClose} disabled={saving}>Cancel</button><button className="primary" onClick={()=>void create()} disabled={!included.length||saving}><Check size={15}/>{saving?'Saving drafts…':`Create ${included.length} editable drafts`}</button></div>
    </section>
  </div>;
}
