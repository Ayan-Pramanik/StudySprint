'use client';
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Components } from 'react-markdown';
import { Check, Copy, Download, Maximize2, Minus, Plus, X } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { LOST_DIAGRAM } from '../lib/pasted-diagrams';

let renders = Promise.resolve();

/* Diagram colours: deep-blue rounded nodes and light grey connectors, matching chat-style diagrams. */
const palettes = {
    dark: { background: 'transparent', primaryColor: '#00284d', primaryTextColor: '#99ceff', primaryBorderColor: '#1a3e5f', secondaryColor: '#00284d', tertiaryColor: '#0b1a2b', lineColor: '#afafaf', textColor: '#ededed', mainBkg: '#00284d', nodeBorder: '#1a3e5f', clusterBkg: '#1c1c1c', clusterBorder: '#3a3a3a', edgeLabelBackground: '#000e1a', actorBkg: '#00284d', actorBorder: '#1a3e5f', actorTextColor: '#99ceff', actorLineColor: '#5a5a5a', signalColor: '#afafaf', signalTextColor: '#ededed', noteBkgColor: '#0b1a2b', noteTextColor: '#ededed', noteBorderColor: '#1a3e5f', labelBoxBkgColor: '#00284d', labelTextColor: '#99ceff', loopTextColor: '#ededed', sequenceNumberColor: '#000e1a' },
    light: { background: 'transparent', primaryColor: '#e7f1fc', primaryTextColor: '#0b4a85', primaryBorderColor: '#bcd5ef', secondaryColor: '#e7f1fc', tertiaryColor: '#f5f9fd', lineColor: '#8a8a8a', textColor: '#1f2328', mainBkg: '#e7f1fc', nodeBorder: '#bcd5ef', clusterBkg: '#f6f7f9', clusterBorder: '#dde1e6', edgeLabelBackground: '#ffffff', actorBkg: '#e7f1fc', actorBorder: '#bcd5ef', actorTextColor: '#0b4a85', actorLineColor: '#b5b5b5', signalColor: '#6a6a6a', signalTextColor: '#1f2328', noteBkgColor: '#fff8e1', noteTextColor: '#1f2328', noteBorderColor: '#ecd9a0', labelBoxBkgColor: '#e7f1fc', labelTextColor: '#0b4a85', loopTextColor: '#1f2328', sequenceNumberColor: '#ffffff' },
};

const ZOOM_MIN = 0.25, ZOOM_MAX = 6;

/** Full-screen diagram viewer with zoom (buttons, wheel, +/- keys) and drag to pan. */
function DiagramViewer({ svg, onClose }: { svg: string; onClose: () => void }) {
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
    const stage = useRef<HTMLDivElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const step = useCallback((factor: number) => setZoom(z => clamp(Math.round(z * factor * 100) / 100)), []);
    const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        closeButton.current?.focus();
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === '+' || e.key === '=') step(1.25);
            else if (e.key === '-') step(0.8);
            else if (e.key === '0') reset();
        };
        window.addEventListener('keydown', key);
        return () => { window.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus(); };
    }, [onClose, step]);

    // Wheel zoom needs a non-passive listener so the page does not scroll.
    useEffect(() => {
        const el = stage.current;
        if (!el) return;
        const wheel = (e: WheelEvent) => { e.preventDefault(); setZoom(z => clamp(z * Math.exp(-e.deltaY * 0.0015))); };
        el.addEventListener('wheel', wheel, { passive: false });
        return () => el.removeEventListener('wheel', wheel);
    }, []);

    const down = (e: ReactPointerEvent) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; };
    const move = (e: ReactPointerEvent) => { const d = drag.current; if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }); };
    const up = () => { drag.current = null; };

    return createPortal(<div className="diagram-viewer" role="dialog" aria-modal="true" aria-label="Diagram viewer" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <button ref={closeButton} className="diagram-viewer-close" aria-label="Close diagram viewer" onClick={onClose}><X size={18}/></button>
        <div ref={stage} className="diagram-viewer-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={reset}>
            <div className="diagram-viewer-content" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} dangerouslySetInnerHTML={{ __html: svg }}/>
        </div>
        <div className="diagram-viewer-zoom" role="group" aria-label="Zoom">
            <button aria-label="Zoom out" onClick={() => step(0.8)} disabled={zoom <= ZOOM_MIN}><Minus size={16}/></button>
            <button className="diagram-viewer-level" aria-label="Reset zoom" title="Reset zoom" onClick={reset}>{Math.round(zoom * 100)}%</button>
            <button aria-label="Zoom in" onClick={() => step(1.25)} disabled={zoom >= ZOOM_MAX}><Plus size={16}/></button>
        </div>
    </div>, document.body);
}

/** Renders a ```mermaid block. Mermaid is loaded only when a note contains a diagram. */

/**
 * Where Mermaid draws a diagram before it is shown. Without one it adds a temporary element to the
 * end of <body>, which makes the page taller for a moment: the page scrollbar flickers on and off
 * and the whole layout shifts sideways while a note's diagrams render. A fixed, off-screen element
 * is still laid out (Mermaid measures its labels) but never changes the page's size.
 */
let stageElement: HTMLElement | undefined;
function stage() {
    if (!stageElement?.isConnected) {
        stageElement = document.createElement('div');
        stageElement.setAttribute('aria-hidden', 'true');
        stageElement.style.cssText = 'position:fixed;left:-100000px;top:0;width:1600px;visibility:hidden;pointer-events:none;contain:layout style';
        document.body.appendChild(stageElement);
    }
    return stageElement;
}

export function MermaidDiagram({ source }: { source: string }) {
    const theme = useTheme();
    const id = 'mermaid-' + useId().replace(/[^a-zA-Z0-9-]/g, '');
    const [result, setResult] = useState<{ svg?: string; error?: string }>({});
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        let cancelled = false;
        // Mermaid's configuration is global, so renders run one at a time.
        renders = renders.then(async () => {
            if (cancelled) return;
            try {
                const { default: mermaid } = await import('mermaid');
                // 'strict' sanitises labels and disables click handlers in the diagram.
                mermaid.initialize({
                    startOnLoad: false, securityLevel: 'strict', theme: 'base', look: 'classic',
                    themeVariables: { ...palettes[theme === 'dark' ? 'dark' : 'light'], fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif', fontSize: '14px' },
                    flowchart: { curve: 'basis', padding: 14, nodeSpacing: 40, rankSpacing: 48 },
                });
                const { svg } = await mermaid.render(id, source, stage());
                if (!cancelled) setResult({ svg });
            } catch (e) {
                // A failed render can leave Mermaid's temporary element behind.
                document.getElementById('d' + id)?.remove();
                if (!cancelled) setResult({ error: e instanceof Error ? e.message : String(e) });
            }
        });
        return () => { cancelled = true; };
    }, [id, source, theme]);
    const close = useCallback(() => setExpanded(false), []);
    const copy = () => void navigator.clipboard?.writeText('```mermaid\n' + source + '\n```').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    const download = () => {
        if (!result.svg) return;
        const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: 'diagram.svg' });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    if (result.error)
        return <div className="mermaid-error" role="alert"><strong>This diagram couldn’t be drawn.</strong><small className="block">{result.error.split('\n')[0]}</small><pre>{source}</pre></div>;
    if (!result.svg)
        return <div className="diagram-card mermaid-loading" aria-busy="true">Drawing diagram…</div>;
    return <figure className="diagram-card">
        <div className="diagram-toolbar">
            <button type="button" onClick={copy} aria-label="Copy diagram code" title="Copy code">{copied ? <Check size={15}/> : <Copy size={15}/>}</button>
            <button type="button" onClick={download} aria-label="Download diagram as SVG" title="Download SVG"><Download size={15}/></button>
            <button type="button" onClick={() => setExpanded(true)} aria-label="Expand diagram" title="Expand"><Maximize2 size={15}/></button>
        </div>
        <div className="mermaid-diagram" role="img" aria-label="Diagram" onDoubleClick={() => setExpanded(true)} dangerouslySetInnerHTML={{ __html: result.svg }}/>
        {expanded && <DiagramViewer svg={result.svg} onClose={close}/>}
    </figure>;
}

/** A diagram whose CSS was pasted without its structure: explain how to restore it. */
function LostDiagram({ labels }: { labels: string }) {
    return <div className="lost-diagram" role="note">
        <strong>Diagram not saved</strong>
        <p>Only this diagram’s styling and labels were saved, not its shape. To restore it, delete this block in Edit mode, then either:</p>
        <ul><li>select the answer in ChatGPT, copy it, and paste it straight into this note, or</li><li>ask ChatGPT to “give me the Mermaid code for that diagram” and paste the code it gives you.</li></ul>
        {labels && <p className="lost-diagram-labels">Labels: {labels}</p>}
    </div>;
}

const language = (className: unknown) => {
    const list = Array.isArray(className) ? className.map(String) : String(className || '').split(/\s+/);
    return list.find(c => c.startsWith('language-'))?.slice(9);
};
const special = (className: unknown) => { const l = language(className); return l === 'mermaid' || l === LOST_DIAGRAM; };

type HastLike = { type: string; value?: string; children?: HastLike[] };
const hastText = (node: HastLike): string => node.type === 'text' ? node.value || '' : (node.children || []).map(hastText).join('');
const LANGUAGE_NAMES: Record<string, string> = { js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', py: 'Python', python: 'Python', sh: 'Bash', bash: 'Bash', shell: 'Shell', json: 'JSON', sql: 'SQL', html: 'HTML', xml: 'XML', css: 'CSS', yaml: 'YAML', yml: 'YAML', java: 'Java', rust: 'Rust', c: 'C', cpp: 'C++', go: 'Go', csharp: 'C#' };

/** A fenced code block with its language and a copy button. */
function CodeBlock({ lang, text, children, ...rest }: { lang?: string; text: string; children: React.ReactNode } & React.HTMLAttributes<HTMLPreElement>) {
    const [copied, setCopied] = useState(false);
    const copy = () => void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    return <div className="code-block">
        <div className="code-block-head"><span>{lang ? LANGUAGE_NAMES[lang.toLowerCase()] || lang : 'Code'}</span><button type="button" onClick={copy} aria-label="Copy code">{copied ? <><Check size={13}/> Copied</> : <><Copy size={13}/> Copy</>}</button></div>
        <pre {...rest}>{children}</pre>
    </div>;
}

/** react-markdown overrides: a ```mermaid fence becomes a diagram; other fences get a code-block header. */
export const mermaidComponents: Components = {
    pre({ node, children, ...rest }) {
        const code = node?.children[0];
        if (code?.type === 'element' && code.tagName === 'code' && special(code.properties.className)) return <>{children}</>;
        if (code?.type === 'element' && code.tagName === 'code') return <CodeBlock lang={language(code.properties.className)} text={hastText(code as HastLike).replace(/\n$/, '')} {...rest}>{children}</CodeBlock>;
        return <pre {...rest}>{children}</pre>;
    },
    // `node` is dropped so it is not passed to the DOM element.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    code({ node: _node, className, children, ...rest }) {
        const lang = language(className);
        if (lang === 'mermaid') return <MermaidDiagram source={String(children).replace(/\n$/, '')}/>;
        if (lang === LOST_DIAGRAM) return <LostDiagram labels={String(children).trim()}/>;
        return <code className={className} {...rest}>{children}</code>;
    },
};
