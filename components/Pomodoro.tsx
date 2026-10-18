'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pause, Play, RotateCcw, SkipForward, Maximize, Minimize, Timer, ShieldCheck } from 'lucide-react';
import { type Phase, type PomodoroSettings, type PomodoroState, back, cleanSettings, completedToday, defaultSettings, duration, focusDays, formatDuration, formatTime, initial, leave, locked, pause, phaseLabel, remaining, reset, skip, start, tick } from '../lib/pomodoro';

// Per-browser state, like the theme: the timer belongs to this device, not the workspace.
const STATE_KEY = 'studysprint-pomodoro', SETTINGS_KEY = 'studysprint-pomodoro-settings';
type Snapshot = { state: PomodoroState; settings: PomodoroSettings; now: number };

function read<T>(key: string): Partial<T> | undefined { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : undefined; } catch { return undefined; } }
function write(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* the timer still works for this page */ } }

let snapshot: Snapshot | undefined;
const serverSnapshot: Snapshot = { state: initial(defaultSettings), settings: defaultSettings, now: 0 };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let audio: AudioContext | undefined;

function load(): Snapshot {
    const settings = cleanSettings(read<PomodoroSettings>(SETTINGS_KEY));
    const saved = read<PomodoroState>(STATE_KEY);
    const valid = saved && typeof saved.phase === 'string' && saved.phase in phaseLabel && ['idle', 'running', 'paused'].includes(saved.status as string);
    const state = valid ? { ...initial(settings), ...saved } : initial(settings);
    // Saved before focus history existed.
    if (!state.history || typeof state.history !== 'object') state.history = {};
    if (!state.total || typeof state.total.ms !== 'number') state.total = { ms: 0, rounds: 0 };
    return { state, settings, now: Date.now() };
}
function current() { return snapshot ??= load(); }
function emit() { listeners.forEach(l => l()); }
function commit(state: PomodoroState, settings = current().settings) {
    snapshot = { state, settings, now: Date.now() };
    write(STATE_KEY, state);
    write(SETTINGS_KEY, settings);
    emit();
}
function chime(finished: Phase) {
    try {
        if (!audio) return;
        // Two notes: rising after a break, falling after focus.
        const notes = finished === 'focus' ? [880, 660] : [660, 880];
        notes.forEach((f, i) => { const o = audio!.createOscillator(), g = audio!.createGain(), t = audio!.currentTime + i * .28; o.frequency.value = f; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.25, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .25); o.connect(g).connect(audio!.destination); o.start(t); o.stop(t + .26); });
    } catch { /* sound is optional */ }
}
function step() {
    const { state, settings } = current();
    const r = tick(state, settings, Date.now());
    if (r.finished) { commit(r.state); chime(r.finished); }
    // Idle timers have nothing to count down.
    else if (state.status !== 'idle') { snapshot = { ...current(), now: Date.now() }; emit(); }
}
function subscribe(listener: () => void) {
    listeners.add(listener);
    if (!timer) {
        timer = setInterval(step, 500);
        window.addEventListener('storage', onStorage);
    }
    return () => { listeners.delete(listener); if (!listeners.size && timer) { clearInterval(timer); timer = undefined; window.removeEventListener('storage', onStorage); } };
}
// Another tab of the app changed the timer.
function onStorage(e: StorageEvent) { if (e.key === STATE_KEY || e.key === SETTINGS_KEY) { snapshot = load(); emit(); } }

function update(state: PomodoroState) { if (state !== current().state) commit(state); }

export const pomodoro = {
    start() {
        // Created in the click so browsers allow the completion sound.
        try { audio ??= new AudioContext(); void audio.resume(); } catch { /* no sound */ }
        update(start(current().state, Date.now()));
    },
    pause() { update(pause(current().state, Date.now())); },
    reset() { commit(reset(current().state, current().settings)); },
    skip() { commit(skip(current().state, current().settings, Date.now())); },
    leave() { update(leave(current().state, current().settings, Date.now())); },
    back() { const r = back(current().state, Date.now()); if (r.away) commit(r.state); return r; },
    settings(next: Partial<PomodoroSettings>) {
        const settings = cleanSettings({ ...current().settings, ...next });
        const { state } = current();
        commit(state.status === 'idle' ? { ...state, remaining: duration(settings, state.phase) } : state, settings);
    },
};

export function usePomodoro(): Snapshot { return useSyncExternalStore(subscribe, current, () => serverSnapshot); }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
function awayText(ms: number) { const s = Math.round(ms / 1000); return s < 60 ? plural(s, 'second') : plural(Math.round(s / 60), 'minute'); }

/**
 * Mounted once at the app root. Browsers do not let a page stop someone switching tabs, so during
 * focus this asks before the page is closed or reloaded, and notices (and optionally pauses for) tab switches.
 */
export function PomodoroGuard() {
    const { state, now } = usePomodoro();
    const isLocked = locked(state);
    const [returned, setReturned] = useState<{ away: number; paused: boolean; interruptions: number }>();
    const title = useRef('');
    useEffect(() => {
        if (!isLocked) return;
        const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', ask);
        return () => window.removeEventListener('beforeunload', ask);
    }, [isLocked]);
    useEffect(() => {
        const change = () => {
            if (document.visibilityState === 'hidden') { pomodoro.leave(); return; }
            const r = pomodoro.back();
            if (r.away >= 2000) setReturned({ away: r.away, paused: r.paused, interruptions: r.state.interruptions });
        };
        // A reload while away still counts the absence once the page is visible.
        if (document.visibilityState === 'visible') pomodoro.back();
        document.addEventListener('visibilitychange', change);
        return () => document.removeEventListener('visibilitychange', change);
    }, []);
    const active = state.status !== 'idle';
    const label = active ? `${state.status === 'paused' ? '⏸ ' : ''}${formatTime(remaining(state, now))} · ${phaseLabel[state.phase]}` : '';
    useEffect(() => {
        if (!title.current) title.current = document.title;
        document.title = label ? `${label} — StudySprint` : title.current;
    }, [label]);
    useEffect(() => () => { if (title.current) document.title = title.current; }, []);
    if (!returned) return null;
    return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="focus-return-title"><div className="modal focus-return"><h2 id="focus-return-title">Welcome back. Stay with it.</h2>
        <p>You left your focus session for {awayText(returned.away)}. {returned.paused ? 'The timer was paused while you were away, so that time doesn’t count.' : 'The timer kept running while you were away.'}</p>
        <p className="small">{plural(returned.interruptions, 'interruption')} this session.</p>
        <div className="actions"><button className="primary" autoFocus onClick={() => setReturned(undefined)}>Back to focus</button></div></div></div>;
}

/** Compact countdown for the top bar; hidden while the timer is idle. */
export function PomodoroChip({ open }: { open: () => void }) {
    const { state, now } = usePomodoro();
    if (state.status === 'idle') return null;
    return <button className={'pomodoro-chip ' + state.phase} onClick={open} aria-label={`${phaseLabel[state.phase]} timer, ${formatTime(remaining(state, now))} left${state.status === 'paused' ? ', paused' : ''}. Open Focus`}>
        {state.status === 'paused' ? <Pause size={13}/> : <Timer size={13}/>}<span>{formatTime(remaining(state, now))}</span></button>;
}

function onFullscreen(l: () => void) { document.addEventListener('fullscreenchange', l); return () => document.removeEventListener('fullscreenchange', l); }

export function FocusTimer() {
    const { state, settings, now } = usePomodoro();
    const left = remaining(state, now), total = duration(settings, state.phase);
    const progress = Math.min(1, Math.max(0, 1 - left / total));
    const fullscreen = useSyncExternalStore(onFullscreen, () => !!document.fullscreenElement, () => false);
    const canFullscreen = useSyncExternalStore(onFullscreen, () => !!document.fullscreenEnabled, () => false);
    const toggleFullscreen = () => { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}); };
    const running = state.status === 'running', idle = state.status === 'idle';
    const r = 112, circumference = 2 * Math.PI * r;
    const field = (key: 'focus' | 'short' | 'long' | 'rounds', label: string, max: number) => <label>{label}<input type="number" min={1} max={max} value={settings[key]} disabled={!idle} onChange={e => pomodoro.settings({ [key]: e.target.value === '' ? settings[key] : Number(e.target.value) })}/></label>;
    return <><div className="page-heading"><div className="eyebrow">STAY WITH IT</div><h1>Focus<span className="indigo">.</span></h1><p>Work in focused rounds with short breaks. Leaving the page during a focus round asks you first, and switching tabs is noticed.</p></div>
        <div className="focus-layout"><section className={'panel focus-timer ' + state.phase}>
            <div className="segmented" aria-label="Phase">{(['focus', 'short', 'long'] as Phase[]).map(p => <span key={p} className={state.phase === p ? 'selected' : ''}>{phaseLabel[p]}</span>)}</div>
            <div className="focus-ring" role="timer" aria-live="off" aria-label={`${phaseLabel[state.phase]}: ${formatTime(left)} left`}>
                <svg viewBox="0 0 260 260" aria-hidden="true"><circle cx="130" cy="130" r={r} className="track"/><circle cx="130" cy="130" r={r} className="progress" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)}/></svg>
                <div><strong>{formatTime(left)}</strong><small>{state.status === 'paused' ? (state.awayPaused ? 'Paused while away' : 'Paused') : running ? phaseLabel[state.phase] : 'Ready'}</small></div>
            </div>
            <div className="focus-rounds" aria-label={`Round ${Math.min(state.round + 1, settings.rounds)} of ${settings.rounds}`}>{Array.from({ length: settings.rounds }, (_, i) => <i key={i} className={i < state.round ? 'done' : ''}/>)}</div>
            <div className="actions focus-actions">
                {running ? <button className="primary" onClick={pomodoro.pause}><Pause size={16}/>Pause</button> : <button className="primary" onClick={pomodoro.start}><Play size={16}/>{idle ? `Start ${phaseLabel[state.phase].toLowerCase()}` : 'Resume'}</button>}
                <button onClick={pomodoro.reset} disabled={idle && left === total}><RotateCcw size={16}/>Reset</button>
                <button onClick={pomodoro.skip}><SkipForward size={16}/>{state.phase === 'focus' ? 'Skip to break' : 'Skip break'}</button>
                {canFullscreen && <button onClick={toggleFullscreen}>{fullscreen ? <Minimize size={16}/> : <Maximize size={16}/>}{fullscreen ? 'Exit full screen' : 'Full screen'}</button>}
            </div>
            {locked(state) && <p className="focus-lock"><ShieldCheck size={15}/>Focus lock is on. Closing or reloading this page will ask first{settings.pauseAway ? ', and the timer pauses if you switch tabs' : ''}.</p>}
        </section>
        <aside><section className="panel"><h2>This session</h2><div className="focus-stats"><div><strong>{completedToday(state, now)}</strong><small>focus rounds today</small></div><div><strong>{state.interruptions}</strong><small>interruptions</small></div><div><strong>{formatTime(state.awayMs)}</strong><small>time away</small></div></div></section>
            <section className="panel"><h2>Timer settings</h2>{!idle && <p className="small">Reset or finish the current round to change these.</p>}
                <div className="focus-fields">{field('focus', 'Focus (min)', 120)}{field('short', 'Short break (min)', 60)}{field('long', 'Long break (min)', 60)}{field('rounds', 'Rounds before long break', 12)}</div>
                <label className="checkbox"><input type="checkbox" checked={settings.pauseAway} onChange={e => pomodoro.settings({ pauseAway: e.target.checked })}/>Pause the timer while I’m away from this tab</label>
                <p className="small">Saved in this browser. Browsers don’t allow a page to block switching tabs or apps; this timer asks before the page closes and makes time away visible.</p></section></aside></div></>;
}

/** Focus time on the Progress page. Recorded in this browser, so it is not part of workspace backups. */
export function FocusProgress({ open }: { open: () => void }) {
    const { state, now } = usePomodoro();
    const week = focusDays(state, now);
    const weekMs = week.reduce((sum, d) => sum + d.ms, 0), max = Math.max(...week.map(d => d.ms), 1);
    return <section className="panel focus-progress"><div className="section-heading"><h2>Focus time</h2><button className="text-button" onClick={open}>Open Focus</button></div>
        <div className="stats"><div className="stat"><div className="row"><span>Total focus time</span><Timer/></div><strong>{formatDuration(state.total.ms)}</strong><small>{plural(state.total.rounds, 'completed round')}</small></div>
            <div className="stat"><div className="row"><span>Today</span></div><strong>{formatDuration(week[6].ms)}</strong><small>{plural(week[6].rounds, 'round')}</small></div>
            <div className="stat"><div className="row"><span>Last 7 days</span></div><strong>{formatDuration(weekMs)}</strong><small>{plural(week.reduce((n, d) => n + d.rounds, 0), 'round')}</small></div>
            <div className="stat"><div className="row"><span>Daily average</span></div><strong>{formatDuration(weekMs / 7)}</strong><small>over the last 7 days</small></div></div>
        <div className="bars">{week.map(d => <div key={d.day}><span>{Math.round(d.ms / 60000)}m</span><div className="bar focus-bar" style={{ height: `${Math.max(3, Math.round(150 * d.ms / max))}px` }}/><small>{new Date(d.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}</small></div>)}</div>
        <p className="small">Counts completed focus rounds only; skipped or reset rounds aren’t included. Recorded in this browser.</p></section>;
}
