import { useSyncExternalStore } from 'react';

/*
 * App-wide text size. Every font size in globals.css is written as calc(Npx * var(--fs, 1)), so
 * setting --fs on <html> scales all text while the layout keeps its spacing. Saved per browser,
 * like the theme.
 */
export const FONT_SCALES = [
    { value: 0.9, label: 'Small' },
    { value: 1, label: 'Default' },
    { value: 1.1, label: 'Large' },
    { value: 1.2, label: 'Larger' },
    { value: 1.35, label: 'Largest' },
] as const;

const KEY = 'studysprint-font-scale';
const MIN = FONT_SCALES[0].value, MAX = FONT_SCALES.at(-1)!.value;

/** Runs before first paint (inlined in the layout) so text never jumps size on load. */
export const FONT_SCRIPT = `(function(){try{var v=parseFloat(localStorage.getItem('${KEY}'));if(v>=${MIN}&&v<=${MAX})document.documentElement.style.setProperty('--fs',String(v))}catch(e){}})()`;

const clean = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= MIN && n <= MAX ? n : 1; };
function stored() { try { return clean(localStorage.getItem(KEY) ?? 1); } catch { return 1; } }

let scale: number | undefined;
const listeners = new Set<() => void>();
function apply() { document.documentElement.style.setProperty('--fs', String(scale ?? 1)); }
function init() {
    if (scale !== undefined) return;
    scale = stored();
    apply();
    window.addEventListener('storage', e => { if (e.key === KEY) { scale = stored(); apply(); listeners.forEach(l => l()); } });
}

export function setFontScale(next: number) {
    init();
    scale = clean(next);
    try { localStorage.setItem(KEY, String(scale)); } catch { /* still applies to this page */ }
    apply();
    listeners.forEach(l => l());
}

/** Moves one step smaller (-1) or larger (+1) through FONT_SCALES. */
export function stepFontScale(direction: 1 | -1) {
    init();
    const i = FONT_SCALES.findIndex(s => s.value === scale);
    const next = FONT_SCALES[Math.min(FONT_SCALES.length - 1, Math.max(0, (i < 0 ? 1 : i) + direction))];
    setFontScale(next.value);
}

export function useFontScale(): number {
    return useSyncExternalStore(l => { init(); listeners.add(l); return () => { listeners.delete(l); }; }, () => scale ?? stored(), () => 1);
}
