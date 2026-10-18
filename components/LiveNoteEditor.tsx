'use client';

import type { RefObject } from 'react';
import { appendDictationText, type DictationPreview } from '../lib/dictation';

/** The mirror displays draft speech without putting it in the editable/saved value. */
export function LiveNoteEditor({ body, preview, inputRef, onChange, onSelect }: {
    body: string;
    preview: DictationPreview;
    inputRef: RefObject<HTMLTextAreaElement | null>;
    onChange: (body: string) => void;
    onSelect: () => void;
}) {
    const active = preview.phase !== 'idle';
    const waiting = preview.phase === 'starting' ? 'Connecting microphone…' : preview.phase === 'stopping' ? 'Finishing your last words…' : 'Listening…';
    const draft = active ? appendDictationText(body, preview.text || waiting).slice(body.length) : '';
    return <div className="live-note-editor">
        {active && <div className="live-note-label">Live draft · words may change</div>}
        <div className="live-note-surface">
            <div className="live-note-mirror" aria-hidden="true"><span className="live-note-committed">{body}</span>{active && <span className={`live-note-draft${preview.text ? '' : ' live-note-waiting'}`}>{draft}<span className="live-note-caret"/></span>}{'\u200b'}</div>
            <textarea className="markdown-editor" ref={inputRef} aria-label="Markdown note body" aria-describedby={active ? 'live-dictation-status' : undefined} value={body} placeholder={active ? '' : 'Start with an idea. Link it with [[Note Title]].'} onChange={event => onChange(event.target.value)} onSelect={onSelect}/>
        </div>
        {active && <span id="live-dictation-status" className="sr-only" role="status">{preview.text ? `Unconfirmed speech: ${preview.text}` : waiting}</span>}
    </div>;
}
