import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const RUNTIME = path.join(ROOT, '.sites-runtime/judges');
export const CONFIG = path.join(ROOT, '.sites-runtime/judges.env');
export const MANIFEST = path.join(RUNTIME, 'run.json');
export const PERSIST = path.join(ROOT, '.wrangler/judges-state');
export const DEFAULT_PORT = 8789;
export const SPEECH_PORT = 8000;
export const NGROK_AGENT_PORT = 4040;

export function publicOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Set JUDGES_PUBLIC_URL to the HTTPS URL assigned in your ngrok account.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !url.hostname.includes('.')) {
    throw Error('JUDGES_PUBLIC_URL must be a public HTTPS origin without a path, port, query or credentials.');
  }
  return url.origin;
}

export function appPort(value = DEFAULT_PORT) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [SPEECH_PORT, NGROK_AGENT_PORT].includes(port)) throw Error('STUDYSPRINT_PORT must be an unused port from 1024 to 65535, excluding 8000 and 4040.');
  return port;
}

export function parseConfig(source) {
  const result = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw Error('Invalid judges.env line; use KEY=value or a JSON-quoted string.');
    const value = match[2].trim();
    result[match[1]] = value.startsWith('"') ? JSON.parse(value) : value;
    if (typeof result[match[1]] !== 'string') throw Error('judges.env values must be strings.');
  }
  return result;
}

export async function readConfig(overrides = {}, { localOnly = false } = {}) {
  let disk = {};
  try { disk = parseConfig(await readFile(CONFIG, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const values = { ...disk, ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)), ...overrides };
  const origin = values.JUDGES_PUBLIC_URL ? publicOrigin(values.JUDGES_PUBLIC_URL) : localOnly ? undefined : publicOrigin(undefined);
  const secret = values.SPEECH_SERVICE_SECRET;
  if (!secret || !/^[a-zA-Z0-9_-]{32,256}$/.test(secret)) throw Error('Run judges:setup to create a private speech service secret.');
  return { origin, secret, port: appPort(values.STUDYSPRINT_PORT), speechUrl: `http://127.0.0.1:${SPEECH_PORT}` };
}

export async function writePrivate(file, contents) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, contents, { mode: 0o600 });
  await chmod(file, 0o600);
}

export async function createConfig(origin, port, { localOnly = false } = {}) {
  let previous = {};
  try { previous = parseConfig(await readFile(CONFIG, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const values = {
    ...(origin || previous.JUDGES_PUBLIC_URL ? { JUDGES_PUBLIC_URL: publicOrigin(origin || previous.JUDGES_PUBLIC_URL) } : {}),
    STUDYSPRINT_PORT: String(appPort(port ?? previous.STUDYSPRINT_PORT)),
    SPEECH_SERVICE_SECRET: previous.SPEECH_SERVICE_SECRET || randomBytes(32).toString('hex'),
  };
  await writePrivate(CONFIG, '# Private local judging configuration. Never commit or share.\n' + Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
  return readConfig(values, { localOnly });
}

export function workerVariables(config, localOnly = false) {
  return [
    ...(!localOnly ? [`PUBLIC_ORIGIN=${JSON.stringify(publicOrigin(config.origin))}`] : []),
    `SPEECH_SERVICE_URL=${JSON.stringify(config.speechUrl)}`,
    `SPEECH_SERVICE_SECRET=${JSON.stringify(config.secret)}`,
  ].join('\n') + '\n';
}

/** Shutdown waits for all spawns to finish registration before removing state. */
export function launchBarrier() {
  const pending = new Set();
  let closed = false;
  return {
    start(operation) {
      if (closed) return Promise.reject(Error('Startup cancelled.'));
      const promise = Promise.resolve().then(operation);
      pending.add(promise);
      promise.finally(() => pending.delete(promise)).catch(() => {});
      return promise;
    },
    async close() { closed = true; await Promise.allSettled([...pending]); },
  };
}

export function executable(name) {
  const result = spawnSync('/usr/bin/which', [name], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim().split('\n')[0] : undefined;
}

export function python311() {
  const candidates = [...new Set([process.env.SPEECH_PYTHON, '/opt/homebrew/bin/python3.11', executable('python3.11')].filter(Boolean))];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-c', 'import json,platform,sys; print(json.dumps([list(sys.version_info[:2]),platform.machine(),sys.executable]))'], { encoding: 'utf8' });
    try {
      const [version, architecture, resolved] = JSON.parse(result.stdout);
      if (result.status === 0 && version.join('.') === '3.11' && architecture === 'arm64') return resolved;
    } catch { /* Try the next interpreter. */ }
  }
  throw Error('Native ARM Python 3.11 is required. Install python@3.11 with Homebrew, or set SPEECH_PYTHON to an ARM Python 3.11 executable.');
}

export async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(Error(`Port ${port} is already in use. Stop its owner yourself or choose a different app port; this launcher never replaces another server.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

export function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid < 1) return undefined;
  try {
    const started = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const pgid = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pgid='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    return started && command && pgid > 0 ? { pid, started, command, pgid } : undefined;
  } catch { return undefined; }
}

export function sameProcess(expected, actual = expected && processIdentity(expected.pid)) {
  return Boolean(expected && actual && expected.pid === actual.pid && expected.started === actual.started && expected.command === actual.command && (expected.pgid === undefined || expected.pgid === actual.pgid));
}

/** macOS framework Python re-execs Python.app after the venv launcher starts. */
export function processCommands(command, args, { python = false } = {}) {
  const format = executable => [executable, ...args].join(' ');
  const bootstrap = [...new Set([command, realpathSync(command)])].map(format);
  let terminal = [...bootstrap];
  if (python) {
    const probe = spawnSync(command, ['-c', 'import json,os,sys; print(json.dumps(os.path.realpath(sys._base_executable)))'], { encoding: 'utf8' });
    if (probe.status !== 0) throw Error('Unable to resolve the speech Python runtime.');
    const base = JSON.parse(probe.stdout);
    const framework = path.join(path.dirname(path.dirname(base)), 'Resources/Python.app/Contents/MacOS/Python');
    if (process.platform === 'darwin' && existsSync(framework)) terminal = [format(realpathSync(framework))];
  }
  return { bootstrap, terminal };
}

export function reconcileExecIdentity(before, after, permitted) {
  if (!before || !after || before.pid !== after.pid || before.started !== after.started || before.pgid !== after.pgid || !permitted.bootstrap.includes(before.command) || !permitted.terminal.includes(after.command)) return undefined;
  return after;
}

export async function stableChildIdentity(child, permitted, { timeout = 5000, stableMs = 250, readIdentity = processIdentity, initial: pinned } = {}) {
  const until = Date.now() + timeout;
  let initial = pinned, previous, stableSince;
  while (Date.now() < until) {
    if (child.exitCode !== null || child.signalCode !== null || child.killed) throw Error('A launched service stopped during executable bootstrap.');
    const actual = readIdentity(child.pid);
    if (actual) {
      if (actual.pid !== child.pid || actual.pgid !== child.pid) throw Error('The launched service did not retain its owned process group.');
      if (!initial) initial = actual;
      if (initial.started !== actual.started || initial.pgid !== actual.pgid) throw Error('The launched service process identity changed during executable bootstrap.');
      if (!permitted.bootstrap.includes(actual.command) && !permitted.terminal.includes(actual.command)) throw Error('The launched service executable did not match its expected runtime.');
      if (permitted.terminal.includes(actual.command)) {
        if (!sameProcess(previous, actual)) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) return actual;
        previous = actual;
      } else { previous = undefined; stableSince = undefined; }
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('The launched service executable did not finish its expected bootstrap.');
}

/** Save a provisional owner before bootstrap can fail or a stop can begin. */
export async function captureChildIdentity(child, permitted, { onProvisional, timeout = 5000, stableMs = 250 } = {}) {
  const provisional = { pid: child.pid, pgid: child.pid, started: 'bootstrap-not-yet-observed', command: permitted.bootstrap[0], bootstrap: true };
  await onProvisional(provisional);
  const initial = await waitFor(() => processIdentity(child.pid), { timeout, label: 'Executable bootstrap', alive: () => child.exitCode === null && child.signalCode === null && !child.killed, interval: 50 });
  Object.assign(provisional, initial, {
    command: permitted.bootstrap.includes(initial.command) || permitted.terminal.includes(initial.command) ? initial.command : permitted.bootstrap[0],
  });
  await onProvisional(provisional);
  return stableChildIdentity(child, permitted, { initial, timeout, stableMs });
}

export function signalOwned(expected, signal = 'SIGTERM', group = true) {
  if (!sameProcess(expected)) return false;
  try { process.kill(group ? -expected.pid : expected.pid, signal); return true; } catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
}

function groupPids(pgid) {
  const table = execFileSync('/bin/ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return table.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    return match && Number(match[2]) === pgid ? [Number(match[1])] : [];
  });
}

function groupAnchor(group) {
  return group.members.find(expected => {
    const actual = processIdentity(expected.pid);
    return sameProcess(expected, actual) && actual.pgid === group.pgid;
  });
}

/** Admit new members only while a matching saved process proves this PGID. */
export function refreshOwnedGroup(group) {
  const pids = groupPids(group.pgid);
  if (!pids.length) return 'clean';
  if (!groupAnchor(group)) return 'unproven';
  const observed = pids.map(processIdentity).filter(member => member?.pgid === group.pgid);
  if (!groupAnchor(group)) return groupPids(group.pgid).length ? 'unproven' : 'clean';
  for (const member of observed) if (!group.members.some(expected => sameProcess(expected, member))) group.members.push(member);
  return 'owned';
}

export function signalOwnedGroup(group, signal) {
  if (refreshOwnedGroup(group) !== 'owned' || !groupAnchor(group)) return false;
  try { process.kill(-group.pgid, signal); return true; } catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
}

/** Retain descendant identity proof after its group leader exits on TERM. */
export async function stopOwnedGroups(records, { groups = [], grace = 5000, killWait = 3000, onUpdate = async () => {} } = {}) {
  const tracked = groups.map(group => ({ pgid: group.pgid, members: [...group.members] }));
  for (const record of records) {
    if (!Number.isInteger(record.pid) || record.pid < 1) continue;
    let group = tracked.find(item => item.pgid === record.pid);
    if (!group) { group = { pgid: record.pid, members: [] }; tracked.push(group); }
    if (!group.members.some(member => sameProcess(record, member))) group.members.push(record);
  }
  let lastSnapshot;
  async function inspect() {
    const remaining = tracked.filter(group => refreshOwnedGroup(group) !== 'clean');
    const snapshot = JSON.stringify(remaining);
    if (snapshot !== lastSnapshot) { await onUpdate(remaining); lastSnapshot = snapshot; }
    return remaining;
  }
  let remaining = await inspect();
  // Membership is saved before TERM, because group leaders can exit immediately.
  for (const group of [...remaining].reverse()) signalOwnedGroup(group, 'SIGTERM');
  async function poll(duration) {
    const until = Date.now() + duration;
    do {
      remaining = await inspect();
      if (!remaining.length) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < until);
  }
  await poll(grace);
  for (const group of remaining) signalOwnedGroup(group, 'SIGKILL');
  await poll(killWait);
  return { clean: remaining.length === 0, groups: remaining };
}

export async function waitFor(check, { timeout = 120000, label = 'service', alive = () => true, interval = 500 } = {}) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    if (!alive()) throw Error(`${label} stopped before it was ready. Check its private log under .sites-runtime/judges/.`);
    try { const value = await check(); if (value) return value; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw Error(`${label} was not ready within ${Math.round(timeout / 1000)} seconds.${last ? ' Check its private log under .sites-runtime/judges/.' : ''}`);
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw Error(`${path.basename(command)} failed. Resolve the error above before trying again.`);
  return result;
}

export function wranglerArgs(extra, persist = PERSIST) {
  return ['scripts/local-run.mjs', '--import', './scripts/sites-env.mjs', 'node_modules/wrangler/bin/wrangler.js', ...extra, '--config', 'dist/server/wrangler.json', '--local', '--persist-to', persist];
}

export function assertDependencies() {
  if (!existsSync(path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'))) throw Error('Run npm ci in this checkout before judges:setup.');
}

export function readManifest() {
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return undefined; throw Error('The judges run manifest is invalid; inspect .sites-runtime/judges/run.json before continuing.'); }
}
