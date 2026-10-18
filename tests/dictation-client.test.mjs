import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { PCM16Resampler } from '../public/dictation-audio-worklet.js';
import { acceptDictationTranscript, appendDictationText, emptyDictationTranscript } from '../lib/dictation.ts';

test('44.1 kHz and 48 kHz audio become exactly 16,000 samples per second', () => {
    for (const rate of [44100, 48000]) {
        const source = Float32Array.from({ length: rate }, (_, index) => Math.sin(2 * Math.PI * 1000 * index / rate) * 0.5);
        const whole = new PCM16Resampler(rate);
        const expected = [...whole.push(source), ...whole.flush()];
        const streamed = new PCM16Resampler(rate);
        const actual = [];
        for (let index = 0; index < source.length; index += 128) actual.push(...streamed.push(source.subarray(index, index + 128)));
        actual.push(...streamed.flush());
        assert.equal(actual.length, 16000);
        assert.deepEqual(actual, expected, 'worklet block boundaries cannot change audio');
        assert.ok(Math.abs(actual[4] - 16000) < 1000, 'the 1 kHz tone preserves amplitude and timing');
    }
});

test('PCM has correct silence, clipping, weighted samples and one-time final flush', () => {
    const pcm = new PCM16Resampler(48000);
    assert.deepEqual([...pcm.push(Float32Array.from([0, 0, 0, 1, 1, 1, -2, -2, -2, 0, 0.5, 1]))], [0, 32767, -32768, 16384]);
    assert.equal(pcm.flush().length, 0);
    const tail = new PCM16Resampler(44100);
    tail.push(new Float32Array([0.5]));
    assert.deepEqual([...tail.flush()], [16384]);
    assert.equal(tail.flush().length, 0);
});

test('real worklet downmixes stereo, sends 0.5-second little-endian frames and flushes before acknowledgement', async () => {
    const source = await readFile(new URL('../public/dictation-audio-worklet.js', import.meta.url), 'utf8');
    let Processor;
    const sandbox = {
        sampleRate: 48000,
        AudioWorkletProcessor: class {
            constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; }
        },
        registerProcessor: (name, constructor) => { assert.equal(name, 'dictation-audio'); Processor = constructor; },
    };
    vm.runInNewContext(source.replace('export class PCM16Resampler', 'class PCM16Resampler'), sandbox);
    const processor = new Processor();
    for (let index = 0; index < 24000; index += 128) {
        const count = Math.min(128, 24000 - index);
        processor.process([[new Float32Array(count).fill(0.5), new Float32Array(count)]]);
    }
    const levels = processor.messages.filter(message => message.type === 'level');
    assert.equal(levels.length, 4, 'microphone activity appears before the first audio frame');
    assert.ok(levels.every(message => message.value === 1), 'the measured level is bounded');
    let messages = processor.messages.filter(message => message.type !== 'level');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].buffer.byteLength, 16000);
    const frame = new DataView(messages[0].buffer);
    assert.equal(frame.getInt16(0, true), 8192);
    assert.equal(frame.getUint8(0), 0);
    assert.equal(frame.getUint8(1), 32);
    processor.process([[new Float32Array(7).fill(0.5)]]);
    processor.port.onmessage({ data: { type: 'flush' } });
    messages = processor.messages.filter(message => message.type !== 'level');
    assert.equal(messages[1].type, 'audio');
    assert.equal(messages[1].buffer.byteLength, 6, 'two full samples and one final partial sample');
    assert.equal(messages[2].type, 'flushed');
    const stoppedCount = processor.messages.length;
    processor.port.onmessage({ data: { type: 'flush' } });
    processor.process([[new Float32Array(48000).fill(1)]]);
    assert.equal(processor.messages.length, stoppedCount, 'stopped capture cannot emit audio, levels or flush twice');
    const silent = new Processor();
    silent.process([[new Float32Array(4800)]]);
    assert.equal(silent.messages[0].type, 'level');
    assert.equal(silent.messages[0].value, 0, 'silence does not simulate microphone activity');
    const quiet = new Processor();
    quiet.process([[new Float32Array(4800).fill(0.02)]]);
    assert.ok(Math.abs(quiet.messages[0].value - 0.1) < 0.001, 'the meter follows actual sound amplitude');
});

test('live draft corrections never enter the saved body and confirmation preserves typing', () => {
    let state = emptyDictationTranscript();
    let body = 'Typed first.';
    const receive = message => {
        const update = acceptDictationTranscript(state, message);
        state = update.transcript;
        body = appendDictationText(body, update.added);
        return appendDictationText(body, state.provisional);
    };
    assert.equal(receive({ lines: [], buffer_transcription: 'Today I had a bulletin' }), 'Typed first. Today I had a bulletin');
    assert.equal(body, 'Typed first.');
    body += ' My edit.';
    assert.equal(receive({ lines: [], buffer_transcription: 'Today I had a Red Bull drink.' }), 'Typed first. My edit. Today I had a Red Bull drink.');
    assert.equal(body, 'Typed first. My edit.');
    assert.equal(receive({ lines: [{ text: 'Today I had a Red Bull drink.' }], buffer_transcription: 'I still feel sleepy.' }), 'Typed first. My edit. Today I had a Red Bull drink. I still feel sleepy.');
    assert.equal(body, 'Typed first. My edit. Today I had a Red Bull drink.');
    state = emptyDictationTranscript(); // cancellation discards only the draft
    assert.equal(appendDictationText(body, state.provisional), body);
});

test('cumulative lines and repeated final messages append confirmed text only once', () => {
    let transcript = emptyDictationTranscript(), body = 'Typed first.';
    const receive = message => {
        const next = acceptDictationTranscript(transcript, message);
        transcript = next.transcript;
        body = appendDictationText(body, next.added);
    };
    receive({ lines: [{ text: 'Hello', speaker: 1 }], buffer_transcription: 'wonder' });
    assert.equal(body, 'Typed first. Hello');
    assert.equal(transcript.provisional, 'wonder');
    body += ' I am typing.';
    receive({ lines: [{ text: 'Hello world.', speaker: 1 }, { text: '', speaker: -2 }], buffer_transcription: 'Another' });
    assert.equal(body, 'Typed first. Hello I am typing. world.');
    receive({ lines: [{ text: 'Hello world.', speaker: 1 }, { text: '', speaker: -2 }, { text: 'Another sentence.', speaker: 1 }], buffer_transcription: '' });
    receive({ lines: [{ text: 'Hello world.', speaker: 1 }, { text: '', speaker: -2 }, { text: 'Another sentence.', speaker: 1 }], buffer_transcription: '' });
    receive({ type: 'ready_to_stop' });
    assert.equal(body, 'Typed first. Hello I am typing. world. Another sentence.');
    assert.equal(transcript.provisional, '');
});

test('committed corrections do not overwrite typed words or duplicate earlier speech', () => {
    let state = acceptDictationTranscript(emptyDictationTranscript(), { lines: [{ text: 'Hello world' }] }).transcript;
    const correction = acceptDictationTranscript(state, { lines: [{ text: 'Hello, world.' }] });
    assert.equal(correction.added, '');
    state = correction.transcript;
    assert.equal(acceptDictationTranscript(state, { lines: [{ text: 'Hello, world. Welcome.' }] }).added, 'Welcome.');
    assert.equal(appendDictationText('An idea\n', 'A new line.'), 'An idea\nA new line.');
    assert.equal(appendDictationText('A sentence', '.'), 'A sentence.');
});

test('replayed messages add nothing while intentionally repeated speech is preserved', () => {
    const first = { lines: [{ text: "I don't know.", speaker: 1 }] };
    const initial = acceptDictationTranscript(emptyDictationTranscript(), first);
    assert.equal(acceptDictationTranscript(initial.transcript, first).added, '');
    const repeated = acceptDictationTranscript(initial.transcript, { lines: [{ text: "I don't know. I don't know.", speaker: 1 }] });
    assert.equal(repeated.added, "I don't know.");
    assert.equal(appendDictationText(initial.added, repeated.added), "I don't know. I don't know.");
});

test('accuracy replay scores actual editor additions and excludes later punctuation corrections from lag', () => {
    const line = (text, end) => ({ text, start: '0:00:00.00', end, speaker: 1 });
    const events = [
        { at: 1, event: { lines: [line('Hello', '0:00:00.50')] } },
        { at: 2, event: { lines: [line('Hello world.', '0:00:01.00')] } },
        { at: 9, event: { lines: [line('Hello, world.', '0:00:01.00')] } },
        { at: 10, event: { type: 'ready_to_stop' } },
    ];
    const replay = spawnSync(process.execPath, ['--experimental-strip-types', 'tests/dictation-editor-replay.mjs'], { input: JSON.stringify(events), encoding: 'utf8' });
    assert.equal(replay.status, 0, replay.stderr);
    const result = JSON.parse(replay.stdout);
    assert.equal(result.text, 'Hello world.');
    assert.deepEqual(result.confirmations, [{ at: 1, spanStart: '0:00:00.00' }, { at: 2, spanStart: '0:00:00.50' }]);
});
