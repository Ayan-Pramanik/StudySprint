import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
const page = await fetch(base);
assert.equal(page.status, 200);
const html = await page.text();
const paths = [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(p => p.startsWith('/_next/')))];
assert.ok(paths.some(p => p.endsWith('.js')), 'Page must reference JavaScript');
assert.ok(paths.some(p => p.endsWith('.css')), 'Page must reference CSS');
for (const path of paths) {
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, 200, `Missing browser asset: ${path}. Restart the preview after rebuilding.`);
  assert.match(response.headers.get('content-type') || '', path.endsWith('.css') ? /text\/css/ : /javascript/, `Wrong content type: ${path}`);
}
console.log(`PASS: HTML and all ${paths.length} referenced JavaScript/CSS assets are available`);
