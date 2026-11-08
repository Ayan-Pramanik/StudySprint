import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import type { Options } from 'react-markdown';
import type { Element, ElementContent, Root } from 'hast';

/** Callout titles for `> [!TYPE]` blockquotes (GitHub alert syntax, plus study-specific types). */
export const CALLOUTS: Record<string, string> = {
    note: 'Note', info: 'Info', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution',
    exam: 'Exam takeaway', definition: 'Definition', summary: 'Summary', example: 'Example', concept: 'Key concept',
};

/** Turns `> [!WARNING] Optional title` blockquotes into callout boxes; other quotes are untouched. */
export function rehypeCallouts() {
    const visit = (node: Root | Element) => {
        node.children.forEach((child, i) => {
            if (child.type !== 'element') return;
            visit(child);
            if (child.tagName !== 'blockquote') return;
            const first = child.children.find((c): c is Element => c.type === 'element');
            const lead = first?.tagName === 'p' ? first.children[0] : undefined;
            const match = lead?.type === 'text' ? /^\s*\[!([a-z]+)\][ \t]*([^\n]*)/i.exec(lead.value) : null;
            if (!first || !lead || lead.type !== 'text' || !match || !CALLOUTS[match[1].toLowerCase()]) return;
            const kind = match[1].toLowerCase();
            const rest = lead.value.slice(match[0].length).replace(/^\n/, '');
            // The title is the rest of the marker's line (remark-breaks ends that line with <br>).
            const titleText = match[2].trim();
            first.children.splice(0, 1, ...(rest ? [{ type: 'text', value: rest } as ElementContent] : []));
            while (first.children[0]?.type === 'element' && (first.children[0] as Element).tagName === 'br' || (first.children[0]?.type === 'text' && !(first.children[0] as { value: string }).value.trim())) first.children.shift();
            const body = child.children.filter(c => !(c === first && !first.children.length));
            const callout: Element = {
                type: 'element', tagName: 'div', properties: { className: ['callout', 'callout-' + kind], role: 'note' },
                children: [{ type: 'element', tagName: 'p', properties: { className: ['callout-title'] }, children: [{ type: 'text', value: titleText || CALLOUTS[kind] }] }, ...body],
            };
            node.children[i] = callout;
        });
    };
    return (tree: Root) => visit(tree);
}

export const noteRemarkPlugins = [remarkGfm, remarkMath, remarkBreaks];
// Mermaid and lost-diagram fences are rendered as diagrams, so their text must stay unhighlighted.
export const noteRehypePlugins: Options['rehypePlugins'] = [[rehypeKatex, { trust: false, strict: 'ignore' }], [rehypeHighlight, { detect: false, plainText: ['mermaid', 'lost-diagram', 'text', 'txt', 'plain'] }], rehypeCallouts];

const parser = unified().use(remarkParse);

/** Accept LaTeX delimiters without changing literal examples inside code. */
export function normalizeNoteMath(source: string): string {
    if (!source.includes('\\[') && !source.includes('\\(')) return source;
    const tree = parser.parse(source);
    const ranges: { start: number; end: number }[] = [];
    function collect(node: { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: typeof tree.children }) {
        if ((node.type === 'code' || node.type === 'inlineCode') && node.position) {
            ranges.push({ start: node.position.start.offset!, end: node.position.end.offset! });
        } else node.children?.forEach(collect);
    }
    collect(tree);
    const convert = (text: string) => text
        .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_, math: string) => '\n\n$$\n' + math.trim() + '\n$$\n\n')
        .replace(/(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g, (_, math: string) => '$' + math.trim() + '$');
    let end = 0, result = '';
    for (const range of ranges) {
        result += convert(source.slice(end, range.start)) + source.slice(range.start, range.end);
        end = range.end;
    }
    return result + convert(source.slice(end));
}
