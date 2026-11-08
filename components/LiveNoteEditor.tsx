'use client';

import { useState, type ClipboardEvent, type DragEvent, type RefObject } from 'react';
import { convertPastedDiagrams, lostDiagramFence } from '../lib/pasted-diagrams';
import { convertRichPaste } from '../lib/rich-paste';
import { normaliseImage, pastedSvgs, svgToPng, uploadNoteImage } from '../lib/note-images';
import { appendDictationText, type DictationPreview } from '../lib/dictation';

/** The mirror displays draft speech without putting it in the editable/saved value. */
export function LiveNoteEditor({ noteId, body, preview, inputRef, onChange, onSelect }: {
    /** Needed to store pasted images; without it images cannot be pasted. */
    noteId?: string;
    body: string;
    preview: DictationPreview;
    inputRef: RefObject<HTMLTextAreaElement | null>;
    onChange: (body: string) => void;
    onSelect: () => void;
}) {
    const active = preview.phase !== 'idle';
    const waiting = preview.phase === 'starting' ? 'Connecting microphone…' : preview.phase === 'stopping' ? 'Finishing your last words…' : 'Listening…';
    const draft = active ? appendDictationText(body, preview.text || waiting).slice(body.length) : '';
    const [notice, setNotice] = useState('');

    /** Inserts text at the caret; insertText keeps the browser's undo history. */
    const insert = (el: HTMLTextAreaElement, text: string) => {
        el.focus();
        if (document.execCommand?.('insertText', false, text)) return;
        const { selectionStart: start, selectionEnd: end } = el;
        onChange(el.value.slice(0, start) + text + el.value.slice(end));
        requestAnimationFrame(() => el.setSelectionRange(start + text.length, start + text.length));
    };
    /** Swaps an upload placeholder for its final Markdown in the latest text. */
    const settle = (marker: string, replacement: string) => {
        const current = inputRef.current?.value ?? body;
        if (current.includes(marker)) onChange(current.replace(marker, replacement));
    };
    const marker = (label: string) => `<!-- ${label} ${Math.random().toString(36).slice(2, 10)} -->`;

    const addImages = (el: HTMLTextAreaElement, files: File[]) => {
        if (!noteId) { setNotice('Save the note before adding images.'); return; }
        const markers = files.map(() => marker('uploading image'));
        insert(el, markers.map(m => '\n' + m + '\n').join(''));
        setNotice(files.length > 1 ? `Saving ${files.length} images…` : 'Saving image…');
        void Promise.all(files.map(async (file, i) => {
            try { settle(markers[i], await uploadNoteImage(noteId, await normaliseImage(file), file.name && !/^image\.\w+$/.test(file.name) ? file.name.replace(/\.\w+$/, '') : 'Pasted image')); return true; }
            catch (e) { settle(markers[i], ''); setNotice(e instanceof Error ? e.message : 'The image could not be saved.'); return false; }
        })).then(ok => { if (ok.every(Boolean)) setNotice(''); });
    };

    const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const data = event.clipboardData, el = event.currentTarget;
        const plain = data.getData('text/plain'), html = data.getData('text/html');
        const files = [...data.files].filter(f => f.type.startsWith('image/'));
        // A copied picture or screenshot: the clipboard has the image and at most an <img> tag or its URL as text.
        if (files.length && (!plain.trim() || /^\s*(<meta[^>]*>\s*)?<img\b[^>]*>\s*$/i.test(html) || /^https?:\/\/\S+$/.test(plain.trim()))) {
            event.preventDefault();
            addImages(el, files);
            return;
        }
        // Formatted copies (e.g. a ChatGPT answer) become Markdown: headings, tables, maths, code and diagrams.
        // Otherwise, diagram CSS leaked into plain text is still rebuilt; anything else pastes as usual.
        let converted;
        try { converted = convertRichPaste({ plain, html, markdown: data.getData('text/markdown') }) ?? convertPastedDiagrams(plain, html); }
        catch { converted = undefined; }
        if (converted === undefined) return;
        event.preventDefault();
        insert(el, converted.text);
        if (!converted.images.length) return;
        // Diagram types that cannot be rebuilt as Mermaid are saved as a picture of the original drawing.
        const svgs = pastedSvgs(html);
        setNotice('Saving diagram…');
        void Promise.all(converted.images.map(async ({ marker: m, svg }) => {
            const source = svgs[svg];
            try {
                if (!source || !noteId) throw new Error(noteId ? 'The diagram drawing was not on the clipboard.' : 'Save the note before adding diagrams.');
                settle(m, await uploadNoteImage(noteId, await svgToPng(source), 'Diagram'));
                return true;
            } catch (e) {
                settle(m, lostDiagramFence((source?.textContent || '').replace(/\s+/g, ' ').trim()));
                setNotice(e instanceof Error ? e.message : 'The diagram could not be saved.');
                return false;
            }
        })).then(ok => { if (ok.every(Boolean)) setNotice(''); });
    };

    const drop = (event: DragEvent<HTMLTextAreaElement>) => {
        const files = [...event.dataTransfer.files].filter(f => f.type.startsWith('image/'));
        if (!files.length) return;
        event.preventDefault();
        addImages(event.currentTarget, files);
    };
    return <div className="live-note-editor">
        {active && <div className="live-note-label">Live draft · words may change</div>}
        <div className="live-note-surface">
            <div className="live-note-mirror" aria-hidden="true"><span className="live-note-committed">{body}</span>{active && <span className={`live-note-draft${preview.text ? '' : ' live-note-waiting'}`}>{draft}<span className="live-note-caret"/></span>}{'\u200b'}</div>
            <textarea className="markdown-editor" ref={inputRef} aria-label="Markdown note body" aria-describedby={active ? 'live-dictation-status' : undefined} value={body} placeholder={active ? '' : 'Start with an idea. Link it with [[Note Title]].'} onChange={event => onChange(event.target.value)} onPaste={paste} onDrop={drop} onSelect={onSelect}/>
        </div>
        {notice && <p className="small" role="status">{notice}</p>}
        {active && <span id="live-dictation-status" className="sr-only" role="status">{preview.text ? `Unconfirmed speech: ${preview.text}` : waiting}</span>}
    </div>;
}
