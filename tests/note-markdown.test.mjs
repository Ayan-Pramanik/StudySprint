import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { normalizeNoteMath, noteRemarkPlugins, noteRehypePlugins } from '../lib/note-markdown.ts';

function render(source) {
    return renderToStaticMarkup(createElement(Markdown, {
        remarkPlugins: noteRemarkPlugins,
        rehypePlugins: noteRehypePlugins,
        children: normalizeNoteMath(source),
    }));
}

test('lecture equations render as accessible display math with boxes and fractions', () => {
    const html = render(String.raw`\[
\boxed{v=f\lambda}\qquad
\boxed{T=\frac1f}\qquad
\boxed{\lambda=\frac cf}
\]`);
    assert.match(html, /katex-display/);
    assert.match(html, /<math /);
    assert.match(html, /<mfrac>/);
    assert.match(html, /λ/);
    assert.doesNotMatch(html, /katex-error/);
});

test('inline and dollar math work alongside readable line breaks and section dividers', () => {
    const html = render(String.raw`Speed is \(v=f\lambda\).
Period is $T=1/f$.

*lecture’s simplified assumptions.*

---

**1. Frequency, wavelength and signals — pp. 7–16**`);
    assert.match(html, /<br\/>/);
    assert.match(html, /<em>lecture’s simplified assumptions\.<\/em>/);
    assert.match(html, /<hr\/>/);
    assert.match(html, /<strong>1\. Frequency/);
    assert.equal((html.match(/class="katex"/g) || []).length, 2);
});

test('literal LaTeX inside inline, fenced, and indented code remains untouched', () => {
    for (const source of ['Use `\\(x\\)` literally.', '```tex\n\\[x\\]\n```', '    \\[x\\]']) {
        assert.equal(normalizeNoteMath(source), source);
        assert.doesNotMatch(render(source), /class="katex"/);
    }
});

test('existing dollar display math and Markdown tables still render', () => {
    const html = render('$$\nx^2\n$$\n\n| Signal | Frequency |\n|---|---|\n| A | 10 Hz |');
    assert.match(html, /katex-display/);
    assert.match(html, /<table>/);
});

// KaTeX HTML and CSS must come from the same release: mismatches distort boxes and fractions.
test('math renderer and global stylesheet use the same KaTeX version', () => {
    const require = createRequire(import.meta.url);
    const rendererRequire = createRequire(require.resolve('rehype-katex'));
    assert.equal(require('katex/package.json').version, rendererRequire('katex/package.json').version);
});
