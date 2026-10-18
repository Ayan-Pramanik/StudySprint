import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { appPort, assertPortFree, captureChildIdentity, launchBarrier, parseConfig, processCommands, processIdentity, publicOrigin, reconcileExecIdentity, sameProcess, signalOwned, stableChildIdentity, stopOwnedGroups, waitFor, workerVariables } from '../scripts/judges-common.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { migrationNeeded } from '../scripts/judges-database.mjs';
import { workspaceReady } from '../scripts/judges-readiness.mjs';

assert.equal(publicOrigin('https://account-domain.ngrok-free.app/'), 'https://account-domain.ngrok-free.app');
assert.equal(publicOrigin('https://account-domain.ngrok-free.dev'), 'https://account-domain.ngrok-free.dev');
for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com:8787', 'https://example.com/?x=1', 'https://localhost']) assert.throws(() => publicOrigin(url));
assert.equal(appPort(), 8789);
assert.equal(appPort('8790'), 8790);
for (const port of [8000, 4040, 0, 1023, 65536, 'oops', 8789.5]) assert.throws(() => appPort(port));
assert.deepEqual(parseConfig('# comment\nJUDGES_PUBLIC_URL="https://example.ngrok-free.app"\nSPEECH_SERVICE_SECRET=abc_123\n'), { JUDGES_PUBLIC_URL: 'https://example.ngrok-free.app', SPEECH_SERVICE_SECRET: 'abc_123' });
assert.throws(() => parseConfig('export TOKEN=value'));
assert.equal(migrationNeeded([]), true);
assert.equal(migrationNeeded([{ name: 'workspaces' }, { name: 'review_events' }]), false);
assert.throws(() => migrationNeeded([{ name: 'workspaces' }]));
assert.throws(() => migrationNeeded([{ name: 'review_events' }]));

const bootstrap = { pid: 12345, pgid: 12345, started: 'fixed-start', command: '/venv/python -m speech.app' };
const terminal = { ...bootstrap, command: '/framework/Python.app/Python -m speech.app' };
const permitted = { bootstrap: [bootstrap.command], terminal: [terminal.command] };
assert.deepEqual(reconcileExecIdentity(bootstrap, terminal, permitted), terminal);
for (const changed of [{ ...terminal, pid: 12346 }, { ...terminal, pgid: 1 }, { ...terminal, started: 'reused-pid' }, { ...terminal, command: '/unrelated/python -m speech.app' }]) assert.equal(reconcileExecIdentity(bootstrap, changed, permitted), undefined);
assert.equal(sameProcess(bootstrap, terminal), false, 'Ordinary process checks must remain exact after bootstrap capture');
const mockChild = { pid: 12345, exitCode: null, signalCode: null, killed: false };
let observations = 0;
assert.deepEqual(await stableChildIdentity(mockChild, permitted, { stableMs: 0, readIdentity: () => ++observations === 1 ? bootstrap : terminal }), terminal);

const config = { origin: 'https://assigned.ngrok-free.app', speechUrl: 'http://127.0.0.1:8000', secret: 'a'.repeat(64) };
assert.equal(parseConfig(workerVariables(config)).PUBLIC_ORIGIN, config.origin);
assert.equal(parseConfig(workerVariables(config, true)).PUBLIC_ORIGIN, undefined, 'Local mode must use the actual HTTP request origin');
for (const [base, browserOrigin] of [
  ['http://127.0.0.1:8789', undefined],
  [config.origin, undefined],
  ['http://127.0.0.1:8789', config.origin],
]) {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push([url, init]);
    if(url.endsWith('/api/auth/signup'))return Response.json({ok:true},{headers:{'set-cookie':'ss_session=fixture; HttpOnly; SameSite=Lax'+(base.startsWith('https:')?'; Secure':'')}});
    if (url.endsWith('/api/dictation/status')) {
      assert.equal(init.headers.cookie, 'ss_session=fixture');
      return Response.json({ configured: true, available: true, busy: false });
    }
    if (init.method === 'POST' || url.endsWith('/api/dictation')) {
      assert.equal(init.headers.Origin, browserOrigin ?? new URL(base).origin, 'Both mutation and streaming probes must use the configured browser origin, even over loopback');
      return init.method === 'POST' ? Response.json({ error: 'Unknown action' }, { status: 400 }) : Response.json({ error: 'A WebSocket connection is required.' }, { status: 426 });
    }
    return Response.json({ workspace: {}, version: 0 }, { headers: { 'set-cookie': 'ss_session=fixture; HttpOnly; SameSite=Lax' + (base.startsWith('https:') ? '; Secure' : '') } });
  };
  assert.equal(await workspaceReady(base, { publicCheck: base.startsWith('https:'), browserOrigin, fetcher }), true);
  assert.equal(requests.length, 5, 'Readiness must cover workspace, speech health, mutation origin and streaming origin');
}

const barrier = launchBarrier();
let register;
let registered = false;
let cleaned = false;
const inFlight = barrier.start(async () => { await new Promise(resolve => { register = resolve; }); registered = true; });
await Promise.resolve();
const shutdown = barrier.close().then(() => { assert.equal(registered, true); cleaned = true; });
await assert.rejects(barrier.start(() => { throw Error('must not run'); }), /cancelled/);
assert.equal(cleaned, false, 'Cleanup must wait for an in-flight spawn to register');
register();
await Promise.all([inFlight, shutdown]);
let alive = true;
const healthWait = waitFor(() => false, { alive: () => alive, interval: 1, timeout: 1000 });
alive = false;
await assert.rejects(healthWait, /stopped before it was ready/, 'Stopping during health readiness must end the wait');

const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await assert.rejects(assertPortFree(port), /already in use/);
assert.equal(server.listening, true, 'A collision must never stop the existing listener');
await new Promise(resolve => server.close(resolve));
await assertPortFree(port);

const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
try {
  const identity = await waitFor(() => processIdentity(child.pid), { timeout: 3000, label: 'test child' });
  const other = await waitFor(() => processIdentity(unrelated.pid), { timeout: 3000, label: 'unrelated child' });
  assert.equal(signalOwned({ ...identity, started: 'a different process start' }), false, 'A reused PID identity must not be signalled');
  assert.equal(sameProcess(identity), true);
  const exited = once(child, 'exit');
  assert.equal(signalOwned(identity), true);
  await exited;
  assert.equal(sameProcess(other), true, 'Stopping an owned group must leave another process alone');
  assert.equal(signalOwned(identity), false, 'An exited process cannot be signalled');
} finally {
  for (const process of [child, unrelated]) if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL');
}

// The group leader exits first; its descendant deliberately ignores TERM.
const descendantCode = 'process.on("SIGTERM",()=>{}); process.stdout.write("ready"); setInterval(()=>{},1000)';
const leaderCode = `
  const {spawn}=require('node:child_process');
  process.on('SIGTERM',()=>process.exit(0));
  const child=spawn(process.execPath,['-e',${JSON.stringify(descendantCode)}],{stdio:['ignore','pipe','ignore']});
  child.stdout.once('data',()=>process.stdout.write(JSON.stringify({pid:child.pid})+'\\n'));
  setInterval(()=>{},1000);
`;
const leader = spawn(process.execPath, ['-e', leaderCode], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
const leaderExit = once(leader, 'exit');
const bystander = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
let descendant;
try {
  const [announced] = await once(leader.stdout, 'data');
  const descendantPid = JSON.parse(announced.toString()).pid;
  const owner = processIdentity(leader.pid);
  descendant = processIdentity(descendantPid);
  const other = processIdentity(bystander.pid);
  assert.equal(descendant.pgid, owner.pid, 'The child fixture must share its leader’s process group');
  let savedDescendant = false;
  const result = await stopOwnedGroups([owner], {
    grace: 150, killWait: 3000,
    onUpdate: async groups => { savedDescendant ||= groups.some(group => group.members.some(member => member.pid === descendantPid)); },
  });
  await leaderExit;
  assert.equal(savedDescendant, true, 'Descendant identity must be saved before the leader exits');
  assert.equal(result.clean, true, 'A surviving known descendant must anchor group SIGKILL after leader exit');
  assert.equal(sameProcess(descendant), false, 'The TERM-resistant descendant must be gone');
  assert.equal(sameProcess(other), true, 'A separate process group must remain untouched');
  const unproven = await stopOwnedGroups([{ ...other, started: 'not this process' }], { grace: 0, killWait: 0 });
  assert.equal(unproven.clean, false, 'An unproven reused group must retain ownership state');
  assert.equal(unproven.groups.length, 1);
  assert.equal(sameProcess(other), true, 'An unproven process group must never be signalled');
} finally {
  if (descendant && sameProcess(descendant)) signalOwned(descendant, 'SIGKILL', false);
  for (const child of [leader, bystander]) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

const python = path.resolve('speech/.venv/bin/python');
if (existsSync(python)) {
  const args = ['-c', 'import time; time.sleep(60)'];
  const expected = processCommands(python, args, { python: true });
  const child = spawn(python, args, { detached: true, stdio: 'ignore' });
  let identity;
  try {
    identity = await stableChildIdentity(child, expected);
    assert.equal(expected.terminal.includes(identity.command), true, 'Capture must wait for the actual macOS Python executable');
    assert.equal(sameProcess(identity), true);
    const stopped = await stopOwnedGroups([identity], { grace: 500, killWait: 1000 });
    assert.equal(stopped.clean, true, 'A real venv Python must remain stoppable after framework exec');
  } finally {
    if (identity && sameProcess(identity)) signalOwned(identity, 'SIGKILL');
    else if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}
const nodeArgs = ['-e', 'setInterval(()=>{},1000)'];
const nodeChild = spawn(process.execPath, nodeArgs, { detached: true, stdio: 'ignore' });
let nodeIdentity;
try {
  nodeIdentity = await stableChildIdentity(nodeChild, processCommands(process.execPath, nodeArgs));
  assert.equal(sameProcess(nodeIdentity), true);
  assert.equal((await stopOwnedGroups([nodeIdentity], { grace: 500, killWait: 1000 })).clean, true);
} finally {
  if (nodeIdentity && sameProcess(nodeIdentity)) signalOwned(nodeIdentity, 'SIGKILL');
  else if (nodeChild.exitCode === null && nodeChild.signalCode === null) nodeChild.kill('SIGKILL');
}
const failedChild = spawn(process.execPath, nodeArgs, { detached: true, stdio: 'ignore' });
let provisional;
try {
  const expected = processCommands(process.execPath, nodeArgs);
  expected.terminal = ['/a/terminal/executable/that/will/not/appear'];
  await assert.rejects(captureChildIdentity(failedChild, expected, { timeout: 200, onProvisional: async record => { provisional = { ...record }; } }), /finish its expected bootstrap/);
  assert.equal(sameProcess(provisional), true, 'A failed stable capture must preserve a provably owned provisional process');
  assert.equal((await stopOwnedGroups([provisional], { grace: 500, killWait: 1000 })).clean, true, 'Bootstrap failure must not leave an untracked live child');
} finally {
  if (provisional && sameProcess(provisional)) signalOwned(provisional, 'SIGKILL');
  else if (failedChild.exitCode === null && failedChild.signalCode === null) failedChild.kill('SIGKILL');
}
console.log('PASS: origin readiness, shutdown barrier, migration preservation, owned descendant shutdown and Python/Node executable bootstrap');
