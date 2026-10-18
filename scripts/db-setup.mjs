import './sites-env.mjs';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

export function setupDatabase(){
 const common=['scripts/local-run.mjs','--import','./scripts/sites-env.mjs','node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state'];
 const inspect=spawnSync(process.execPath,[...common,'--command',"SELECT name FROM sqlite_master WHERE type='table'",'--json'],{encoding:'utf8'});
 if(inspect.status!==0)throw Error(inspect.stderr||inspect.stdout||'Cannot inspect local database.');
 let result;try{result=JSON.parse(inspect.stdout);}catch{throw Error('Unable to read the local database schema.');}
 const tables=new Set(result.flatMap(r=>r.results||[]).map(r=>r.name));
 const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
 const tracked=spawnSync(process.execPath,[...common,'--command','CREATE TABLE IF NOT EXISTS app_schema_migrations(name TEXT PRIMARY KEY); SELECT name FROM app_schema_migrations','--json'],{encoding:'utf8'});
 if(tracked.status!==0)throw Error(tracked.stderr||'Cannot inspect migration history.');
 const appliedNames=new Set(JSON.parse(tracked.stdout).flatMap(r=>r.results||[]).map(r=>r.name));
 const steps=[];if(!tables.has('workspaces'))steps.push(journal.entries[0].tag);
 for(const entry of journal.entries.slice(1))if(!appliedNames.has(entry.tag))steps.push(entry.tag);
 for(const name of steps){console.log(`Applying local database migration: ${name}`);const applied=spawnSync(process.execPath,[...common,'--file',`drizzle/${name}.sql`],{stdio:'inherit'});if(applied.status!==0)throw Error(`Migration ${name} failed.`);const recorded=spawnSync(process.execPath,[...common,'--command',`INSERT OR IGNORE INTO app_schema_migrations(name) VALUES('${name}')`],{stdio:'ignore'});if(recorded.status!==0)throw Error('Could not record the local migration. It will be safely retried on next startup.');}
 console.log('Local database is ready.');
}
if(process.argv[1]?.endsWith('/db-setup.mjs'))setupDatabase();
