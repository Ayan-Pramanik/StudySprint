'use client';
import { useMemo } from 'react';
import Markdown, { type Options } from 'react-markdown';
import { normalizeNoteMath, noteRemarkPlugins, noteRehypePlugins } from '../../lib/note-markdown';

/** Shared read-mode rendering for notes, saved versions, and conversion previews. */
export function NoteMarkdown({ children = '', ...props }: Omit<Options, 'remarkPlugins' | 'rehypePlugins'>) {
    const source = useMemo(() => normalizeNoteMath(children ?? ''), [children]);
    return <Markdown {...props} remarkPlugins={noteRemarkPlugins} rehypePlugins={noteRehypePlugins}>{source}</Markdown>;
}
