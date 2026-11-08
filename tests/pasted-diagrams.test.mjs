import test from 'node:test';
import assert from 'node:assert/strict';
import { convertPastedDiagrams, stripLeakedDiagramCss } from '../lib/pasted-diagrams.ts';

const S = '#chatgpt-mermaid-_r_1de_';
const css = `${S}{font-family:-apple-system-body,ui-sans-serif,sans-serif;font-size:16px;fill:rgb(237, 237, 237);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}${S} .edge-animation-slow{stroke-dasharray:9,5!important;}${S} .edgePath .path{stroke:rgb(175, 175, 175);stroke-width:1px;}${S} .flowchart-link{stroke:rgb(175, 175, 175);fill:none;}${S} .node rect{rx:16px;ry:16px;}${S} :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,"Segoe UI";}`;
const labels = ['Rider app', 'Ride booking service', 'Driver app', 'Matching service', 'Booking database', 'Payment service', 'Replicated data'];
const intro = '12. Putting everything together — Ride-sharing case study\nLecture slide 32 · PDF pages 37–38\n\nA simplified architecture could look like this:\n\n';
const plain = intro + css + labels.join('');

const node = (name, label, x, y, extra = '') => `<g class="node default ${extra}" id="${S.slice(1)}-flowchart-${name}-0" transform="translate(${x}, ${y})"><rect class="basic label-container"></rect><g class="label"><foreignObject><div><span class="nodeLabel"><p>${label}</p></span></div></foreignObject></g></g>`;
const edge = (from, to, n) => `<path class="edge-thickness-normal edge-pattern-solid flowchart-link" id="${S.slice(1)}-L_${from}_${to}_${n}" data-id="L_${from}_${to}_${n}" marker-end="url(#arrow)"></path>`;
const html = `<h3>12. Putting everything together</h3><svg id="${S.slice(1)}" aria-roledescription="flowchart-v2"><style>${css}</style><g class="root">
<g class="clusters"></g>
<g class="edgePaths">${edge('Rider', 'Booking', 0)}${edge('Driver', 'Booking', 0)}${edge('Booking', 'Matching', 0)}${edge('Booking', 'DB', 0)}${edge('Booking', 'Pay', 0)}${edge('DB', 'Replica', 0)}</g>
<g class="edgeLabels">${['L_Rider_Booking_0', 'L_Driver_Booking_0', 'L_Booking_Matching_0', 'L_Booking_DB_0', 'L_Booking_Pay_0', 'L_DB_Replica_0'].map(id => `<g class="edgeLabel"><g class="label" data-id="${id}"><foreignObject><div><span class="edgeLabel"></span></div></foreignObject></g></g>`).join('')}</g>
<g class="nodes">${node('Rider', labels[0], 50, 50)}${node('Booking', labels[1], 150, 150)}${node('Driver', labels[2], 250, 50)}${node('Matching', labels[3], 50, 250)}${node('DB', labels[4], 150, 250, 'cylinder')}${node('Pay', labels[5], 250, 250)}${node('Replica', labels[6], 150, 350)}</g></g></svg>`;

test('a pasted ChatGPT diagram becomes a mermaid block, with CSS and run-together labels removed', () => {
    const out = convertPastedDiagrams(plain, html).text;
    assert.ok(out.startsWith('12. Putting everything together'));
    assert.doesNotMatch(out, /font-family|stroke-dash|@keyframes/);
    assert.doesNotMatch(out, /Rider appRide/);
    assert.match(out, /```mermaid\nflowchart TD\n/);
    assert.match(out, /Rider\["Rider app"\]/);
    assert.match(out, /DB\[\("Booking database"\)\]/);
    assert.match(out, /Rider --> Booking/);
    assert.match(out, /Booking --> Matching/);
    assert.match(out, /DB --> Replica/);
});

test('plain-text-only pastes become a lost-diagram notice holding the labels', () => {
    const out = convertPastedDiagrams(plain).text;
    assert.doesNotMatch(out, /font-family|@keyframes/);
    assert.match(out, /A simplified architecture could look like this:\n\n```lost-diagram\nRider appRide booking service/);
});

test('labels copied in a different order than the SVG are still removed', () => {
    const shuffled = intro + css + [...labels].reverse().join('') + '\nNext paragraph';
    const out = convertPastedDiagrams(shuffled, html).text;
    assert.doesNotMatch(out, /Replicated dataPayment/);
    assert.match(out, /```\n\nNext paragraph$/);
});

test('ordinary pastes are left alone', () => {
    assert.equal(convertPastedDiagrams('Hello {world}', '<p>Hello</p>'), undefined);
    assert.equal(convertPastedDiagrams('#title{color:red} a CSS example'), undefined);
});

test('notes already containing leaked diagram CSS display without it', () => {
    const out = stripLeakedDiagramCss(plain);
    assert.doesNotMatch(out, /font-family|@keyframes/);
    assert.match(out, /Lecture slide 32/);
    assert.match(out, /```lost-diagram\nRider app/);
    // Notes saved through a Markdown converter have escaped selectors and labels before the CSS.
    const escaped = 'Imagine one ticket.\n\nServer BDatabaseServer A' + css.replaceAll(S, '\\#chatgpt-mermaid-\\_r_1ah\\_').replace('\\#', '\\#') + 'Reserve ticket\n\nBoth servers';
    const cleaned = stripLeakedDiagramCss(escaped);
    assert.doesNotMatch(cleaned, /font-family|chatgpt-mermaid/);
    assert.match(cleaned, /Imagine one ticket\.\n\n\n\n```lost-diagram\nServer BDatabaseServer AReserve ticket\n```/);
    assert.match(cleaned, /Both servers/);
    assert.equal(stripLeakedDiagramCss('no diagrams here'), 'no diagrams here');
});

test('edge labels, dotted links and subgraphs are preserved', () => {
    const svg = `<svg id="mermaid-1" aria-roledescription="flowchart-v2"><g class="clusters"><g class="cluster" id="Backend" data-id="Backend"><rect x="0" y="0" width="200" height="100"></rect><g class="cluster-label"><foreignObject><div><span>Backend</span></div></foreignObject></g></g></g>
<path class="edge-pattern-dotted flowchart-link" data-id="L_my_api_db_0" marker-end="url(#a)"></path>
<g class="edgeLabel"><g class="label" data-id="L_my_api_db_0"><foreignObject><div>reads</div></foreignObject></g></g>
<g class="node" id="flowchart-my_api-1" transform="translate(50, 50)"><text>API</text></g><g class="node" id="flowchart-db-2" transform="translate(400, 50)"><text>DB</text></g></svg>`;
    const out = convertPastedDiagrams('API DB', svg).text;
    assert.match(out, /flowchart LR/);
    assert.match(out, /subgraph g1\["Backend"\]\n\s+my_api\["API"\]\n\s+end/);
    assert.match(out, /my_api -\.->\|"reads"\| db/);
});

test('sequence diagrams are rebuilt with participants, messages and notes', () => {
    const seq = `<svg id="chatgpt-mermaid-_r_1ah_" aria-roledescription="sequence"><g><rect class="actor actor-top" name="A" x="0" y="0" width="100" height="40"></rect><text class="actor actor-box">Server A</text></g><g><rect class="actor actor-top" name="DB" x="200" y="0" width="100" height="40"></rect><text class="actor actor-box">Database</text></g><style>${css}</style>
<text class="messageText">Check remaining tickets</text><line class="messageLine0" x1="50" x2="250" y1="80" y2="80" marker-end="url(#arrowhead)"></line>
<text class="messageText">1 ticket</text><line class="messageLine1" x1="250" x2="50" y1="120" y2="120" marker-end="url(#arrowhead)"></line>
<g><rect class="note" x="10" y="150" width="280" height="30"></rect><text class="noteText">Potential double booking</text></g></svg>`;
    const out = convertPastedDiagrams('Before\nServer ADatabase' + css + 'Check remaining tickets1 ticketPotential double booking\nAfter', seq).text;
    assert.equal(out, 'Before\n\n```mermaid\nsequenceDiagram\n    participant A as Server A\n    participant DB as Database\n    A->>DB: Check remaining tickets\n    DB-->>A: 1 ticket\n    Note over A,DB: Potential double booking\n```\n\nAfter');
});

test('mind maps are rebuilt from node positions and edges', () => {
    const n = (cls, x, y, t) => `<g class="node mindmap-node ${cls}" transform="translate(${x}, ${y})"><rect x="-40" y="-15" width="80" height="30"></rect><foreignObject><div>${t}</div></foreignObject></g>`;
    const e = (x1, y1, x2, y2) => `<path class="edge section-edge-0 edge-depth-1" d="M${x1},${y1} C${x1},${y1} ${x2},${y2} ${x2},${y2}"></path>`;
    const svg = `<svg id="chatgpt-mermaid-_r_1a9_" aria-roledescription="mindmap"><style>${css}</style>${e(200, 200, 100, 100)}${e(200, 200, 300, 100)}${e(300, 100, 380, 40)}${n('section-root', 200, 200, 'Distributed Systems')}${n('section-0', 100, 100, 'Concurrency')}${n('section-1', 300, 100, 'Scalability')}${n('section-1', 380, 40, 'Elastic (cloud)')}</svg>`;
    const out = convertPastedDiagrams(css + 'Distributed SystemsConcurrencyScalabilityElastic (cloud)', svg).text;
    assert.equal(out, '```mermaid\nmindmap\n  root((Distributed Systems))\n    Concurrency\n    Scalability\n      Elastic cloud\n```');
});

test('diagrams that cannot be rebuilt leave an image placeholder', () => {
    const svg = `<svg id="chatgpt-mermaid-_r_x_" aria-roledescription="gantt"><style>${css}</style><text>Task one</text></svg>`;
    const out = convertPastedDiagrams('Plan\n' + css + 'Task one\nEnd', svg, 'abc');
    assert.equal(out.text, 'Plan\n\n<!-- studysprint-diagram abc-0 -->\n\nEnd');
    assert.deepEqual(out.images, [{ marker: '<!-- studysprint-diagram abc-0 -->', svg: 0 }]);
});

test('pasted images are identified by signature with their dimensions', async () => {
    const { sniffImage } = await import('../lib/pasted-images.ts');
    const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0, 0, 0, 1, 0x2c]);
    assert.deepEqual(sniffImage(png), { mediaType: 'image/png', width: 512, height: 300 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 120, 0, 160, 3, 0, 0, 0]);
    assert.deepEqual(sniffImage(jpeg), { mediaType: 'image/jpeg', width: 160, height: 120 });
    assert.equal(sniffImage(new TextEncoder().encode('<svg onload="x()"></svg>')), undefined);
});
