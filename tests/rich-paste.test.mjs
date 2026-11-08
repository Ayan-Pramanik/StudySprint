import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { htmlToMarkdown, convertRichPaste } from '../lib/rich-paste.ts';
import { normalizeNoteMath, noteRemarkPlugins, noteRehypePlugins } from '../lib/note-markdown.ts';

const render = source => renderToStaticMarkup(createElement(Markdown, { remarkPlugins: noteRemarkPlugins, rehypePlugins: noteRehypePlugins }, normalizeNoteMath(source)));
const md = html => htmlToMarkdown(html, 'n').text;

const katex = (source, display) => {
    const inner = `<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">${source}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base">garbled</span></span></span>`;
    return display ? `<span class="katex-display">${inner}</span>` : inner;
};

const chatgpt = `<meta charset="utf-8"><div class="markdown prose"><h2>3. Latency</h2>
<p>Transmission time is <strong>key</strong> and <em>often</em> ignored: ${katex('T = \\frac{D}{B}')}.</p>
<p>${katex('\\boxed{v=f\\lambda}', true)}</p>
<ul><li>Scalability<ul><li>Horizontal</li></ul></li><li>Fault tolerance</li></ul>
<ol><li>First</li><li>Second</li></ol>
<table><thead><tr><th>Feature</th><th>Synchronous</th><th>Asynchronous</th></tr></thead><tbody><tr><td>Sender waits</td><td><strong>Yes</strong></td><td>No</td></tr><tr><td>Example</td><td>RPC</td><td>Message queue</td></tr></tbody></table>
<pre class="overflow-visible!"><div class="contain-inline-size"><div class="flex items-center">python</div><div class="sticky"><button>Copy code</button></div><div class="overflow-y-auto"><code class="whitespace-pre! language-python"><span class="hljs-keyword">def</span> f(x):
    <span class="hljs-keyword">return</span> x * 2
</code></div></div></pre>
<blockquote><p>Partial failure is normal.</p></blockquote>
<hr><p>See <a href="https://example.com/x" target="_blank" rel="noopener">the paper</a>.</p></div>`;

test('a ChatGPT answer keeps headings, emphasis, lists, tables, maths, code, quotes and links', () => {
    const out = md(chatgpt);
    assert.match(out, /^## 3\. Latency$/m);
    assert.match(out, /\*\*key\*\* and \*often\*/);
    assert.match(out, /\$T = \\frac\{D\}\{B\}\$/);
    assert.match(out, /\$\$\n\\boxed\{v=f\\lambda\}\n\$\$/);
    assert.doesNotMatch(out, /garbled|Copy code/);
    assert.match(out, /^- Scalability\n  - Horizontal\n- Fault tolerance$/m);
    assert.match(out, /^1\. First\n2\. Second$/m);
    assert.match(out, /\| Feature +\| Synchronous +\| Asynchronous +\|/);
    assert.match(out, /\| Sender waits +\| \*\*Yes\*\* +\| No +\|/);
    assert.match(out, /```python\ndef f\(x\):\n    return x \* 2\n```/);
    assert.match(out, /^> Partial failure is normal\.$/m);
    assert.match(out, /^---$/m);
    assert.match(out, /\[the paper\]\(https:\/\/example\.com\/x\)/);
});

test('converted Markdown renders back to the same structure', () => {
    const html = render(md(chatgpt));
    assert.match(html, /<h2>3\. Latency<\/h2>/);
    assert.match(html, /<table>/);
    assert.match(html, /<td><strong>Yes<\/strong><\/td>/);
    assert.match(html, /katex-display/);
    assert.match(html, /<mfrac>/);
    assert.match(html, /class="hljs language-python"/);
    assert.match(html, /<span class="hljs-keyword">def<\/span>/);
});

test('malicious HTML is reduced to safe text', () => {
    const out = md(`<h1 onclick="steal()">Title</h1><script>alert(1)</script><img src="x" onerror="alert(2)" alt="pic"><a href="javascript:alert(3)">click</a><iframe src="https://evil"></iframe><p style="color:red" onmouseover="x()">ok <img src="https://img.example/a.png" alt="safe"></p><svg onload="alert(4)"><text>icon</text></svg>`);
    assert.doesNotMatch(out, /alert|steal|javascript:|iframe|onerror|onclick|<script/i);
    assert.match(out, /^# Title$/m);
    assert.match(out, /click/);
    assert.match(out, /!\[safe\]\(https:\/\/img\.example\/a\.png\)/);
    const html = render(out);
    assert.doesNotMatch(html, /<script|onerror|javascript:/i);
});

test('rendered Mermaid diagrams become editable Mermaid source or an image marker', () => {
    const svg = `<svg id="chatgpt-mermaid-_r_1_" aria-roledescription="flowchart-v2"><style>#x{fill:red}</style><path class="flowchart-link" data-id="L_A_B_0" marker-end="url(#a)"></path><g class="node" id="flowchart-A-0" transform="translate(0,0)"><foreignObject><div>Client</div></foreignObject></g><g class="node" id="flowchart-B-1" transform="translate(0,100)"><foreignObject><div>Server</div></foreignObject></g></svg>`;
    const gantt = `<svg id="chatgpt-mermaid-_r_2_" aria-roledescription="gantt"><text>Task</text></svg>`;
    const result = htmlToMarkdown(`<h3>Architecture</h3><div>${svg}</div><p>Then:</p>${gantt}<p>End</p>`, 'n');
    assert.match(result.text, /### Architecture\n\n```mermaid\nflowchart TD\n    A\["Client"\]\n    B\["Server"\]\n    A --> B\n```\n\nThen:\n\n<!-- studysprint-diagram n-1 -->\n\nEnd/);
    assert.deepEqual(result.images, [{ marker: '<!-- studysprint-diagram n-1 -->', svg: 1 }]);
});

test('task lists and strikethrough survive', () => {
    const out = md('<ul><li><input type="checkbox" checked disabled> Done</li><li><input type="checkbox"> Todo</li></ul><p><del>old</del></p>');
    assert.match(out, /- \[x\] Done\n- \[ \] Todo/);
    assert.match(out, /~~old~~/);
});

test('paste source priority: Markdown, then structured HTML, else the browser default', () => {
    assert.equal(convertRichPaste({ plain: 'x', markdown: '# Hi\n' }).text, '# Hi\n');
    assert.match(convertRichPaste({ plain: 'Title', html: '<h1>Title</h1>' }).text, /^# Title/);
    assert.equal(convertRichPaste({ plain: 'just text', html: '<span style="color:red">just text</span>' }), undefined);
    assert.equal(convertRichPaste({ plain: 'just text' }), undefined);
});

test('callouts render only from explicit [!TYPE] markers', () => {
    const html = render('> [!EXAM] Partial failure\n> A node can crash while others keep running.\n\n> [!warning]\n> Clocks drift.\n\n> An ordinary quote.\n\n**Important exam concept**');
    assert.match(html, /<div class="callout callout-exam" role="note"><p class="callout-title">Partial failure<\/p>\n<p>A node can crash while others keep running\.<\/p>\n<\/div>/);
    assert.match(html, /<div class="callout callout-warning" role="note"><p class="callout-title">Warning<\/p>\n<p>Clocks drift\.<\/p>\n<\/div>/);
    assert.match(html, /<blockquote>\n<p>An ordinary quote\.<\/p>\n<\/blockquote>/);
    assert.match(html, /<p><strong>Important exam concept<\/strong><\/p>/);
});

test('code is highlighted for common languages but mermaid fences are left as source', () => {
    const html = render('```sql\nSELECT * FROM t;\n```\n\n```rust\nfn main() {}\n```\n\n```mermaid\nflowchart TD\n  A --> B\n```');
    assert.match(html, /hljs-keyword">SELECT/);
    assert.match(html, /language-rust/);
    assert.match(html, /<code class="language-mermaid">flowchart TD\n  A --&gt; B\n<\/code>/);
});
