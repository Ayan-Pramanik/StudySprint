/** Native WhisperLiveKit messages contain the complete committed line list. */
export type DictationTranscript = { lines: string[]; provisional: string; confirmed: number };
export type DictationPreview = { phase: 'idle' | 'starting' | 'recording' | 'stopping'; text: string };
export const emptyDictationTranscript = (): DictationTranscript => ({ lines: [], provisional: '', confirmed: 0 });

export function acceptDictationTranscript(previous: DictationTranscript, message: unknown): { transcript: DictationTranscript; added: string } {
    if (!message || typeof message !== 'object') return { transcript: previous, added: '' };
    const value = message as Record<string, unknown>;
    if (!Array.isArray(value.lines)) return { transcript: previous, added: '' };
    if (value.lines.length > 10000) throw Error('The speech response is too large.');
    const lines = [...previous.lines];
    const additions: string[] = [];
    let length = 0;
    for (let index = 0; index < value.lines.length; index++) {
        const line = value.lines[index];
        const text = line && typeof line === 'object' && line.speaker !== -2 && typeof line.text === 'string' ? line.text.trim() : '';
        length += text.length;
        if (length > 100000) throw Error('The speech response is too large.');
        const before = lines[index] ?? '';
        // A committed line may grow. A correction to already committed text must
        // never overwrite typing or insert the old words for a second time.
        const added = text.startsWith(before) ? text.slice(before.length).trim() : '';
        if (added) additions.push(added);
        lines[index] = text;
    }
    const provisional = typeof value.buffer_transcription === 'string' ? value.buffer_transcription.slice(0, 10000).trim() : '';
    const added = additions.join(' ');
    return { transcript: { lines, provisional, confirmed: previous.confirmed + added.length }, added };
}

export function appendDictationText(body: string, added: string): string {
    const text = added.trim();
    if (!text) return body;
    const separator = !body || /\s$/.test(body) || /^[,.;:!?)}\]]/.test(text) ? '' : ' ';
    return body + separator + text;
}
