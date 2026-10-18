import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'studysprint-theme';

/** Runs before first paint (inlined in the layout) so a dark page never flashes light. */
export const THEME_SCRIPT = `(function(){var p='system';try{p=localStorage.getItem('${KEY}')||'system'}catch(e){}var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.dataset.theme=d?'dark':'light';r.style.colorScheme=d?'dark':'light'})()`;

const isPreference = (v: unknown): v is ThemePreference => v === 'system' || v === 'light' || v === 'dark';
function stored(): ThemePreference { try { const v = localStorage.getItem(KEY); return isPreference(v) ? v : 'system'; } catch { return 'system'; } }

let preference: ThemePreference | undefined;
const listeners = new Set<() => void>();
const dark = () => window.matchMedia('(prefers-color-scheme: dark)');

function apply() {
    const theme: Theme = preference === 'dark' || (preference === 'system' && dark().matches) ? 'dark' : 'light';
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
}

function init() {
    if (preference) return;
    preference = stored();
    apply();
    dark().addEventListener('change', () => { if (preference === 'system') apply(); });
    // Keep other open tabs in step.
    window.addEventListener('storage', e => { if (e.key === KEY) { preference = stored(); apply(); listeners.forEach(l => l()); } });
}

export function setThemePreference(next: ThemePreference) {
    init();
    preference = next;
    try { localStorage.setItem(KEY, next); } catch { /* the choice still applies to this page */ }
    apply();
    listeners.forEach(l => l());
}

/** The viewer's saved choice; stored per browser, not in the workspace. */
export function useThemePreference(): ThemePreference {
    return useSyncExternalStore(l => { init(); listeners.add(l); return () => { listeners.delete(l); }; }, () => preference ?? stored(), () => 'system');
}

/** The theme actually shown, following the system setting when the preference is 'system'. */
export function useTheme(): Theme {
    return useSyncExternalStore(l => { const o = new MutationObserver(l); o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => o.disconnect(); },
        () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', () => 'light');
}
