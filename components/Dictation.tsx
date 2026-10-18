'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Mic, Square, RotateCcw } from 'lucide-react';
import { acceptDictationTranscript, emptyDictationTranscript, type DictationPreview, type DictationTranscript } from '../lib/dictation';

type ServiceStatus = { configured: boolean; available: boolean; busy: boolean };
type Phase = 'checking' | 'idle' | 'starting' | 'recording' | 'stopping' | 'error';
type Session = {
    abort: AbortController;
    context?: AudioContext;
    stream?: MediaStream;
    source?: MediaStreamAudioSourceNode;
    worklet?: AudioWorkletNode;
    mute?: GainNode;
    socket?: WebSocket;
    deadline?: ReturnType<typeof setTimeout>;
    clock?: ReturnType<typeof setInterval>;
    transcript: DictationTranscript;
    started: boolean;
    stopping: boolean;
    ended: boolean;
};

// Leave room for microphone flush, backend finalization and network transit
// inside the service's five-minute total session limit.
const MAX_CAPTURE_MS = 240000;
const MAX_QUEUED_BYTES = 128000;

async function serviceStatus(signal: AbortSignal): Promise<ServiceStatus> {
    const response = await fetch('/api/dictation/status', { cache: 'no-store', signal });
    if (!response.ok) throw Error('Could not check the speech service. Retry when it is connected.');
    const raw = await response.json();
    if (!raw || typeof raw !== 'object') throw Error('The speech service returned an unexpected status.');
    const data = raw as Record<string, unknown>;
    if (typeof data.configured !== 'boolean' || typeof data.available !== 'boolean' || typeof data.busy !== 'boolean') throw Error('The speech service returned an unexpected status.');
    return { configured: data.configured, available: data.available, busy: data.busy };
}

function microphoneError(error: unknown): string {
    if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Microphone access was denied. Allow it in your browser settings, then try again.';
        if (error.name === 'NotFoundError') return 'No microphone was found. Connect a microphone, then try again.';
        if (error.name === 'NotReadableError') return 'The microphone is in use or unavailable. Check the device, then try again.';
        if (error.name === 'AbortError') return 'The speech connection timed out. Check the local service, then retry.';
    }
    return error instanceof Error ? error.message : 'Dictation could not start. You can keep typing and try again.';
}

export function Dictation({ noteId, onConfirmed, onStart, onPreview }: { noteId: string; onConfirmed: (text: string) => void; onStart: () => void; onPreview: (preview: DictationPreview) => void }) {
    const [phase, setPhase] = useState<Phase>('checking');
    const [service, setService] = useState<ServiceStatus>();
    const [unsupported, setUnsupported] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [provisional, setProvisional] = useState('');
    const [seconds, setSeconds] = useState(0);
    const [level, setLevel] = useState(0);
    const session = useRef<Session | null>(null);
    const mounted = useRef(true);
    const statusRequest = useRef<AbortController | null>(null);
    const onConfirmedRef = useRef(onConfirmed);
    useEffect(() => { onConfirmedRef.current = onConfirmed; }, [onConfirmed]);
    // Publish the replacement draft before paint, including when words become
    // confirmed, so the editor never displays an old draft after those words.
    useLayoutEffect(() => {
        onPreview({ phase: phase === 'starting' || phase === 'recording' || phase === 'stopping' ? phase : 'idle', text: provisional });
    }, [phase, provisional, onPreview]);

    const releaseAudio = useCallback((current: Session) => {
        current.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
        if (current.worklet) { current.worklet.port.onmessage = null; current.worklet.onprocessorerror = null; current.worklet.port.close(); current.worklet.disconnect(); }
        current.source?.disconnect();
        current.mute?.disconnect();
        if (current.context) { current.context.onstatechange = null; void current.context.close().catch(() => {}); }
        current.worklet = undefined;
        current.source = undefined;
        current.mute = undefined;
        current.context = undefined;
    }, []);

    const finish = useCallback((current: Session, message = '', completed = false) => {
        if (current.ended) return;
        current.ended = true;
        current.abort.abort();
        clearTimeout(current.deadline);
        clearInterval(current.clock);
        releaseAudio(current);
        if (current.socket) {
            current.socket.onopen = null;
            current.socket.onmessage = null;
            current.socket.onerror = null;
            current.socket.onclose = null;
            if (current.socket.readyState === WebSocket.OPEN || current.socket.readyState === WebSocket.CONNECTING) current.socket.close();
        }
        if (session.current !== current) return;
        session.current = null;
        if (!mounted.current) return;
        setProvisional('');
        setPhase(message ? 'error' : 'idle');
        setError(message ? `${message}${current.transcript.confirmed ? ' Confirmed words are kept in your note.' : ''}` : '');
        if (completed) setNotice(current.transcript.confirmed ? 'Dictation added. Review the wording as your note saves.' : 'No speech was confirmed. Try again or keep typing.');
    }, [releaseAudio]);

    const checkService = useCallback(async () => {
        statusRequest.current?.abort();
        const abort = new AbortController();
        statusRequest.current = abort;
        const timeout = setTimeout(() => abort.abort(), 8000);
        setPhase('checking');
        setError('');
        try {
            const next = await serviceStatus(abort.signal);
            if (!mounted.current || abort.signal.aborted) return;
            setService(next);
            setPhase('idle');
        } catch (cause) {
            if (!mounted.current || statusRequest.current !== abort) return;
            setService(undefined);
            setPhase('error');
            setError(microphoneError(cause));
        } finally { clearTimeout(timeout); }
    }, []);

    useEffect(() => {
        mounted.current = true;
        const initialCheck = requestAnimationFrame(() => {
            if (!window.isSecureContext) {
                setUnsupported('Microphone dictation needs HTTPS or localhost. You can keep typing.');
                setPhase('idle');
            } else if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) {
                setUnsupported('This browser does not support microphone dictation. Try a current Safari, Chrome, Edge or Firefox browser.');
                setPhase('idle');
            } else { void checkService(); }
        });
        function guard(event: BeforeUnloadEvent) { if (session.current) event.preventDefault(); }
        window.addEventListener('beforeunload', guard);
        return () => {
            mounted.current = false;
            cancelAnimationFrame(initialCheck);
            statusRequest.current?.abort();
            window.removeEventListener('beforeunload', guard);
            if (session.current) finish(session.current);
        };
    }, [noteId, checkService, finish]);

    function stop() {
        const current = session.current;
        if (!current || current.ended || current.stopping) return;
        if (!current.started) { finish(current); setNotice('Dictation cancelled.'); return; }
        current.stopping = true;
        clearTimeout(current.deadline);
        clearInterval(current.clock);
        setPhase('stopping');
        setNotice('');
        // Stop capture first, but keep the worklet alive until its final PCM
        // samples arrive. The empty frame must follow those samples on the socket.
        current.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
        current.source?.disconnect();
        current.deadline = setTimeout(() => finish(current, 'The microphone did not finish. Please try again.'), 3000);
        current.worklet?.port.postMessage({ type: 'flush' });
    }

    async function start() {
        if (session.current || unsupported) return;
        const current: Session = { abort: new AbortController(), transcript: emptyDictationTranscript(), started: false, stopping: false, ended: false };
        session.current = current;
        setPhase('starting');
        setError('');
        setNotice('');
        setProvisional('');
        setLevel(0);
        setSeconds(0);
        try {
            // Resume during the click gesture, including on mobile Safari.
            current.context = new AudioContext();
            await current.context.resume();
            if (current.ended) return;
            current.deadline = setTimeout(() => current.abort.abort(), 8000);
            const next = await serviceStatus(current.abort.signal);
            clearTimeout(current.deadline);
            if (current.ended) return;
            setService(next);
            if (!next.configured) throw Error('Voice dictation is unavailable in this workspace. You can keep typing.');
            if (!next.available) throw Error('Voice dictation is temporarily unavailable. You can keep typing and retry shortly.');
            if (next.busy) throw Error('The speech service is busy with another recording. Try again shortly.');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
            if (current.ended) { stream.getTracks().forEach(track => track.stop()); return; }
            current.stream = stream;
            await current.context.audioWorklet.addModule('/dictation-audio-worklet.js');
            if (current.ended) return;
            const address = new URL('/api/dictation', window.location.href);
            address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
            address.searchParams.set('noteId', noteId);
            const socket = new WebSocket(address);
            current.socket = socket;
            current.deadline = setTimeout(() => finish(current, 'The speech service did not connect. Please retry.'), 15000);
            socket.onerror = () => finish(current, 'Could not connect to dictation. Check your connection, then retry.');
            socket.onclose = () => finish(current, 'The speech connection closed before finishing. Try again.');
            socket.onmessage = event => {
                if (current.ended || session.current !== current) return;
                try {
                    if (typeof event.data !== 'string' || event.data.length > 512000) throw Error('The speech service returned an unexpected response.');
                    const message = JSON.parse(event.data);
                    if (message.type === 'error' || message.status === 'error') {
                        const reasons: Record<string, string> = { busy: 'The speech service is busy. Try again shortly.', session_limit: 'The recording reached its time limit.', inactivity: 'Dictation stopped because no audio arrived.', audio_limit: 'The recording reached its audio limit.' };
                        throw Error(reasons[message.code] || 'The speech service could not finish this recording. Please try again.');
                    }
                    if (message.type === 'config' && !current.started) {
                        if (message.useAudioWorklet !== true) throw Error('The speech service could not accept microphone audio.');
                        clearTimeout(current.deadline);
                        const context = current.context!;
                        current.source = context.createMediaStreamSource(stream);
                        current.worklet = new AudioWorkletNode(context, 'dictation-audio', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
                        current.mute = context.createGain();
                        current.mute.gain.value = 0;
                        current.worklet.port.onmessage = audio => {
                            if (current.ended || session.current !== current) return;
                            if (audio.data?.type === 'audio') {
                                if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_QUEUED_BYTES) { finish(current, 'The speech connection is too slow. Please retry.'); return; }
                                socket.send(audio.data.buffer);
                            } else if (audio.data?.type === 'level' && !current.stopping) {
                                setLevel(audio.data.value);
                            } else if (audio.data?.type === 'flushed' && current.stopping) {
                                clearTimeout(current.deadline);
                                releaseAudio(current);
                                if (socket.readyState !== WebSocket.OPEN) { finish(current, 'The speech connection closed before finishing.'); return; }
                                socket.send(new ArrayBuffer(0));
                                current.deadline = setTimeout(() => finish(current, 'The final words took too long. Please retry.'), 35000);
                            }
                        };
                        current.worklet.onprocessorerror = () => finish(current, 'Microphone capture stopped unexpectedly. Please retry.');
                        current.source.connect(current.worklet);
                        current.worklet.connect(current.mute);
                        current.mute.connect(context.destination);
                        current.started = true;
                        const started = performance.now();
                        current.clock = setInterval(() => { if (!current.ended) setSeconds(Math.floor((performance.now() - started) / 1000)); }, 1000);
                        current.deadline = setTimeout(stop, MAX_CAPTURE_MS);
                        stream.getTracks().forEach(track => { track.onended = () => finish(current, 'The microphone disconnected. Check it, then retry.'); });
                        context.onstatechange = () => { if (!current.stopping && context.state === 'suspended') finish(current, 'Microphone capture paused. Keep this page active and try again.'); };
                        setPhase('recording');
                        onStart();
                    }
                    const update = acceptDictationTranscript(current.transcript, message);
                    current.transcript = update.transcript;
                    if (update.added) onConfirmedRef.current(update.added);
                    setProvisional(update.transcript.provisional);
                    if (message.type === 'ready_to_stop') finish(current, '', true);
                } catch (cause) { finish(current, microphoneError(cause)); }
            };
        } catch (cause) { if (!current.ended) finish(current, microphoneError(cause)); }
    }

    const active = phase === 'starting' || phase === 'recording' || phase === 'stopping';
    const unavailable = service && (!service.configured || !service.available || service.busy);
    const status = phase === 'checking' ? 'Checking dictation…' : phase === 'starting' ? 'Connecting microphone…' : phase === 'recording' ? `Listening · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : phase === 'stopping' ? 'Finishing your last words…' : unsupported || (service?.busy ? 'Speech service busy. Retry shortly.' : service && (!service.configured || !service.available) ? 'Dictation is temporarily unavailable. You can keep typing.' : notice || 'English dictation · up to 4 minutes');
    return <section className={`dictation ${active ? 'dictation-active' : ''}`} aria-label="Voice dictation">
        <div className="dictation-controls">
            <button type="button" className={phase === 'recording' ? 'dictation-stop' : ''} onClick={active ? stop : () => void start()} disabled={phase === 'checking' || phase === 'stopping' || !!unsupported || (!active && (!service || !!unavailable))}>
                {active ? <Square size={14} aria-hidden="true"/> : <Mic size={16} aria-hidden="true"/>}
                {phase === 'starting' ? 'Cancel' : phase === 'stopping' ? 'Finishing…' : phase === 'recording' ? 'Stop dictation' : 'Start dictation'}
            </button>
            <span className="dictation-status" role="status">{status}</span>
            {phase === 'recording' && <span className="dictation-meter" role="img" aria-label="Microphone sound level"><span style={{ transform: `scaleX(${level})` }}/></span>}
            {!active && !unsupported && (unavailable || !service) && phase !== 'checking' && <button type="button" className="text-button" onClick={() => void checkService()}><RotateCcw size={13} aria-hidden="true"/>Retry</button>}
        </div>
        {phase === 'recording' && <p className="dictation-help">Live words appear in purple as they’re recognized, then settle into your note when confirmed. You can keep typing.</p>}
        {error && <p className="dictation-error" role="alert">{error}</p>}
        {!active && service?.available && !notice && !error && <p className="dictation-help">Live words may take a few seconds to appear and can change before they’re confirmed. Your microphone starts only when you choose Start. Audio is sent to the host Mac for transcription. Recordings aren’t saved.</p>}
    </section>;
}
