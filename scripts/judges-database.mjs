import { setupDatabase } from './db-setup.mjs';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, RUNTIME, PERSIST } from './judges-common.mjs';

export function migrationNeeded(tables) {
  const names = new Set(tables.map(table => table.name));
  if (!names.has('workspaces') && !names.has('review_events')) return true;
  if (names.has('workspaces') && names.has('review_events')) return false;
  throw Error('The local judging database has a partial schema. Its files were preserved; inspect or restore a backup before continuing.');
}

export async function prepareDatabase() {
  const backup = path.join(RUNTIME, 'backups', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
  // Wrangler has closed the SQLite connection before its persisted state is copied.
  await cp(PERSIST, backup, { recursive: true, errorOnExist: true, force: false });
  console.log(`Checking schema migrations; a copy of the local state is in ${path.relative(ROOT, backup)}.`);
  setupDatabase({persistTo:PERSIST});
}
