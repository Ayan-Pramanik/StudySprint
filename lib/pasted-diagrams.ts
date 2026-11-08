import { fromHtml } from 'hast-util-from-html';
import type { Element, Root, RootContent } from 'hast';

/*
 * Copying a rendered Mermaid diagram from a chat answer (ChatGPT, Claude, etc.)
 * puts the diagram's <style> CSS and its labels, run together, on the clipboard
 * as plain text. These helpers turn the rendered SVG back into a ```mermaid
 * block on paste, and hide the leftover CSS in notes that already contain it.
 */

type Node = Root | RootContent;

const classes = (el: Element): string[] => {
    const c: unknown = el.properties?.className;
    return Array.isArray(c) ? c.map(String) : typeof c === 'string' ? c.split(/\s+/) : [];
};
const prop = (el: Element, ...names: string[]): string | undefined => {
    for (const name of names) {
        const value = el.properties?.[name];
        if (value !== undefined && value !== null) return Array.isArray(value) ? value.join(' ') : String(value);
    }
    return undefined;
};
const elements = (node: Node): Element[] => 'children' in node ? (node.children as RootContent[]).filter((c): c is Element => c.type === 'element') : [];

function walk(node: Node, visit: (el: Element, ancestors: Element[]) => void, ancestors: Element[] = []) {
    for (const child of elements(node)) {
        visit(child, ancestors);
        walk(child, visit, [...ancestors, child]);
    }
}

/** Visible text in document order, ignoring <style>/<script>. */
function text(node: Node): string {
    if (node.type === 'text') return node.value;
    if (node.type === 'element' && (node.tagName === 'style' || node.tagName === 'script')) return '';
    return 'children' in node ? node.children.map(text).join('') : '';
}
const label = (node: Node) => text(node).replace(/\s+/g, ' ').trim();

function translate(el: Element): [number, number] {
    const m = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(prop(el, 'transform') || '');
    return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}
function offset(ancestors: Element[]): [number, number] {
    return ancestors.reduce<[number, number]>(([x, y], a) => { const [dx, dy] = translate(a); return [x + dx, y + dy]; }, [0, 0]);
}

const quote = (s: string) => '"' + s.replace(/"/g, '#quot;') + '"';

interface DiagramNode { name: string; label: string; shape: 'rect' | 'round' | 'diamond' | 'circle' | 'cylinder'; x: number; y: number }

/** Rebuilds Mermaid flowchart source from one rendered flowchart <svg>. */
function flowchartFromSvg(svg: Element): string | undefined {
    const nodes: DiagramNode[] = [];
    const clusters: { name: string; label: string; box: [number, number, number, number] }[] = [];
    const edges: { id: string; cls: string[]; arrow: boolean }[] = [];
    const edgeLabels = new Map<string, string>();
    const orderedEdgeLabels: string[] = [];

    walk(svg, (el, ancestors) => {
        const cls = classes(el);
        const id = prop(el, 'id') || '';
        if (el.tagName === 'g' && cls.includes('node')) {
            const m = /flowchart-(.+)-\d+$/.exec(id);
            if (!m) return;
            const [ox, oy] = offset(ancestors); const [x, y] = translate(el);
            const shapes = elements(el).map(c => c.tagName);
            const shape = cls.some(c => /decision|question|diamond/.test(c)) || shapes.includes('polygon') ? 'diamond'
                : shapes.includes('circle') ? 'circle'
                : cls.some(c => /cylinder|database/.test(c)) ? 'cylinder'
                : 'rect';
            nodes.push({ name: m[1], label: label(el), shape, x: ox + x, y: oy + y });
        } else if (el.tagName === 'g' && cls.includes('cluster')) {
            const rect = elements(el).find(c => c.tagName === 'rect');
            if (!rect) return;
            const [ox, oy] = offset(ancestors);
            const n = (k: string) => Number(prop(rect, k) || 0);
            const labelEl = elements(el).find(c => classes(c).includes('cluster-label'));
            clusters.push({ name: (prop(el, 'dataId') || id).replace(/^.*-(?=[^-]+$)/, '') || 'group', label: label(labelEl || el), box: [ox + n('x'), oy + n('y'), n('width'), n('height')] });
        } else if (el.tagName === 'path' && (cls.includes('flowchart-link') || /(^|-)L[-_]/.test(id))) {
            edges.push({ id: prop(el, 'dataId') || id, cls, arrow: !!prop(el, 'markerEnd') });
        } else if (el.tagName === 'g' && cls.includes('edgeLabel')) {
            const inner = [el, ...elements(el)].find(c => prop(c, 'dataId'));
            const t = label(el);
            if (inner) edgeLabels.set(prop(inner, 'dataId')!, t);
            orderedEdgeLabels.push(t);
        }
    });
    if (!nodes.length) return undefined;

    // Mermaid edge ids are L_<from>_<to>_<n>; node names can contain '_', so match known names.
    const names = [...new Set(nodes.map(n => n.name))].sort((a, b) => b.length - a.length);
    const ends = (id: string): [string, string] | undefined => {
        const body = id.replace(/^.*?L[-_]/, '').replace(/[-_]\d+$/, '');
        for (const from of names) {
            if (!body.startsWith(from + '_') && !body.startsWith(from + '-')) continue;
            const to = body.slice(from.length + 1);
            if (names.includes(to)) return [from, to];
        }
        return undefined;
    };

    const safe = new Map<string, string>();
    names.forEach(n => safe.set(n, /^[A-Za-z][\w]*$/.test(n) && !/^(end|graph|flowchart|subgraph|style|class)$/i.test(n) ? n : 'n' + (safe.size + 1)));
    const shape = (n: DiagramNode) => {
        const l = quote(n.label || n.name);
        return n.shape === 'diamond' ? `{${l}}` : n.shape === 'circle' ? `((${l}))` : n.shape === 'cylinder' ? `[(${l})]` : `[${l}]`;
    };

    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const direction = Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys) ? 'LR' : 'TD';
    const lines = [`flowchart ${direction}`];
    const declared = new Set<string>();
    const inside = (n: DiagramNode, [x, y, w, h]: [number, number, number, number]) => w > 0 && n.x >= x && n.x <= x + w && n.y >= y && n.y <= y + h;
    // Smallest clusters first so each node is placed in its innermost group.
    const sorted = [...clusters].sort((a, b) => a.box[2] * a.box[3] - b.box[2] * b.box[3]);
    const home = new Map<DiagramNode, number>();
    for (const n of nodes) { const i = sorted.findIndex(c => inside(n, c.box)); if (i >= 0) home.set(n, i); }
    sorted.forEach((c, i) => {
        const members = nodes.filter(n => home.get(n) === i);
        if (!members.length) return;
        lines.push(`    subgraph g${i + 1}[${quote(c.label || c.name)}]`);
        for (const n of members) { lines.push(`        ${safe.get(n.name)}${shape(n)}`); declared.add(n.name); }
        lines.push('    end');
    });
    for (const n of nodes) if (!declared.has(n.name)) { lines.push(`    ${safe.get(n.name)}${shape(n)}`); declared.add(n.name); }

    edges.forEach((edge, i) => {
        const pair = ends(edge.id);
        if (!pair) return;
        const dotted = edge.cls.includes('edge-pattern-dotted') || edge.cls.includes('edge-pattern-dashed');
        const thick = edge.cls.includes('edge-thickness-thick');
        const arrow = edge.arrow || edge.cls.some(c => /arrow/.test(c)) || !edge.cls.length;
        const link = dotted ? (arrow ? '-.->' : '-.-') : thick ? (arrow ? '==>' : '===') : (arrow ? '-->' : '---');
        const text = edgeLabels.get(edge.id) ?? (edgeLabels.size ? '' : orderedEdgeLabels[i] || '');
        lines.push(`    ${safe.get(pair[0])} ${link}${text ? `|${quote(text)}|` : ''} ${safe.get(pair[1])}`);
    });
    return lines.join('\n');
}

/** Rebuilds Mermaid sequenceDiagram source from a rendered sequence <svg>. */
function sequenceFromSvg(svg: Element): string | undefined {
    const actors = new Map<string, { label: string; x: number }>();
    const events: { y: number; line: string }[] = [];
    let pendingText: string | undefined;
    const num = (el: Element, k: string) => Number(prop(el, k) || 0);
    walk(svg, (el, ancestors) => {
        const cls = classes(el);
        if (el.tagName === 'rect' && cls.includes('actor') && !cls.includes('actor-bottom')) {
            const name = prop(el, 'name') || '';
            if (!name || actors.has(name)) return;
            const group = ancestors[ancestors.length - 1];
            const textEl = group && elements(group).find(c => c.tagName === 'text' && classes(c).includes('actor'));
            actors.set(name, { label: textEl ? label(textEl) : name, x: num(el, 'x') + num(el, 'width') / 2 });
        } else if (el.tagName === 'text' && cls.includes('messageText')) {
            pendingText = label(el);
        } else if ((el.tagName === 'line' || el.tagName === 'path') && cls.some(c => /^messageLine[01]$/.test(c))) {
            const dotted = cls.includes('messageLine1');
            const marker = prop(el, 'markerEnd') || '';
            const head = /cross/.test(marker) ? 'x' : /arrowhead|filled|sequencenumber/i.test(marker) ? '>>' : marker ? '>>' : '';
            const x1 = num(el, 'x1'), x2 = el.tagName === 'line' ? num(el, 'x2') : x1;
            const y = num(el, 'y1') || num(el, 'y2');
            events.push({ y, line: `${dotted ? '--' : '-'}${head || '>'}|${x1}|${x2}|${pendingText ?? ''}` });
            pendingText = undefined;
        } else if (el.tagName === 'rect' && cls.includes('note')) {
            const group = ancestors[ancestors.length - 1];
            const textEl = group && elements(group).find(c => c.tagName === 'text' && classes(c).includes('noteText'));
            events.push({ y: num(el, 'y'), line: `note|${num(el, 'x')}|${num(el, 'x') + num(el, 'width')}|${textEl ? label(textEl) : ''}` });
        }
    });
    if (!actors.size) return undefined;
    const list = [...actors.entries()].sort((a, b) => a[1].x - b[1].x);
    const safe = new Map(list.map(([name], i) => [name, /^[A-Za-z][\w]*$/.test(name) && !/^(end|note|loop|alt|participant|actor)$/i.test(name) ? name : 'p' + (i + 1)]));
    const nearest = (x: number) => list.reduce((best, a) => Math.abs(a[1].x - x) < Math.abs(best[1].x - x) ? a : best)[0];
    const clean = (s: string) => s.replace(/[;#]/g, ' ').replace(/\s+/g, ' ').trim();
    const lines = ['sequenceDiagram'];
    for (const [name, a] of list) lines.push(`    participant ${safe.get(name)}${a.label && a.label !== safe.get(name) ? ` as ${clean(a.label)}` : ''}`);
    for (const e of events.sort((a, b) => a.y - b.y)) {
        const [kind, x1, x2, ...rest] = e.line.split('|');
        const t = clean(rest.join('|'));
        if (kind === 'note') {
            const covered = list.filter(([, a]) => a.x >= Number(x1) && a.x <= Number(x2)).map(([n]) => safe.get(n));
            const over = covered.length ? [covered[0], covered[covered.length - 1]].filter((v, i, arr) => arr.indexOf(v) === i) : [safe.get(nearest((Number(x1) + Number(x2)) / 2))];
            lines.push(`    Note over ${over.join(',')}: ${t || ' '}`);
        } else {
            const from = nearest(Number(x1)), to = nearest(Number(x2));
            lines.push(`    ${safe.get(from)}${kind}${safe.get(to)}: ${t || ' '}`);
        }
    }
    return lines.join('\n');
}

/** Points of an SVG path's `d`: first and last coordinate pairs. */
function pathEnds(d: string): [[number, number], [number, number]] | undefined {
    const n = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    return n.length >= 4 ? [[n[0], n[1]], [n[n.length - 2], n[n.length - 1]]] : undefined;
}

/** Rebuilds a Mermaid mindmap from node positions and the edges joining them. */
function mindmapFromSvg(svg: Element): string | undefined {
    const nodes: { label: string; x: number; y: number; root: boolean }[] = [];
    const edges: [[number, number], [number, number]][] = [];
    walk(svg, (el, ancestors) => {
        const cls = classes(el);
        if (el.tagName === 'g' && cls.some(c => c === 'node' || c === 'mindmap-node')) {
            const t = label(el);
            if (!t) return;
            const [ox, oy] = offset(ancestors), [x, y] = translate(el);
            // Older renderers translate to the top-left corner; centre on the node's own shape.
            const shape = elements(el).find(c => c.tagName === 'rect' && prop(c, 'width'));
            const cx = shape ? Number(prop(shape, 'x') || 0) + Number(prop(shape, 'width')) / 2 : 0;
            const cy = shape ? Number(prop(shape, 'y') || 0) + Number(prop(shape, 'height') || 0) / 2 : 0;
            nodes.push({ label: t, x: ox + x + cx, y: oy + y + cy, root: cls.some(c => /root/.test(c)) });
        } else if (el.tagName === 'path' && cls.some(c => c === 'edge' || /^section-edge/.test(c) || c === 'flowchart-link')) {
            const ends = pathEnds(prop(el, 'd') || '');
            if (ends) { const [ox, oy] = offset(ancestors); edges.push([[ends[0][0] + ox, ends[0][1] + oy], [ends[1][0] + ox, ends[1][1] + oy]]); }
        }
    });
    if (nodes.length < 2 || edges.length < nodes.length - 1) return undefined;
    const nearest = ([x, y]: [number, number]) => nodes.reduce((b, n, i) => Math.hypot(n.x - x, n.y - y) < Math.hypot(nodes[b].x - x, nodes[b].y - y) ? i : b, 0);
    const adjacent = nodes.map(() => new Set<number>());
    for (const [a, b] of edges) { const i = nearest(a), j = nearest(b); if (i !== j) { adjacent[i].add(j); adjacent[j].add(i); } }
    const root = Math.max(0, nodes.findIndex(n => n.root));
    const lines = ['mindmap'], seen = new Set([root]);
    const text = (s: string) => s.replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
    (function visit(i: number, depth: number) {
        lines.push('  '.repeat(depth) + (depth === 1 ? `root((${text(nodes[i].label)}))` : text(nodes[i].label)));
        for (const j of [...adjacent[i]].sort((a, b) => nodes[a].y - nodes[b].y || nodes[a].x - nodes[b].x)) if (!seen.has(j)) { seen.add(j); visit(j, depth + 1); }
    })(root, 1);
    return seen.size === nodes.length ? lines.join('\n') : undefined;
}

const roleOf = (svg: Element) => (prop(svg, 'ariaRoleDescription', 'ariaRoledescription') || '').toLowerCase();
/** Shared with the browser so pasted SVGs are counted in the same order. */
export const isMermaidSvgAttributes = (id: string | null | undefined, role: string | null | undefined) => /mermaid/i.test(id || '') || /flowchart|graph|sequence|mindmap/i.test(role || '');
export const isMermaidSvg = (svg: Element) => isMermaidSvgAttributes(prop(svg, 'id'), roleOf(svg));

/** Mermaid source for a rendered diagram <svg>, when its type can be rebuilt. */
export function diagramSourceFromSvg(el: Element): string | undefined {
    const role = roleOf(el);
    return /sequence/.test(role) ? sequenceFromSvg(el) : /mindmap/.test(role) ? mindmapFromSvg(el) : /flowchart|graph|^$/.test(role) ? flowchartFromSvg(el) ?? (role ? undefined : sequenceFromSvg(el)) : undefined;
}

interface RenderedDiagram { source?: string; before: string; after: string; labels: string[] }

/** Text of `node`, split at its <style> element. */
function splitAtStyle(node: Element): { before: string; after: string; labels: string[] } {
    let before = '', after = '', seen = false;
    const labels: string[] = [];
    (function go(n: Node) {
        if (n.type === 'text') { if (seen) after += n.value; else before += n.value; const t = n.value.trim(); if (t) labels.push(t); return; }
        if (n.type === 'element' && n.tagName === 'style') { seen = true; return; }
        if ('children' in n) (n.children as RootContent[]).forEach(go);
    })(node);
    return { before, after, labels };
}

function renderedDiagrams(html: string): RenderedDiagram[] {
    const found: RenderedDiagram[] = [];
    walk(fromHtml(html, { fragment: true }), el => {
        if (el.tagName !== 'svg' || !isMermaidSvg(el)) return;
        found.push({ source: diagramSourceFromSvg(el), ...splitAtStyle(el) });
    });
    return found;
}

const unescape = (s: string) => s.replace(/\\(?=[\\`*_{}[\]()#+\-.!|<>~])/g, '');

/** Finds the end of a run of CSS rules (balanced braces) beginning at `start`. */
function cssRunEnd(text: string, start: number, scope: string): number {
    let i = start, end = start;
    while (i < text.length) {
        const ws = /^[ \t]*/.exec(text.slice(i))![0].length;
        const open = text.indexOf('{', i + ws);
        if (open < 0) break;
        const selector = unescape(text.slice(i + ws, open));
        if (!selector || selector.includes('\n') || !(selector.includes(scope) || /^(@keyframes|@media|@font-face|:root)/.test(selector))) break;
        let depth = 0, j = open;
        for (; j < text.length; j++) {
            if (text[j] === '{') depth++;
            else if (text[j] === '}' && --depth === 0) break;
        }
        if (depth) break;
        i = end = j + 1;
    }
    return end;
}

// Also matches Markdown-escaped copies such as \#chatgpt-mermaid-\_r_19q\_{
const STYLE_START = /\\?#((?:\\?[\w-])*mermaid(?:\\?[\w-])*)\{/g;
const looksLikeMermaidCss = (css: string) => /flowchart-link|edgePath|edgeLabel|\.node rect|\.cluster|\.label|\.actor|messageLine|mindmap/.test(css);

/** Locates leaked Mermaid <style> text blocks: [start, end) offsets. */
function styleBlocks(text: string): [number, number][] {
    const blocks: [number, number][] = [];
    for (const m of text.matchAll(STYLE_START)) {
        if (blocks.length && m.index! < blocks[blocks.length - 1][1]) continue;
        const end = cssRunEnd(text, m.index!, '#' + unescape(m[1]));
        if (end > m.index! && looksLikeMermaidCss(text.slice(m.index!, end))) blocks.push([m.index!, end]);
    }
    return blocks;
}

/** Length of the prefix of `text` that equals `expected` when whitespace and Markdown escapes are ignored, or -1. */
function matchIgnoringSpace(text: string, expected: string, backwards = false): number {
    const want = [...expected.replace(/\s+/g, '')];
    if (!want.length) return 0;
    const chars = [...text];
    if (backwards) { chars.reverse(); want.reverse(); }
    let i = 0, k = 0, used = 0;
    while (i < chars.length && k < want.length) {
        const c = chars[i];
        if (/\s/.test(c) || (c === '\\' && want[k] !== '\\')) { i++; used += c.length; continue; }
        if (c !== want[k]) return -1;
        used += c.length; i++; k++;
    }
    // A backslash escape precedes the character it escapes.
    if (backwards && chars[i] === '\\') used++;
    return k === want.length ? used : -1;
}

const fence = (lang: string, source: string) => '\n\n```' + lang + '\n' + source + '\n```\n\n';
/** A diagram whose structure did not survive copying; rendered as a notice with its labels. */
export const LOST_DIAGRAM = 'lost-diagram';

/** The rest of the line(s) on either side of a block, holding run-together diagram labels. */
function lineEdges(text: string, start: number, end: number): [number, number] {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const nl = text.indexOf('\n', end);
    return [lineStart, nl < 0 ? text.length : nl];
}

/**
 * Rewrites pasted clipboard text that contains rendered Mermaid diagrams.
 * Returns undefined when the paste needs no changes.
 */
export interface PastedDiagrams {
    text: string;
    /** Diagrams that could not be rebuilt as Mermaid: `marker` in `text` awaits an image of SVG number `svg`. */
    images: { marker: string; svg: number }[];
}

/** Placeholder left in the note while a diagram image uploads; an HTML comment, so it never renders. */
export const imageMarker = (nonce: string, i: number) => `<!-- studysprint-diagram ${nonce}-${i} -->`;

export function convertPastedDiagrams(plain: string, html?: string, nonce = Math.random().toString(36).slice(2, 10)): PastedDiagrams | undefined {
    const images: PastedDiagrams['images'] = [];
    const blocks = styleBlocks(plain);
    const diagrams = html && /<svg/i.test(html) ? renderedDiagrams(html) : [];
    if (!blocks.length && !diagrams.some(d => d.source)) return undefined;

    let result = '', cursor = 0;
    blocks.forEach(([start, end], i) => {
        const diagram = diagrams[i];
        let from = start, stop = end, replacement: string;
        if (diagram) {
            // The SVG's labels sit around its CSS in the plain text; drop them with it.
            const back = matchIgnoringSpace(plain.slice(cursor, start), diagram.before, true);
            const ahead = matchIgnoringSpace(plain.slice(end), diagram.after);
            if (back >= 0 && ahead >= 0) { from = start - back; stop = end + ahead; }
            else {
                // Labels in a different order than the SVG: accept the same line if it holds exactly those labels.
                const [lineStart, lineEnd] = lineEdges(plain, start, end);
                const around = plain.slice(Math.max(lineStart, cursor), start) + plain.slice(end, lineEnd);
                const squash = (t: string) => unescape(t).replace(/\s+/g, '');
                if (squash(around).length === squash(diagram.before + diagram.after).length && diagram.labels.every(l => squash(around).includes(squash(l)))) {
                    from = Math.max(lineStart, cursor); stop = lineEnd;
                }
            }
            if (diagram.source) replacement = fence('mermaid', diagram.source);
            else { const marker = imageMarker(nonce, i); images.push({ marker, svg: i }); replacement = '\n\n' + marker + '\n\n'; }
        } else {
            [from, stop] = lineEdges(plain, start, end);
            from = Math.max(from, cursor);
            replacement = fence(LOST_DIAGRAM, unescape(plain.slice(from, start) + plain.slice(end, stop)).trim());
        }
        result += plain.slice(cursor, from).replace(/[ \t]+$/, '') + replacement;
        cursor = stop;
    });
    result += plain.slice(cursor).replace(/^[ \t]*\n?/, '');
    // Diagrams whose CSS was not in the plain text: replace their labels with the rebuilt source.
    if (!blocks.length) for (const d of diagrams) {
        if (!d.source) continue;
        const labels = d.before + d.after;
        const at = result.indexOf(labels.trim());
        result = at >= 0 && labels.trim() ? result.slice(0, at) + fence('mermaid', d.source) + result.slice(at + labels.trim().length) : result + fence('mermaid', d.source);
    }
    return { text: result.replace(/\n{3,}/g, '\n\n').trim() + (plain.endsWith('\n') ? '\n' : ''), images };
}

/** Labels of SVG number `i`, for a lost-diagram notice when its image cannot be saved. */
export function lostDiagramFence(labels: string) { return fence(LOST_DIAGRAM, labels).trim(); }

/** Replaces Mermaid CSS pasted into a note before paste conversion existed with a lost-diagram notice. */
export function stripLeakedDiagramCss(source: string): string {
    if (!source.includes('mermaid')) return source;
    const blocks = styleBlocks(source);
    if (!blocks.length) return source;
    let result = '', cursor = 0;
    for (const [start, end] of blocks) {
        const [from, stop] = lineEdges(source, start, end);
        const begin = Math.max(from, cursor);
        result += source.slice(cursor, begin) + fence(LOST_DIAGRAM, unescape(source.slice(begin, start) + source.slice(end, stop)).trim());
        cursor = stop;
    }
    return result + source.slice(cursor);
}
