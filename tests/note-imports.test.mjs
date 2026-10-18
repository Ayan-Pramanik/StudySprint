import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// This is an opt-in live suite. It creates fresh guest workspaces only.
// Run after starting the local app, queue consumer, converter and migrated DB:
// node scripts/local-run.mjs tests/note-imports.test.mjs
const base = (process.env.TEST_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const origin = new URL(base).origin;
const timeout = Number(process.env.TEST_IMPORT_TIMEOUT || 240000);
const fixtures = process.env.TEST_FIXTURE_DIR || await mkdtemp(join(tmpdir(), 'studysprint-document-fixtures-'));
const generated = !process.env.TEST_FIXTURE_DIR;
const fixturePath = name => join(fixtures, name);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const normalized = text => text.replace(/[|]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
const mediaTypes = {pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',md:'text/markdown',txt:'text/plain'};

async function request(guest, path, options = {}) {
    const headers = new Headers(options.headers);
    if (guest) headers.set('Cookie', guest.cookie);
    if (options.method && options.method !== 'GET') headers.set('Origin', origin);
    return fetch(base + path, {...options, headers, signal: options.signal || AbortSignal.timeout(30000)});
}
async function json(response, expected = 200) {
    const value = await response.json();
    assert.equal(response.status, expected, JSON.stringify(value));
    return value;
}
async function guest() {
    const response = await request(null, '/api/workspace');
    const value = await json(response);
    assert.ok(response.headers.get('set-cookie'), 'The guest workspace must set its own cookie');
    assert.equal(value.workspace.notes.length, 0, 'Tests must start in a new, isolated guest workspace');
    assert.equal(value.uploads, true, 'Configure the app, object bucket, queue and converter before running live imports');
    return {cookie: response.headers.get('set-cookie').split(';')[0]};
}
async function snapshot(guest) {
    const value = await json(await request(guest, '/api/workspace'));
    for (const note of value.workspace.notes) {
        assert.equal(Object.hasOwn(note, 'body'), false, 'Workspace snapshots must omit note bodies');
        for (const revision of note.versions || []) assert.equal(Object.hasOwn(revision, 'body'), false, 'Snapshots must omit revision bodies');
    }
    return value.workspace;
}
async function detail(guest, id) {
    return (await json(await request(guest, `/api/notes/${id}`))).note;
}
async function postWorkspace(guest, action, parameters, expected = 200) {
    return json(await request(guest, '/api/workspace', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action, ...parameters})}), expected);
}
async function uploadBytes(guest, name, bytes, parameters = {}, expected = 202) {
    const form = new FormData();
    form.append('file', new Blob([bytes], {type:mediaTypes[name.split('.').pop()] || 'application/octet-stream'}), name);
    for (const [key, value] of Object.entries(parameters)) form.set(key, value);
    const value = await json(await request(guest, '/api/note-imports', {method:'POST', body:form}), expected);
    return value.job;
}
async function uploadFixture(guest, name, parameters = {}) {
    return uploadBytes(guest, name, await readFile(fixturePath(name)), parameters);
}
async function getJob(guest, id) {
    // Closing each connection exercises persisted state across page/connection changes.
    return (await json(await request(guest, `/api/note-imports/${id}`, {headers:{Connection:'close'}}))).job;
}
async function poll(guest, id, accepted = ['ready', 'failed', 'cancelled']) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
        last = await getJob(guest, id);
        if (accepted.includes(last.status)) return last;
        await wait(150);
    }
    throw Error(`Import ${id} timed out: ${JSON.stringify(last)}`);
}
async function ready(guest, initial) {
    const job = await poll(guest, initial.id);
    assert.equal(job.status, 'ready', JSON.stringify(job));
    assert.ok(job.noteId, 'A completed import must identify its note');
    return detail(guest, job.noteId);
}
async function source(guest, id, suffix = '', headers = {}) {
    return request(guest, `/api/notes/${id}/source${suffix}`, {headers});
}

let owner;
try {
    if (generated) {
        const python = fileURLToPath(new URL('../converter/.venv/bin/python', import.meta.url));
        const script = fileURLToPath(new URL('../scripts/make-document-fixtures.py', import.meta.url));
        execFileSync(python, [script, fixtures], {stdio:'pipe'});
    }
    owner = await guest();
    const outsider = await guest();
    const cases = [
        {name:'digital.pdf', expected:['digital memory lecture', 'retrieval practice strengthens memory.']},
        {name:'scanned.pdf', expected:['scanned study material', 'spaced repetition improves retention.'], ocr:true},
        {name:'mixed.pdf', expected:['digital memory lecture', 'retrieval practice strengthens memory.', 'scanned study material', 'spaced repetition improves retention.'], ocr:true},
        {name:'lecture.docx', expected:['memory and learning', 'retrieval practice improves retention.'], derived:true},
        {name:'slides.pptx', expected:['retrieval practice', 'spaced repetition improves retention.'], derived:true},
        {name:'note.md', derived:true, expected:['markdown memory lecture', 'tags: [memory, testing]', 'retrieval practice improves retention.']},
        {name:'note.txt', derived:true, expected:['plain text memory lecture', 'retrieval practice improves retention.', 'café and déjà vu.']},
    ];
    const imported = [];
    let subject;
    for (const fixture of cases) {
        const title = `Synthetic import ${fixture.name}`;
        const parameters = {title, requestId:crypto.randomUUID(), ...(subject ? {subject} : {newSubject:'Synthetic document import tests'})};
        // Duplicate concurrent requests must publish only one note, even while queued.
        const initial = fixture.name === 'digital.pdf'
            ? (await Promise.all([uploadFixture(owner, fixture.name, parameters), uploadFixture(owner, fixture.name, parameters)])).map(job => {assert.equal(job.id, parameters.requestId); return job;})[0]
            : await uploadFixture(owner, fixture.name, parameters);
        const note = await ready(owner, initial);
        assert.equal(note.title, title);
        assert.equal(typeof note.body, 'string');
        for (const passage of fixture.expected) assert.ok(normalized(note.body).includes(normalized(passage)), `${fixture.name}: missing expected source passage ${passage}`);
        assert.ok(note.source, `${fixture.name}: missing source metadata`);
        assert.equal(note.source.name, fixture.name);
        assert.equal(note.source.derivedPreview, !!fixture.derived);
        if (fixture.ocr) assert.equal(note.source.ocr, true);
        const original = await readFile(fixturePath(fixture.name));
        const response = await source(owner, note.id);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), original, `${fixture.name}: original bytes changed`);
        assert.equal(note.source.size, original.length);
        if (fixture.derived) {
            const preview = await source(owner, note.id, '?preview=1');
            assert.equal(preview.status, 200);
            assert.match(preview.headers.get('content-type'), /^application\/pdf/);
            assert.equal(Buffer.from(await preview.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
        }
        if (fixture.name === 'note.txt') assert.equal(note.body, original.toString('utf8'), 'Plain text imports must preserve UTF-8 text and line endings');
        subject ||= note.subject;
        assert.equal(note.subject, subject);
        imported.push(note);
        const current = await snapshot(owner);
        assert.equal(current.notes.length, imported.length, 'Retries must not duplicate notes');
        assert.equal(current.subjects.filter(value => value.name === 'Synthetic document import tests').length, 1);
    }
    console.log('PASS: all seven synthetic documents import, real OCR reads scans and mixed pages, Office previews render, originals survive byte-for-byte, jobs survive new connections');

    const first = imported[0];
    assert.equal((await source(outsider, first.id)).status, 404);
    assert.equal((await request(outsider, `/api/notes/${first.id}`)).status, 404);
    assert.equal((await request(outsider, `/api/note-imports/${first.source.id}`)).status, 404);
    const original = await readFile(fixturePath('digital.pdf'));
    const range = await source(owner, first.id, '', {Range:'bytes=0-15'});
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), `bytes 0-15/${original.length}`);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), original.subarray(0, 16));
    const suffix = await source(owner, first.id, '', {Range:'bytes=-12'});
    assert.equal(suffix.status, 206);
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), original.subarray(-12));
    const invalidRange = await source(owner, first.id, '', {Range:`bytes=${original.length}-`});
    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers.get('content-range'), `bytes */${original.length}`);
    const download = await source(owner, first.id, '?download=1');
    assert.equal(download.status, 410);
    await download.arrayBuffer();
    console.log('PASS: original access is workspace-owned, legacy original download is removed, byte/suffix ranges return206, invalid ranges return416');

    const editedBody = first.body + '\n\nStudent revision: review this concept tomorrow.\n';
    await postWorkspace(owner, 'note', {id:first.id, title:first.title, subject:first.subject, body:editedBody, expectedUpdated:first.updated});
    const edited = await detail(owner, first.id);
    assert.equal(edited.body, editedBody);
    assert.equal(edited.version, first.version + 1);
    assert.ok(edited.versions?.length, 'Lazy note details should expose revision metadata');
    for (const revision of edited.versions) assert.equal(Object.hasOwn(revision, 'body'), false);
    assert.deepEqual(Buffer.from(await (await source(owner, first.id)).arrayBuffer()), original, 'Editing Markdown must never replace the original');
    await snapshot(owner);
    console.log('PASS: note edits create a revision while retaining the unchanged original and compact snapshots');

    const longText = 'A long source passage supports careful study and revision.\n'.repeat(2600);
    assert.ok(Buffer.byteLength(longText) > 100000);
    const longNote = await ready(owner, await uploadBytes(owner, 'long-source.txt', Buffer.from(longText), {title:'Synthetic long note', subject}));
    assert.equal(longNote.body, longText, 'Imports must no longer truncate or reject text above100k');
    const longEdit = longText + '\nA saved student edit.\n';
    await postWorkspace(owner, 'note', {id:longNote.id, title:longNote.title, subject, body:longEdit, expectedUpdated:longNote.updated});
    assert.equal((await detail(owner, longNote.id)).body, longEdit);
    const oversized = 'é'.repeat(524289); // Characters fit, UTF-8 bytes exceed1MiB.
    await postWorkspace(owner, 'note', {id:longNote.id, title:longNote.title, subject, body:oversized}, 400);
    assert.equal((await detail(owner, longNote.id)).body, longEdit, 'Rejected text must not overwrite the saved note');
    const beforeOversize = (await snapshot(owner)).notes.length;
    const tooLargeJob = await uploadBytes(owner, 'too-large.txt', Buffer.from(oversized), {title:'Synthetic over-limit import', subject});
    assert.equal((await poll(owner, tooLargeJob.id)).status, 'failed');
    assert.equal((await snapshot(owner)).notes.length, beforeOversize);
    await uploadBytes(owner, 'above-upload-limit.txt', Buffer.alloc(10 * 1024 * 1024 + 1, 65), {title:'Synthetic upload limit'}, 413);
    assert.ok(Buffer.byteLength(JSON.stringify(await snapshot(owner))) < 100000, 'Snapshot size must stay independent of large note bodies');
    console.log('PASS: text above100k imports and saves, the1MiB limit counts UTF-8 bytes, oversized files fail, snapshots omit large bodies');

    const beforeInvalid = (await snapshot(owner)).notes.length;
    const invalid = await uploadBytes(owner, 'corrupt.docx', Buffer.from([0x50,0x4b,3,4,0,0,0,0,1,2,3]), {title:'Synthetic corrupt document', subject});
    const failed = await poll(owner, invalid.id);
    assert.equal(failed.status, 'failed');
    assert.ok(failed.error, 'Invalid document failures should explain what the student can do');
    assert.equal((await snapshot(owner)).notes.length, beforeInvalid, 'A failed import must not create an empty note');
    const invalidText = await uploadBytes(owner, 'invalid-utf8.txt', Buffer.from([0xff,0xfe,0,1]), {title:'Synthetic invalid text', subject});
    assert.equal((await poll(owner, invalidText.id)).status, 'failed');
    assert.equal((await snapshot(owner)).notes.length, beforeInvalid);
    console.log('PASS: corrupt Office and invalid UTF-8 uploads fail without publishing notes');

    const cancelOwner = await guest();
    const cancellable = await uploadFixture(cancelOwner, 'slow-scanned.pdf', {title:'Synthetic cancelled OCR'});
    const running = await poll(cancelOwner, cancellable.id, ['processing','ready','failed']);
    if (running.status === 'ready') {
        console.log('SKIP: cancellation race; the slow OCR fixture completed before cancellation could be observed');
    } else {
        assert.equal(running.status, 'processing', JSON.stringify(running));
        const cancellation = await request(cancelOwner, `/api/note-imports/${cancellable.id}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'cancel'})});
        if (cancellation.status === 409 && (await getJob(cancelOwner, cancellable.id)).status === 'ready') {
            console.log('SKIP: cancellation race; the import completed between processing observation and cancel');
        } else {
            assert.equal((await json(cancellation)).job.status, 'cancelled');
            // A subsequent converted PDF can only finish once the single-flight
            // converter has finished/cancelled the previous native conversion.
            await ready(cancelOwner, await uploadFixture(cancelOwner, 'digital.pdf', {title:'Synthetic post-cancel probe'}));
            assert.equal((await getJob(cancelOwner, cancellable.id)).status, 'cancelled');
            assert.equal((await snapshot(cancelOwner)).notes.some(note => note.id === cancellable.id || note.title === 'Synthetic cancelled OCR'), false);
            console.log('PASS: cancellation remains durable and native work cannot publish a cancelled note');
        }
    }
    for (const note of (await snapshot(cancelOwner)).notes) await postWorkspace(cancelOwner, 'deleteNote', {id:note.id});

    await postWorkspace(owner, 'deleteNote', {id:first.id});
    assert.equal((await source(owner, first.id)).status, 404);
    assert.equal((await source(owner, first.id, '?preview=1')).status, 404);
    assert.equal((await request(owner, `/api/notes/${first.id}`)).status, 404);
    assert.equal((await snapshot(owner)).notes.length, imported.length, 'Deleting one source note must retain every unrelated note, including the long note');
    const office = imported.find(note => note.source.derivedPreview);
    await postWorkspace(owner, 'deleteNote', {id:office.id});
    assert.equal((await source(owner, office.id)).status, 404);
    assert.equal((await source(owner, office.id, '?preview=1')).status, 404);
    assert.equal((await snapshot(owner)).notes.length, imported.length - 1);
    console.log('PASS: deletion revokes original and derived preview access without deleting unrelated notes');
    for (const note of (await snapshot(owner)).notes) await postWorkspace(owner, 'deleteNote', {id:note.id});
    for (const failedJob of [tooLargeJob, invalid, invalidText]) {
        await json(await request(owner, `/api/note-imports/${failedJob.id}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'cancel'})}));
    }
    console.log('PASS: live document import suite completed in isolated guest workspaces');
} finally {
    if (generated) await rm(fixtures, {recursive:true, force:true});
}
