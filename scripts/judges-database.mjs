import { spawnSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, RUNTIME, PERSIST, run, wranglerArgs } from './judges-common.mjs';

export function migrationNeeded(tables) {
  const names = new Set(tables.map(table => table.name));
  if (!names.has('workspaces') && !names.has('review_events')) return true;
  if (names.has('workspaces') && names.has('review_events')) return false;
  throw Error('The local judging database has a partial schema. Its files were preserved; inspect or restore a backup before continuing.');
}

export async function prepareDatabase() {
  const command = "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('workspaces','review_events')";
  const result = spawnSync(process.execPath, wranglerArgs(['d1', 'execute', 'DB', '--json', '--command', command]), { cwd: ROOT, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw Error('Unable to inspect the judging database. No migration was applied.');
  let rows;
  try { rows = JSON.parse(result.stdout).flatMap(item => item.results ?? []); } catch { throw Error('Unexpected database inspection response. No migration was applied.'); }
  if (!migrationNeeded(rows)) return;
  const backup = path.join(RUNTIME, 'backups', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
  // Wrangler has closed the SQLite connection before its persisted state is copied.
  await cp(PERSIST, backup, { recursive: true, errorOnExist: true, force: false });
  console.log(`Applying the initial schema; a copy of the local state is in ${path.relative(ROOT, backup)}.`);
  run(process.execPath, wranglerArgs(['d1', 'execute', 'DB', '--file', 'drizzle/0000_fearless_the_hand.sql']));
}
