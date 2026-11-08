'use client';
import { useEffect, type RefObject } from 'react';

/*
 * Remembers how far each note was read and returns there when it is opened again. The position
 * is saved against a block of the rendered note (paragraph, heading, diagram…) rather than as a
 * pixel offset, because diagrams and images render after the text and change the page height.
 * Saved per browser.
 */
const KEY = 'ss-reading-position';
const LAST = 'ss-last-note';
const MAX = 60;
// The reading line sits a little below the top so sticky toolbars don't hide it.
const LINE = 96;

type Position = { i: number; o: number; at: number };
const read = (): Record<string, Position> => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
function write(map: Record<string, Position>) {
    const kept = Object.entries(map).sort((a, b) => b[1].at - a[1].at).slice(0, MAX);
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept))); } catch { /* storage unavailable */ }
}

export function rememberLastNote(id: string) { try { localStorage.setItem(LAST, id); } catch { /* storage unavailable */ } }
export function lastNote() { try { return localStorage.getItem(LAST) || ''; } catch { return ''; } }

/**
 * The element that scrolls the note: the nearest scrollable ancestor (the note panel on wide
 * screens, the fullscreen reader), or the page itself when none is.
 */
function scroller(prose: HTMLElement): HTMLElement | undefined {
    for (let el = prose.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        const y = getComputedStyle(el).overflowY;
        if ((y === 'auto' || y === 'scroll' || y === 'overlay') && el.scrollHeight > el.clientHeight + 1) return el;
    }
    return undefined;
}
const viewTop = (box?: HTMLElement) => box ? box.getBoundingClientRect().top : 0;
const scrolled = (box?: HTMLElement) => box ? box.scrollTop : window.scrollY;
const scrollBy = (box: HTMLElement | undefined, dy: number) => { if (box) box.scrollTop += dy; else window.scrollBy(0, dy); };

/** `layout` changes when the note moves between the page and the fullscreen reader, so the position is re-applied there. */
export function useReadingPosition(noteId: string, prose: RefObject<HTMLElement | null>, active: boolean, layout: string) {
    useEffect(() => {
        const root = prose.current;
        if (!active || !root) return;
        const blocks = () => Array.from(root.children) as HTMLElement[];
        let restoring = true, saveTimer: ReturnType<typeof setTimeout> | undefined, lastInput = 0;

        function save() {
            if (restoring) return;
            const box = scroller(root!), line = viewTop(box) + LINE, map = read();
            const list = blocks();
            const i = list.findIndex(b => b.getBoundingClientRect().bottom > line);
            // Scrolled back to the top by the reader: nothing to resume. A jump to the top without
            // their input (e.g. the app navigating) keeps the saved place.
            if (i <= 0 && scrolled(box) < 40) { if (Date.now() - lastInput > 1500) return; delete map[noteId]; }
            else if (i >= 0) map[noteId] = { i, o: Math.round(line - list[i].getBoundingClientRect().top), at: Date.now() };
            write(map);
        }
        function restore() {
            const saved = read()[noteId];
            if (!saved) { restoring = false; return; }
            const target = blocks()[Math.min(saved.i, blocks().length - 1)];
            if (!target) return;
            const box = scroller(root!);
            const dy = target.getBoundingClientRect().top + saved.o - (viewTop(box) + LINE);
            if (Math.abs(dy) > 2) scrollBy(box, dy);
        }

        // Re-apply while diagrams and images load, until the reader scrolls themselves or 5 s pass.
        const stop = () => { if (!restoring) return; restoring = false; observer.disconnect(); timers.forEach(clearTimeout); ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(e => window.removeEventListener(e, stop, true)); };
        const observer = new ResizeObserver(() => { if (restoring) restore(); });
        observer.observe(root);
        const timers = [0, 120, 400, 1000, 2000].map(ms => setTimeout(() => { if (restoring) restore(); }, ms));
        timers.push(setTimeout(stop, 5000));
        ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(e => window.addEventListener(e, stop, { capture: true, passive: true }));
        requestAnimationFrame(() => { if (restoring) restore(); });

        const input = () => { lastInput = Date.now(); };
        const INPUTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'];
        INPUTS.forEach(e => window.addEventListener(e, input, { capture: true, passive: true }));
        const onScroll = () => { saveTimer ??= setTimeout(() => { saveTimer = undefined; save(); }, 150); };
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        const flush = () => { if (document.visibilityState === 'hidden') save(); };
        document.addEventListener('visibilitychange', flush);
        return () => { INPUTS.forEach(e => window.removeEventListener(e, input, true)); stop(); clearTimeout(saveTimer); document.removeEventListener('scroll', onScroll, true); document.removeEventListener('visibilitychange', flush); };
    }, [noteId, prose, active, layout]);
}
