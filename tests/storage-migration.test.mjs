import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {summarizeNote,linksForNote,validateNoteBody,MAX_NOTE_BYTES} from '../lib/study.ts';
test('migration preserves Unicode notes, stable bindings, full revisions and workspace learning data',()=>{
 const code=`import sqlite3,json,pathlib
c=sqlite3.connect(':memory:')
c.executescript(pathlib.Path('drizzle/0000_fearless_the_hand.sql').read_text())
note={'id':'n','subject':'s','title':'Résumé','body':'Current [[Other]] text','aliases':['Before'],'bindings':{'Other':'o'},'version':2,'updated':'2026-10-18T00:00:00.000Z','versions':[{'version':1,'body':'Original résumé','at':'2026-10-17T00:00:00.000Z'}]}
w={'subjects':[{'id':'s','name':'Biology'}],'notes':[note],'cards':[{'id':'card','schedule':{'due':'2026-10-20'}}],'events':[],'limit':17,'zone':'Australia/Sydney'}
c.execute('INSERT INTO workspaces(id,data,version) VALUES(?,?,?)',('guest',json.dumps(w),5))
c.execute('INSERT INTO review_events(id,workspace,data) VALUES(?,?,?)',('guest:event','guest',json.dumps({'id':'event','card':'card','rating':3})))
c.executescript(pathlib.Path('drizzle/0001_quick_shaman.sql').read_text())
c.executescript(pathlib.Path('drizzle/0002_goofy_tinkerer.sql').read_text())
c.executescript(pathlib.Path('drizzle/0003_same_nebula.sql').read_text())
# Startup may retry after schema creation but before its migration marker is saved.
c.executescript(pathlib.Path('drizzle/0001_quick_shaman.sql').read_text())
c.executescript(pathlib.Path('drizzle/0002_goofy_tinkerer.sql').read_text())
c.executescript(pathlib.Path('drizzle/0003_same_nebula.sql').read_text())
stored=c.execute('SELECT data,body FROM notes WHERE workspace=?',('guest',)).fetchone()
assert stored[1]==note['body'];metadata=json.loads(stored[0]);assert metadata['bindings']==note['bindings'];assert metadata['aliases']==note['aliases']
assert 'versions' not in metadata and 'body' not in metadata
assert c.execute('SELECT body FROM note_revisions').fetchone()[0]=='Original résumé'
data,version=c.execute('SELECT data,version FROM workspaces').fetchone();data=json.loads(data)
assert data['notes']==[] and data['cards']==w['cards'] and data['limit']==17 and version==5
assert c.execute('SELECT count(*) FROM review_events').fetchone()[0]==1
assert c.execute('SELECT count(*) FROM notes').fetchone()[0]==1
assert c.execute('SELECT count(*) FROM note_revisions').fetchone()[0]==1
print('migration data preserved')`;
 const result=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/preserved/);
});
test('workspace summaries carry stable graph inputs and previews without note or revision bodies',()=>{
 const n={id:'n',subject:'s',title:'One',body:'**Visible** [[Two]] `[[ignored]]`',aliases:[],version:2,updated:'',versions:[{version:1,body:'private old text',at:''}]};
 const summary=summarizeNote(n);assert.ok(!('body'in summary));assert.ok(!('body'in summary.versions[0]));assert.deepEqual(linksForNote(summary),['Two']);assert.match(summary.preview,/Visible/);
});
test('long-note limit is UTF-8 bytes and never silently truncates a multibyte note',()=>{
 const accepted='a'.repeat(MAX_NOTE_BYTES);assert.equal(validateNoteBody(accepted),accepted);assert.throws(()=>validateNoteBody(accepted+'a'),/1 MiB/);assert.throws(()=>validateNoteBody('😀'.repeat(MAX_NOTE_BYTES/4+1)),/1 MiB/);
});

test('remote account and local document migration histories converge without losing either data set',()=>{
 const code=`import sqlite3,json,pathlib
for order in ('accounts-first','documents-first'):
 c=sqlite3.connect(':memory:')
 run=lambda name:c.executescript(pathlib.Path('drizzle/'+name+'.sql').read_text())
 run('0000_fearless_the_hand')
 if order=='accounts-first':run('0001_accounts')
 c.execute('INSERT INTO workspaces(id,data,version) VALUES(?,?,?)',('workspace',json.dumps({'notes':[{'id':'n','title':'Existing','body':'Original text','subject':'','aliases':[],'version':1,'updated':'2026-10-18T00:00:00.000Z','tags':['exam']}],'subjects':[],'cards':[],'events':[],'quizzes':[{'id':'quiz'}],'quizAttempts':[{'id':'attempt','quiz':'quiz'}],'limit':10,'zone':'UTC'}),7))
 for name in ('0001_quick_shaman','0002_goofy_tinkerer','0003_same_nebula','0004_accounts'):run(name)
 c.execute('INSERT INTO users(id,email,name,password,workspace,created) VALUES(?,?,?,?,?,?)',('u','student@example.com','Student','hash','workspace',1))
 c.execute('INSERT INTO sessions(id,user,expires) VALUES(?,?,?)',('session','u',9999999999999))
 run('0004_accounts')
 assert c.execute('SELECT body FROM notes').fetchone()[0]=='Original text'
 assert json.loads(c.execute('SELECT data FROM notes').fetchone()[0])['tags']==['exam']
 data,version=c.execute('SELECT data,version FROM workspaces').fetchone();assert version==7
 assert json.loads(data)['quizzes'][0]['id']=='quiz';assert json.loads(data)['quizAttempts'][0]['quiz']=='quiz'
 assert c.execute('SELECT workspace FROM sessions JOIN users ON users.id=sessions.user').fetchone()[0]=='workspace'
 print(order+' preserved')`;
 const result=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/accounts-first preserved/);assert.match(result.stdout,/documents-first preserved/);
});
