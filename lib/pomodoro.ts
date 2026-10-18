/** Pomodoro timer as pure state transitions; all times are epoch milliseconds. */
export type Phase = 'focus' | 'short' | 'long';
export type Status = 'idle' | 'running' | 'paused';
export type PomodoroSettings = { focus: number; short: number; long: number; rounds: number; pauseAway: boolean };
export type PomodoroState = {
    phase: Phase;
    status: Status;
    /** Focus sessions completed in the current cycle; a long break follows every `rounds`. */
    round: number;
    endsAt: number;
    /** Time left while idle or paused. */
    remaining: number;
    /** When the viewer left the tab during focus; 0 while present. */
    awaySince: number;
    /** The timer was paused because the viewer left, and resumes when they return. */
    awayPaused: boolean;
    interruptions: number;
    awayMs: number;
    /** Completed focus rounds per local day (YYYY-MM-DD), kept for HISTORY_DAYS. */
    history: Record<string, FocusDay>;
    /** All-time completed focus, kept even after old days are pruned from history. */
    total: FocusDay;
};
export type FocusDay = { ms: number; rounds: number };
export const HISTORY_DAYS = 120;

export const defaultSettings: PomodoroSettings = { focus: 25, short: 5, long: 15, rounds: 4, pauseAway: true };
export const phaseLabel: Record<Phase, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' };

const clamp = (v: unknown, min: number, max: number, fallback: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
export function cleanSettings(s: Partial<PomodoroSettings> = {}): PomodoroSettings {
    const d = defaultSettings;
    return { focus: clamp(s.focus, 1, 120, d.focus), short: clamp(s.short, 1, 60, d.short), long: clamp(s.long, 1, 60, d.long), rounds: clamp(s.rounds, 1, 12, d.rounds), pauseAway: typeof s.pauseAway === 'boolean' ? s.pauseAway : d.pauseAway };
}

export const duration = (s: PomodoroSettings, phase: Phase) => (phase === 'focus' ? s.focus : phase === 'short' ? s.short : s.long) * 60000;
export const dayKey = (now: number) => new Date(now).toLocaleDateString('en-CA');
export const remaining = (st: PomodoroState, now: number) => st.status === 'running' ? Math.max(0, st.endsAt - now) : st.remaining;
export const completedToday = (st: PomodoroState, now: number) => st.history[dayKey(now)]?.rounds ?? 0;
/** Completed focus time per day for the `days` days ending today, oldest first. */
export function focusDays(st: PomodoroState, now: number, days = 7): { day: string; ms: number; rounds: number }[] {
    return Array.from({ length: days }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - (days - 1) + i); const day = dayKey(+d); return { day, ...(st.history[day] ?? { ms: 0, rounds: 0 }) }; });
}
/** "1 h 25 min", "25 min", "0 min". */
export function formatDuration(ms: number) { const m = Math.round(ms / 60000), h = Math.floor(m / 60); return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`; }
/** Leaving is discouraged only during a focus phase that is running (or paused only because the viewer left). */
export const locked = (st: PomodoroState) => st.phase === 'focus' && (st.status === 'running' || st.awayPaused);
export const formatTime = (ms: number) => { const total = Math.ceil(ms / 1000); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; };

export function initial(s: PomodoroSettings): PomodoroState {
    return { phase: 'focus', status: 'idle', round: 0, endsAt: 0, remaining: duration(s, 'focus'), awaySince: 0, awayPaused: false, interruptions: 0, awayMs: 0, history: {}, total: { ms: 0, rounds: 0 } };
}

export function start(st: PomodoroState, now: number): PomodoroState {
    if (st.status === 'running') return st;
    // A fresh focus phase starts a fresh distraction count.
    const fresh = st.status === 'idle' && st.phase === 'focus' ? { interruptions: 0, awayMs: 0 } : {};
    return { ...st, ...fresh, status: 'running', endsAt: now + st.remaining, awayPaused: false };
}

export function pause(st: PomodoroState, now: number): PomodoroState {
    if (st.status !== 'running') return st;
    return { ...st, status: 'paused', remaining: Math.max(0, st.endsAt - now), awayPaused: false };
}

export function reset(st: PomodoroState, s: PomodoroSettings): PomodoroState {
    return { ...st, status: 'idle', endsAt: 0, remaining: duration(s, st.phase), awaySince: 0, awayPaused: false };
}

function advance(st: PomodoroState, s: PomodoroSettings, now: number, completed: boolean): PomodoroState {
    let { round, history, total } = st;
    let phase: Phase;
    if (st.phase === 'focus') {
        if (completed) {
            round += 1;
            // Settings cannot change mid-round, so the configured length is the time focused.
            const ms = duration(s, 'focus'), day = dayKey(now), cutoff = dayKey(now - HISTORY_DAYS * 86400000);
            history = Object.fromEntries(Object.entries(history).filter(([d]) => d > cutoff));
            history[day] = { ms: (history[day]?.ms ?? 0) + ms, rounds: (history[day]?.rounds ?? 0) + 1 };
            total = { ms: total.ms + ms, rounds: total.rounds + 1 };
        }
        phase = completed && round >= s.rounds ? 'long' : 'short';
    } else {
        if (st.phase === 'long') round = 0;
        phase = 'focus';
    }
    return { ...st, phase, round, history, total, status: 'idle', endsAt: 0, remaining: duration(s, phase), awaySince: 0, awayPaused: false };
}

/** Moves to the next phase once time is up; `finished` names the phase that just ended. */
export function tick(st: PomodoroState, s: PomodoroSettings, now: number): { state: PomodoroState; finished?: Phase } {
    return st.status === 'running' && now >= st.endsAt ? { state: advance(st, s, now, true), finished: st.phase } : { state: st };
}

/** Ends the current phase early without counting it as completed. */
export const skip = (st: PomodoroState, s: PomodoroSettings, now: number) => advance(st, s, now, false);

export function leave(st: PomodoroState, s: PomodoroSettings, now: number): PomodoroState {
    if (!locked(st) || st.awaySince) return st;
    const next = { ...st, awaySince: now, interruptions: st.interruptions + 1 };
    return s.pauseAway ? { ...pause(next, now), awayPaused: true } : next;
}

export function back(st: PomodoroState, now: number): { state: PomodoroState; away: number; paused: boolean } {
    if (!st.awaySince) return { state: st, away: 0, paused: false };
    const away = Math.max(0, now - st.awaySince);
    const next = { ...st, awaySince: 0, awayMs: st.awayMs + away };
    return { state: st.awayPaused ? start(next, now) : next, away, paused: st.awayPaused };
}
