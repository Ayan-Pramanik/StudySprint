'use client';
import { useEffect, useId, useState } from 'react';
import type { Components } from 'react-markdown';
import { useTheme } from '../lib/theme';

let renders = Promise.resolve();

/** Renders a ```mermaid block. Mermaid is loaded only when a note contains a diagram. */
export function MermaidDiagram({ source }: { source: string }) {
    const theme = useTheme();
    const id = 'mermaid-' + useId().replace(/[^a-zA-Z0-9-]/g, '');
    const [result, setResult] = useState<{ svg?: string; error?: string }>({});
    useEffect(() => {
        let cancelled = false;
        // Mermaid's configuration is global, so renders run one at a time.
        renders = renders.then(async () => {
            if (cancelled) return;
            try {
                const { default: mermaid } = await import('mermaid');
                // 'strict' sanitises labels and disables click handlers in the diagram.
                mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'default', fontFamily: 'Arial, Helvetica, sans-serif' });
                const { svg } = await mermaid.render(id, source);
                if (!cancelled) setResult({ svg });
            } catch (e) {
                // A failed render can leave Mermaid's temporary element behind.
                document.getElementById('d' + id)?.remove();
                if (!cancelled) setResult({ error: e instanceof Error ? e.message : String(e) });
            }
        });
        return () => { cancelled = true; };
    }, [id, source, theme]);
    if (result.error)
        return <div className="mermaid-error" role="alert"><strong>This diagram couldn’t be drawn.</strong><small className="block">{result.error.split('\n')[0]}</small><pre>{source}</pre></div>;
    if (!result.svg)
        return <div className="mermaid-diagram mermaid-loading" aria-busy="true">Drawing diagram…</div>;
    return <div className="mermaid-diagram" role="img" aria-label="Mermaid diagram" dangerouslySetInnerHTML={{ __html: result.svg }}/>;
}

const isMermaid = (className: unknown) => Array.isArray(className) ? className.includes('language-mermaid') : /\blanguage-mermaid\b/.test(String(className || ''));

/** react-markdown overrides: a ```mermaid fence becomes a diagram instead of a code block. */
export const mermaidComponents: Components = {
    pre({ node, children, ...rest }) {
        const code = node?.children[0];
        if (code?.type === 'element' && code.tagName === 'code' && isMermaid(code.properties.className)) return <>{children}</>;
        return <pre {...rest}>{children}</pre>;
    },
    // `node` is dropped so it is not passed to the DOM element.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    code({ node: _node, className, children, ...rest }) {
        if (isMermaid(className)) return <MermaidDiagram source={String(children).replace(/\n$/, '')}/>;
        return <code className={className} {...rest}>{children}</code>;
    },
};
