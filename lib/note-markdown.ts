import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import type { Options } from 'react-markdown';

export const noteRemarkPlugins = [remarkGfm, remarkMath, remarkBreaks];
export const noteRehypePlugins: Options['rehypePlugins'] = [[rehypeKatex, { trust: false, strict: 'ignore' }]];

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
