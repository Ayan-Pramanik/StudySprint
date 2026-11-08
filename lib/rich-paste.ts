import { fromHtml } from 'hast-util-from-html';
import { toMdast } from 'hast-util-to-mdast';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { mathToMarkdown } from 'mdast-util-math';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import type { Nodes as MdNodes, Parent as MdParent } from 'mdast';
import { diagramSourceFromSvg, imageMarker, isMermaidSvg, type PastedDiagrams } from './pasted-diagrams.ts';

/*
 * Rich paste: converts the HTML a browser puts on the clipboard (for example when copying a
 * ChatGPT answer) into the Markdown that notes are stored as. Untrusted markup never reaches
 * the note: only Markdown is kept, and it is rendered without raw HTML.
 *
 * - Headings, emphasis, lists, task lists, tables, quotes, rules, links and images → GFM.
 * - KaTeX/MathML → the original LaTeX ($…$ and $$…$$) taken from its TeX annotation.
 * - Code blocks → fenced code with the language from the class or the block's header.
 * - Rendered Mermaid SVGs → ```mermaid when the type can be rebuilt, otherwise an image marker.
 * - Scripts, styles, frames, forms, buttons, event handlers and unsafe URLs are dropped.
 */

const DROP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'button', 'select', 'textarea', 'form', 'canvas', 'video', 'audio', 'source', 'track', 'meta', 'link', 'head', 'title', 'base', 'dialog', 'nav', 'svg', 'math']);
const STRUCTURE = /<(h[1-6]|ul|ol|li|table|pre|blockquote|strong|b|em|i|code|hr|a\s|img|del|s)\b|class="[^"]*\bkatex\b|<svg\b/i;

const classes = (el: Element): string[] => { const c: unknown = el.properties?.className; return Array.isArray(c) ? c.map(String) : typeof c === 'string' ? c.split(/\s+/) : []; };
const text = (node: Root | RootContent): string => node.type === 'text' ? node.value : 'children' in node ? (node.children as RootContent[]).map(text).join('') : '';
const find = (node: Root | Element, test: (el: Element) => boolean): Element | undefined => {
    for (const child of node.children) if (child.type === 'element') { if (test(child)) return child; const hit = find(child, test); if (hit) return hit; }
    return undefined;
};
const findAll = (node: Root | Element, test: (el: Element) => boolean, out: Element[] = []): Element[] => {
    for (const child of node.children) if (child.type === 'element') { if (test(child)) out.push(child); findAll(child, test, out); }
    return out;
};
const el = (tagName: string, properties: Element['properties'], children: ElementContent[]): Element => ({ type: 'element', tagName, properties, children });
const t = (value: string): ElementContent => ({ type: 'text', value });

const tex = (node: Element) => {
    const annotation = find(node, e => e.tagName === 'annotation' && /tex/i.test(String(e.properties?.encoding ?? '')));
    return annotation ? text(annotation).trim() : undefined;
};

const LANGUAGE = /^[a-z][\w+#.-]{0,20}$/i;
function codeBlock(pre: Element): Element {
    const code = find(pre, e => e.tagName === 'code');
    const languageClass = [code, pre].flatMap(e => e ? classes(e) : []).find(c => /^(language|lang)-/.test(c));
    let language = languageClass?.replace(/^(language|lang)-/, '');
    if (!language) {
        // ChatGPT shows the language as text in a header above the code.
        const header = find(pre, e => e !== code && !find(e, x => x === code) && LANGUAGE.test(text(e).trim()) && !/copy|edit|run/i.test(text(e)));
        language = header ? text(header).trim().toLowerCase() : undefined;
    }
    const lines = findAll(pre, e => classes(e).includes('cm-line'));
    const body = code ? text(code) : lines.length ? lines.map(text).join('\n') : text(pre);
    return el('pre', {}, [el('code', language ? { className: ['language-' + language] } : {}, [t(body.replace(/\n$/, ''))])]);
}

const SAFE_URL = /^(https?:|mailto:|#)/i;

/** Placeholders survive Markdown escaping because they are plain letters and digits. */
function placeholders() {
    const values: string[] = [];
    return {
        add(value: string) { values.push(value); return `SSPH${values.length - 1}X`; },
        restore(markdown: string) { return markdown.replace(/SSPH(\d+)X/g, (_, i) => values[Number(i)]); },
    };
}

/** True when clipboard HTML carries structure worth converting rather than plain text. */
export function hasRichStructure(html: string) { return STRUCTURE.test(html); }

export function htmlToMarkdown(html: string, nonce = Math.random().toString(36).slice(2, 10)): PastedDiagrams {
    const tree = fromHtml(html, { fragment: true });
    const marks = placeholders();
    const images: PastedDiagrams['images'] = [];
    let svgIndex = 0;

    const transform = (parent: Root | Element) => {
        const next: (RootContent | ElementContent)[] = [];
        for (const node of parent.children) {
            if (node.type === 'comment' || node.type === 'doctype') continue;
            if (node.type !== 'element') { next.push(node); continue; }
            const cls = classes(node);
            // Event handlers and inline styles are never carried into Markdown, but drop them early anyway.
            for (const key of Object.keys(node.properties ?? {})) if (/^on/i.test(key) || key === 'style') delete node.properties[key];
            if (node.tagName === 'svg' && isMermaidSvg(node)) {
                const source = diagramSourceFromSvg(node);
                const index = svgIndex++;
                if (source) next.push(el('p', {}, [t(marks.add('\n\n```mermaid\n' + source + '\n```\n\n'))]));
                else { const marker = imageMarker(nonce, index); images.push({ marker, svg: index }); next.push(el('p', {}, [t(marks.add('\n\n' + marker + '\n\n'))])); }
                continue;
            }
            if (cls.includes('katex-display') || (node.tagName === 'math' && node.properties?.display === 'block')) {
                const source = tex(node);
                if (source) { next.push(t(marks.add('\n\n$$\n' + source + '\n$$\n\n'))); continue; }
            }
            if (cls.includes('katex') || node.tagName === 'math') {
                const source = tex(node);
                if (source) { next.push(t(marks.add('$' + source + '$'))); continue; }
            }
            if (DROP.has(node.tagName) || cls.includes('sr-only') || node.properties?.ariaHidden === 'true' || node.properties?.hidden) continue;
            if (node.tagName === 'input' && node.properties?.type !== 'checkbox') continue;
            if (node.tagName === 'pre') { next.push(codeBlock(node)); continue; }
            if (node.tagName === 'a' && !SAFE_URL.test(String(node.properties?.href ?? ''))) { delete node.properties.href; node.tagName = 'span'; }
            if (node.tagName === 'img' && !/^https?:/i.test(String(node.properties?.src ?? ''))) {
                const alt = String(node.properties?.alt ?? '').trim();
                if (alt) next.push(t(alt));
                continue;
            }
            transform(node);
            next.push(node);
        }
        parent.children = next as typeof parent.children;
    };
    transform(tree);

    const mdast = toMdast(tree);
    // Double-check URLs after conversion, unwrapping anything not http(s)/mailto/anchor.
    const clean = (node: MdNodes) => {
        if (!('children' in node)) return;
        const parent = node as MdParent;
        parent.children = parent.children.flatMap(child => {
            if (child.type === 'link' && !SAFE_URL.test(child.url)) return child.children;
            if (child.type === 'image' && !/^https?:/i.test(child.url)) return child.alt ? [{ type: 'text', value: child.alt }] : [];
            clean(child);
            return [child];
        }) as typeof parent.children;
    };
    clean(mdast);
    const markdown = toMarkdown(mdast, { extensions: [gfmToMarkdown(), mathToMarkdown()], bullet: '-', emphasis: '*', strong: '*', fence: '`', fences: true, rule: '-', listItemIndent: 'one' });
    const restored = marks.restore(markdown)
        // A placeholder paragraph leaves an indented or quoted wrapper empty; tidy the blank lines.
        .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text: restored + '\n', images };
}

/**
 * Decides what a paste into a note should become. Returns undefined to let the browser paste
 * plain text as usual.
 */
export function convertRichPaste(data: { plain: string; html?: string; markdown?: string }): PastedDiagrams | undefined {
    if (data.markdown?.trim()) return { text: data.markdown, images: [] };
    if (data.html && hasRichStructure(data.html)) {
        const result = htmlToMarkdown(data.html);
        if (result.text.trim()) return result;
    }
    return undefined;
}
