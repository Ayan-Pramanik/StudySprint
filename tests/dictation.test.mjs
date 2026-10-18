import assert from 'node:assert/strict';
import { applicationOrigin, validOrigin, guestIdentity, guestId } from '../lib/server/request-security.ts';
import { handleDictation, speechConfiguration } from '../lib/server/dictation.ts';

const publicOrigin = 'https://judges.example.ngrok-free.app';
const guest = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const note = '00000000-0000-4000-8000-000000000003';
const request = (path, headers = {}, method = 'GET') => new Request(`http://127.0.0.1:8789${path}`, {
  method,
  headers: { Cookie: `ss_guest=${guest}`, ...headers },
});
const environment = {
  PUBLIC_ORIGIN: publicOrigin,
  SPEECH_SERVICE_URL: 'http://127.0.0.1:8000',
  SPEECH_SERVICE_SECRET: 'private-service-secret-must-not-reach-browser',
  DB: { prepare(sql) {
    assert.equal(sql, 'SELECT data FROM workspaces WHERE id=?');
    return { bind(id) { return { async first() {
      if (id === guest) return { data: JSON.stringify({ notes: [{ id: note }] }) };
      if (id === other) return { data: JSON.stringify({ notes: [] }) };
      return null;
    } }; } };
  } },
};
const neverFetch = async () => { throw Error('Unexpected upstream request'); };

assert.equal(applicationOrigin(request('/'), {}), 'http://127.0.0.1:8789');
assert.equal(applicationOrigin(request('/'), environment), publicOrigin);
assert.equal(validOrigin(request('/', { Origin: publicOrigin }), environment), true);
assert.equal(validOrigin(request('/', { Origin: 'https://attacker.example', 'X-Forwarded-Host': 'judges.example.ngrok-free.app', 'X-Forwarded-Proto': 'https' }), environment), false);
assert.equal(validOrigin(request('/', { Origin: publicOrigin, 'Sec-Fetch-Site': 'cross-site' }), environment), false);
assert.equal(validOrigin(request('/'), environment, true), false);
assert.equal(validOrigin(request('/'), environment), true); // Existing command-line clients remain usable.
for (const invalid of ['http://example.com', 'https://example.com/path', 'https://user:secret@example.com', 'https://example.com/?query=1']) {
  assert.throws(() => applicationOrigin(request('/'), { PUBLIC_ORIGIN: invalid }));
}
assert.equal(guestId(request('/')), guest);
assert.equal(guestId(request('/', { Cookie: `other=x; ss_guest=${guest}; another=y` })), guest);
assert.equal(guestId(request('/', { Cookie: `ss_guest=${guest}extra` })), undefined);
const secure = guestIdentity(request('/', { Cookie: '' }), environment);
assert.match(secure.cookie, /; Secure$/);
assert.match(secure.cookie, /HttpOnly; SameSite=Lax/);
assert.doesNotMatch(guestIdentity(request('/', { Cookie: '' }), {}).cookie, /Secure/);
assert.equal(guestIdentity(request('/'), environment).cookie, undefined);

assert.equal(await handleDictation(request('/api/workspace'), environment, neverFetch), undefined);
assert.equal((await handleDictation(request('/api/dictation/status', {}, 'POST'), environment, neverFetch)).status, 405);
assert.equal((await handleDictation(request('/api/dictation/status', { Cookie: '' }), environment, neverFetch)).status, 401);
assert.equal((await handleDictation(request('/api/dictation/status', { Origin: 'https://attacker.example' }), environment, neverFetch)).status, 403);
let result = await handleDictation(request('/api/dictation/status'), { ...environment, SPEECH_SERVICE_SECRET: '' }, neverFetch);
assert.deepEqual(await result.json(), { configured: false, available: false, busy: false });

let upstreamCalls = 0;
const healthy = async (url, init) => {
  upstreamCalls++;
  assert.equal(url, 'http://127.0.0.1:8000/health');
  assert.equal(init.headers.Authorization, `Bearer ${environment.SPEECH_SERVICE_SECRET}`);
  assert.equal(init.headers.Cookie, undefined);
  assert.equal(init.redirect, 'manual');
  return Response.json({ available: true, busy: true, secret: 'do not leak', modelPath: '/private/model' });
};
result = await handleDictation(request('/api/dictation/status'), environment, healthy);
assert.deepEqual(await result.json(), { configured: true, available: true, busy: true });
assert.equal(upstreamCalls, 1);
for (const upstream of [async () => { throw Error(environment.SPEECH_SERVICE_SECRET); }, async () => new Response('invalid json'), async () => new Response('private', { status: 500 })]) {
  result = await handleDictation(request('/api/dictation/status'), environment, upstream);
  assert.deepEqual(await result.json(), { configured: true, available: false, busy: false });
}

for (const invalid of ['https://remote.example', 'http://192.168.1.1:8000', 'http://127.0.0.1:8000/path', 'http://user:secret@localhost:8000', 'http://localhost:8000/?x=1']) {
  assert.throws(() => speechConfiguration({ ...environment, SPEECH_SERVICE_URL: invalid }));
  result = await handleDictation(request('/api/dictation/status'), { ...environment, SPEECH_SERVICE_URL: invalid }, neverFetch);
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /private-service-secret|192\.168|user:secret/);
}

const socketHeaders = { Origin: publicOrigin, Upgrade: 'websocket' };
assert.equal((await handleDictation(request(`/api/dictation?noteId=${note}`, { Upgrade: 'websocket' }), environment, neverFetch)).status, 403);
assert.equal((await handleDictation(request(`/api/dictation?noteId=${note}`, { Origin: publicOrigin }), environment, neverFetch)).status, 426);
assert.equal((await handleDictation(request('/api/dictation?noteId=missing', socketHeaders), environment, neverFetch)).status, 404);
assert.equal((await handleDictation(request(`/api/dictation?noteId=${note}`, { ...socketHeaders, Cookie: `ss_guest=${other}` }), environment, neverFetch)).status, 404);
let socketCalled = false;
result = await handleDictation(request(`/api/dictation?noteId=${note}`, socketHeaders), environment, async (url, init) => {
  socketCalled = true;
  assert.equal(url, 'http://127.0.0.1:8000/asr?mode=full');
  assert.deepEqual(init.headers, { Upgrade: 'websocket', Authorization: `Bearer ${environment.SPEECH_SERVICE_SECRET}` });
  assert.equal(init.redirect, 'manual');
  assert.equal(init.cache, 'no-store');
  assert.ok(init.signal instanceof AbortSignal);
  return new Response('private upstream detail', { status: 500 });
});
assert.equal(socketCalled, true);
assert.equal(result.status, 503);
assert.doesNotMatch(await result.text(), /private upstream detail/);
console.log('Dictation request security, ownership, configuration and upstream failure checks passed.');
