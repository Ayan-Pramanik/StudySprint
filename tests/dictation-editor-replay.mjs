// Replay synthetic QA messages through the actual editor reducer, so accuracy
// scores measure the words users receive rather than later backend revisions.
import { readFileSync } from 'node:fs';
import { acceptDictationTranscript, appendDictationText, emptyDictationTranscript } from '../lib/dictation.ts';

const events = JSON.parse(readFileSync(0, 'utf8'));
let state = emptyDictationTranscript(), text = '', previousLines = [];
const confirmations = [];
for (const { at, event } of events) {
    const update = acceptDictationTranscript(state, event);
    if (/[a-z0-9]/i.test(update.added)) {
        const index = event.lines.findIndex((line, index) => {
            const value = line?.speaker !== -2 && typeof line?.text === 'string' ? line.text.trim() : '';
            const before = state.lines[index] ?? '';
            return value.startsWith(before) && /[a-z0-9]/i.test(value.slice(before.length));
        });
        const prior = previousLines[index];
        const line = event.lines[index];
        confirmations.push({ at, spanStart: prior && state.lines[index] ? prior.end : line?.start });
    }
    text = appendDictationText(text, update.added);
    state = update.transcript;
    if (Array.isArray(event.lines)) previousLines = event.lines;
}
process.stdout.write(JSON.stringify({ text, confirmations }));
