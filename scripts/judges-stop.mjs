import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, RUNTIME, MANIFEST, readManifest, sameProcess, signalOwned, stopOwnedGroups, writePrivate } from './judges-common.mjs';

if (process.argv.includes('--help')) {
  console.log('Usage: npm run judges:stop\nStops only the recorded judging launcher and its owned processes for this checkout. Preserves notes, models and private settings.');
  process.exit(0);
}

try {
  let state = readManifest();
  if (!state) {
    const lockPath = path.join(RUNTIME, 'run.lock');
    try {
      const owner = JSON.parse(await readFile(lockPath, 'utf8'));
      if (sameProcess(owner)) throw Error('A live launcher owns the startup lock; wait for it to finish starting before stopping it.');
      await rm(lockPath);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    console.log('No judging run is recorded for this checkout.');
  } else {
    if (state.root !== ROOT || !Array.isArray(state.children)) throw Error('The run manifest does not belong to this checkout. No processes were stopped.');
    if (sameProcess(state.owner)) {
      signalOwned(state.owner, 'SIGTERM', false);
      const until = Date.now() + 12000;
      while (Date.now() < until && sameProcess(state.owner)) await new Promise(resolve => setTimeout(resolve, 100));
      if (sameProcess(state.owner)) throw Error('The launcher is still shutting down. Wait for its current build/check to finish, then retry judges:stop.');
    }
    // A terminal may have disappeared without letting the foreground launcher clean up.
    const updated = readManifest();
    if (!updated) {
      console.log('Judging processes stopped. Notes remain in .wrangler/judges-state.');
      process.exit(0);
    }
    if (updated && sameProcess(state.owner, updated.owner)) state = updated;
    else if (updated) throw Error('A different judging run now owns this checkout. Its processes were left untouched.');
    const result = await stopOwnedGroups(state.children, { groups: state.groups, onUpdate: async groups => { state.groups = groups; await writePrivate(MANIFEST, JSON.stringify(state, null, 2) + '\n'); } });
    if (!result.clean) throw Error('Some recorded group members could not be proved stopped. Their ownership manifest and lock were preserved; no unproven group was signalled.');
    const latest = readManifest();
    if (!latest || sameProcess(state.owner, latest.owner)) {
      await rm(MANIFEST, { force: true });
      const lockPath = path.join(RUNTIME, 'run.lock');
      try {
        const owner = JSON.parse(await readFile(lockPath, 'utf8'));
        if (sameProcess(state.owner, owner)) await rm(lockPath);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    console.log('Judging processes stopped. Notes remain in .wrangler/judges-state.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
