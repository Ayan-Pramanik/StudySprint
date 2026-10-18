'use client';
import { useEffect, useMemo, useState } from 'react';
import { Network, Sparkles, X } from 'lucide-react';
import { buildConceptGraph, type Concept, type ConceptEdge, type ConceptGraph, type ConceptLevel } from '../lib/concept-graph';

const colors: Record<ConceptLevel, { fill: string; stroke: string; badge: string }> = {
  High: { fill: '#dcd9ff', stroke: '#5751c8', badge: 'concept-level high' },
  Medium: { fill: '#dcefe4', stroke: '#58866a', badge: 'concept-level median' },
  Low: { fill: '#f5e8ce', stroke: '#b58237', badge: 'concept-level low' }
};

export function ConceptGraphModal({ title, body, onClose, onImport }: { title: string; body: string; onClose: () => void; onImport: (graph: ConceptGraph) => Promise<void> }) {
  const original = useMemo(() => buildConceptGraph(`${title}\n\n${body}`), [title, body]);
  const [graph, setGraph] = useState(original);
  const [selectedId, setSelectedId] = useState(original.concepts[0]?.id || '');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  useEffect(() => { setGraph(original); setSelectedId(original.concepts[0]?.id || ''); }, [original]);
  const selected = graph.concepts.find(concept => concept.id === selectedId);
  const tiers: ConceptLevel[] = ['High', 'Medium', 'Low'];
  const positions = tiers.flatMap((level, tier) => {
    const group = graph.concepts.filter(concept => concept.level === level);
    const radius = [104, 172, 235][tier];
    return group.map((concept, index) => {
      const angle = -Math.PI / 2 + tier * .32 + index * Math.PI * 2 / Math.max(group.length, 1);
      return { concept, x: 380 + Math.cos(angle) * radius, y: 245 + Math.sin(angle) * radius };
    });
  });
  const position = new Map(positions.map(item => [item.concept.id, item]));
  const related = selected ? graph.edges.filter(edge => edge.source === selected.id || edge.target === selected.id).map(edge => ({ edge, concept: graph.concepts.find(item => item.id === (edge.source === selected.id ? edge.target : edge.source))! })).filter(item => item.concept) : [];
  function updateConcept(id: string, patch: Partial<Concept>) { setGraph(current => ({ ...current, concepts: current.concepts.map(concept => concept.id === id ? { ...concept, ...patch } : concept) })); }
  function updateEdge(edge: ConceptEdge, patch: Partial<ConceptEdge>) { setGraph(current => ({ ...current, edges: current.edges.map(item => item === edge || item.source === edge.source && item.target === edge.target ? { ...item, ...patch } : item) })); }
  function toggleEdge(otherId: string, checked: boolean) { if (!selected) return; setGraph(current => ({ ...current, edges: checked ? [...current.edges, { source: selected.id, target: otherId, similarity: .5, reason: 'Added manually' }] : current.edges.filter(edge => !((edge.source === selected.id && edge.target === otherId) || (edge.target === selected.id && edge.source === otherId))) })); }

  return <div className="overlay concept-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal concept-modal" role="dialog" aria-modal="true" aria-labelledby="concept-graph-title">
      <button className="icon close" aria-label="Close concept graph" onClick={onClose}><X size={18}/></button>
      <div className="eyebrow"><Sparkles size={13}/> STUDY FROM YOUR NOTE</div>
      <h2 id="concept-graph-title">Concept graph</h2>
      <p className="concept-intro">Key ideas from <strong>{title || 'this note'}</strong>, arranged by similarity to the note. Edit concepts and links before adding them to your Graph.</p>
      {!graph.concepts.length ? <div className="concept-empty"><Network size={30}/><h3>There isn’t enough text to map yet.</h3><p>Add a few sentences to this note, then generate the graph again.</p></div> : <>
        <div className="concept-legend" aria-label="Similarity layers"><span><i className="high-dot"/>High · closest layer</span><span><i className="median-dot"/>Medium · second layer</span><span><i className="low-dot"/>Low · outer layer</span><small>Move a concept to change its layer.</small></div>
        <div className="concept-content">
          <div className="concept-canvas-wrap"><svg className="concept-canvas" viewBox="0 0 760 490" role="img" aria-label="Editable concept graph arranged in similarity layers">
            <defs><filter id="concept-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#253248" floodOpacity=".12"/></filter></defs>
            {[104,172,235].map((radius,index)=><circle key={radius} cx="380" cy="245" r={radius} fill="none" stroke={['#5751c8','#58866a','#b58237'][index]} strokeOpacity=".22" strokeDasharray="4 6"/>)}
            {graph.edges.map((edge, index) => { const a = position.get(edge.source), b = position.get(edge.target); if (!a || !b) return null; return <line key={`${edge.source}-${edge.target}-${index}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#9295a8" strokeWidth={1 + edge.similarity * 4} strokeOpacity={0.25 + edge.similarity * 0.55}/>; })}
            {positions.map(({ concept, x, y }) => { const style = colors[concept.level], radius = concept.level === 'High' ? 30 : concept.level === 'Medium' ? 27 : 23; return <g key={concept.id} className="concept-node" role="button" tabIndex={0} aria-label={`${concept.label}, ${concept.level} similarity`} aria-pressed={selectedId === concept.id} onClick={() => setSelectedId(concept.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(concept.id); } }}>
              <circle cx={x} cy={y} r={radius} fill={style.fill} stroke={selectedId === concept.id ? '#272d42' : style.stroke} strokeWidth={selectedId === concept.id ? 3 : 2} filter="url(#concept-shadow)"/>
              <text x={x} y={y + 4} textAnchor="middle" className="concept-level-svg">{concept.level}</text>
              <text x={x} y={y + radius + 16} textAnchor="middle" className="concept-label-svg">{concept.label.length > 20 ? `${concept.label.slice(0, 18)}…` : concept.label}</text>
            </g>; })}
            <circle cx="380" cy="245" r="38" fill="#fff" stroke="#253248" strokeWidth="2"/><text x="380" y="241" textAnchor="middle" className="concept-center-svg">Your</text><text x="380" y="255" textAnchor="middle" className="concept-center-svg">note</text>
          </svg></div>
          <aside className="concept-detail" aria-live="polite">{selected ? <>
            <span className={colors[selected.level].badge}>{selected.level} similarity · {Math.round(selected.similarity * 100)}%</span>
            <label className="concept-edit-field">Concept name<input aria-label="Concept name" maxLength={80} value={selected.label} onChange={event => updateConcept(selected.id, { label: event.target.value })}/></label>
            <label className="concept-edit-field">Similarity layer<select aria-label="Similarity layer" value={selected.level} onChange={event => updateConcept(selected.id, { level: event.target.value as ConceptLevel })}>{tiers.map(tier=><option key={tier}>{tier}</option>)}</select></label>
            <label className="concept-edit-field">Supporting text<textarea aria-label="Supporting text" rows={3} maxLength={500} value={selected.evidence} onChange={event => updateConcept(selected.id, { evidence: event.target.value })}/></label>
            <h4>Related concepts</h4>
            <ul className="concept-related">{graph.concepts.filter(item => item.id !== selected.id).map(concept => {
              const edge = graph.edges.find(item => item.source === selected.id && item.target === concept.id || item.target === selected.id && item.source === concept.id);
              return <li key={concept.id}><label className="concept-relation"><input type="checkbox" checked={!!edge} onChange={event => toggleEdge(concept.id, event.target.checked)}/><span>{concept.label}<small>{concept.level} layer</small></span></label>{edge&&<label className="concept-strength">Similarity {Math.round(edge.similarity*100)}%<input aria-label={`${selected.label} to ${concept.label} similarity`} type="range" min="10" max="100" value={Math.round(edge.similarity*100)} onChange={event=>updateEdge(edge,{similarity:Number(event.target.value)/100})}/></label>}</li>;
            })}</ul>
          </> : null}</aside>
        </div>
        <p className="concept-method">Similarity layers are ranked from terms that recur and appear across the note. You can rename concepts, move layers, edit supporting text, and adjust connections.</p>
      </>}
      {importError&&<p className="concept-import-error" role="alert">{importError}</p>}
      <div className="concept-footer"><button onClick={onClose}>Close graph</button><button className="primary" disabled={!graph.concepts.length||importing} onClick={async()=>{setImporting(true);setImportError('');try{await onImport(graph);}catch(error){setImportError(error instanceof Error?error.message:'Could not add the concepts to your graph.');setImporting(false);}}}><Network size={15}/>{importing?'Adding concepts…':'Add concepts to Graph'}</button></div>
    </section>
  </div>;
}
