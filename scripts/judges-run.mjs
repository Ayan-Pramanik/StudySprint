import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, RUNTIME, CONFIG, MANIFEST, SPEECH_PORT, NGROK_AGENT_PORT, assertDependencies, assertPortFree, captureChildIdentity, executable, launchBarrier, processCommands, processIdentity, python311, readConfig, readManifest, run, sameProcess, stopOwnedGroups, waitFor, workerVariables, wranglerArgs, writePrivate } from './judges-common.mjs';
import { prepareDatabase } from './judges-database.mjs';
import { workspaceReady } from './judges-readiness.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npm run judges:start [-- --local-only]\nBuilds and starts this checkout on port 8789 by default. --local-only warms the model and runs local checks without starting an internet tunnel. Ctrl+C or judges:stop ends only this launcher’s processes.');
  process.exit(0);
}

const LOCK = path.join(RUNTIME, 'run.lock');
const children = [];
const launches = launchBarrier();
let owner, lock, stopping = false, finished = false, rejectRun;
let stopRequested = false;
const interrupted = new Promise(resolve => {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { stopRequested = true; resolve('stop'); });
});
const failure = new Promise((_, reject) => { rejectRun = reject; });
// A child may fail while startup is still in a synchronous build/database command.
failure.catch(() => {});
const config = await readConfig({}, { localOnly: args.includes('--local-only') }).catch(error => { console.error(error.message); process.exit(1); });
const state = { version: 1, root: ROOT, publicUrl: config.origin, port: config.port, children };
const saveManifest = () => writePrivate(MANIFEST, JSON.stringify(state, null, 2) + '\n');

async function takeLock() {
  await mkdir(RUNTIME, { recursive: true, mode: 0o700 });
  try { lock = await open(LOCK, 'wx', 0o600); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let previous;
    try { previous = JSON.parse(await readFile(LOCK, 'utf8')); } catch { throw Error('A judging lock exists without readable ownership. Inspect .sites-runtime/judges/run.lock before removing it.'); }
    if (sameProcess(previous) || readManifest()?.children?.some(child => sameProcess(child))) throw Error('This checkout already has a judging run. Use judges:stop before restarting it.');
    throw Error('A stale judging lock was preserved. Run judges:stop to release it before starting again.');
  }
  owner = processIdentity(process.pid);
  if (!owner) throw Error('Unable to establish launcher process ownership.');
  await lock.writeFile(JSON.stringify(owner));
  state.owner = owner;
  await saveManifest();
}

const launch = (...values) => launches.start(() => launchOwned(...values));
async function launchOwned(kind, command, commandArgs, extraEnv = {}) {
  if (stopping || stopRequested) throw Error('Startup cancelled.');
  const permitted = processCommands(command, commandArgs, { python: kind === 'speech' });
  const logfile = path.join(RUNTIME, `${kind}.log`);
  const output = openSync(logfile, 'w', 0o600);
  const child = spawn(command, commandArgs, { cwd: ROOT, detached: true, env: { ...process.env, ...extraEnv }, stdio: ['ignore', output, output] });
  closeSync(output);
  child.on('error', () => rejectRun?.(Error(`${kind} could not start. Check .sites-runtime/judges/${kind}.log.`)));
  child.on('exit', () => {
    if (!stopping) rejectRun?.(Error(`${kind} stopped. Check .sites-runtime/judges/${kind}.log.`));
  });
  let record;
  const identity = await captureChildIdentity(child, permitted, { onProvisional: async provisional => {
    if (!record) { record = { ...provisional, kind }; children.push(record); }
    else Object.assign(record, provisional);
    await saveManifest();
  } });
  Object.assign(record, identity);
  delete record.bootstrap;
  await saveManifest();
  if (stopping || stopRequested) throw Error('Startup cancelled.');
  return record;
}

async function stop() {
  if (stopping) return;
  stopping = true;
  await launches.close();
  if (!lock) return;
  const result = await stopOwnedGroups(children, { groups: state.groups, onUpdate: async groups => { state.groups = groups; await saveManifest(); } });
  if (result.clean && owner && sameProcess(readManifest()?.owner, owner)) await rm(MANIFEST, { force: true });
  await lock.close();
  if (result.clean) await rm(LOCK, { force: true });
  else {
    console.error('Some recorded process group members could not be proved stopped. Ownership records and the startup lock were preserved; retry judges:stop.');
    process.exitCode = 1;
  }
  finished = result.clean;
}

try {
  if (args.some(arg => arg !== '--local-only')) throw Error('Unknown launcher option. Use --help.');
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('The speech launcher requires a native Apple Silicon Mac.');
  assertDependencies();
  python311();
  const venv = path.join(ROOT, 'speech/.venv/bin/python');
  if (!existsSync(venv)) throw Error(`Run judges:setup first. Config is kept in ${path.relative(ROOT, CONFIG)}.`);
  const ngrok = executable('ngrok');
  if (!args.includes('--local-only') && !ngrok) throw Error('ngrok is missing. Run judges:setup with --install-prerequisites, or install it yourself.');
  await takeLock();
  for (const port of [config.port, SPEECH_PORT, ...(args.includes('--local-only') ? [] : [NGROK_AGENT_PORT])]) await assertPortFree(port);
  console.log('Building this checkout for the judging session…');
  run(process.execPath, ['scripts/local-run.mjs', 'scripts/run-framework.mjs', 'build']);
  if (stopRequested) throw Error('Startup cancelled.');
  await writePrivate(path.join(ROOT, 'dist/server/.dev.vars'), workerVariables(config, args.includes('--local-only')));
  await prepareDatabase();
  if (stopRequested) throw Error('Startup cancelled.');
  // Keep the Mac awake only while this launcher exists; closing the lid can still suspend it.
  await launch('awake', '/usr/bin/caffeinate', ['-i', '-w', String(process.pid)]);
  const startup = (async () => {
    console.log('Loading the local speech model. The first start downloads its model and VAD caches; this can take several minutes…');
    const speech = await launch('speech', venv, ['-m', 'speech.app'], {
      SPEECH_SERVICE_SECRET: config.secret,
      HF_HOME: path.join(ROOT, '.sites-runtime/speech-models'),
      TORCH_HOME: path.join(ROOT, '.sites-runtime/torch'),
      XDG_CACHE_HOME: path.join(ROOT, '.sites-runtime/cache'),
      NUMBA_CACHE_DIR: path.join(ROOT, '.sites-runtime/numba'),
    });
    await waitFor(async () => {
      const response = await fetch(config.speechUrl + '/health', { headers: { Authorization: `Bearer ${config.secret}` }, signal: AbortSignal.timeout(3000) });
      return response.ok && (await response.json()).available === true;
    }, { label: 'Speech model', timeout: 15 * 60000, alive: () => sameProcess(speech), interval: 1000 });
    const app = await launch('app', process.execPath, wranglerArgs(['dev', '--ip', '127.0.0.1', '--port', String(config.port), '--inspector-port', '0']), { WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' });
    await waitFor(() => workspaceReady(`http://127.0.0.1:${config.port}`, { browserOrigin: args.includes('--local-only') ? undefined : config.origin }), { label: 'StudySprint', timeout: 90000, alive: () => sameProcess(app) });
    if (args.includes('--local-only')) {
      console.log(`Local readiness passed: http://127.0.0.1:${config.port}\nNo public tunnel was started. Keep this terminal open. Ctrl+C or npm run judges:stop ends the session.`);
      return;
    }
    const tunnel = await launch('ngrok', ngrok, ['http', `http://127.0.0.1:${config.port}`, '--url', config.origin, '--inspect=false', '--log', 'stdout', '--log-format', 'json']);
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${NGROK_AGENT_PORT}/api/tunnels`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return false;
      const tunnels = (await response.json()).tunnels;
      return Array.isArray(tunnels) && tunnels.some(item => item.public_url === config.origin && item.config?.addr === `http://127.0.0.1:${config.port}` && item.config?.inspect === false);
    }, { label: 'ngrok assigned URL', timeout: 45000, alive: () => sameProcess(tunnel) });
    await waitFor(() => workspaceReady(config.origin, { publicCheck: true }), { label: 'Public HTTPS app', timeout: 45000, alive: () => sameProcess(tunnel) });
    console.log(`Ready to share: ${config.origin}\nThe app and local speech model passed readiness checks. Keep this Mac awake, online and this terminal open.\nOnly one person can dictate at a time. Ctrl+C or npm run judges:stop ends this session.`);
  })();
  await Promise.race([failure, (async () => { await startup; await interrupted; })(), interrupted]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await stop();
  if (finished) console.log('Judging processes stopped. Notes remain in .wrangler/judges-state.');
}
