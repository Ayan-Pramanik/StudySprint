import { useSyncExternalStore } from 'react';

/*
 * In-app notifications shown as toasts in the top-right corner. Any module can call notify();
 * the <Notifications/> component (mounted once in the app shell) shows them.
 */
export type NotificationKind = 'info' | 'success' | 'error' | 'timer';
export type AppNotification = { id: number; kind: NotificationKind; title?: string; message: string; duration: number };

let items: AppNotification[] = [];
let next = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, { timer: ReturnType<typeof setTimeout>; deadline: number }>();
const remaining = new Map<number, number>();
const emit = () => listeners.forEach(l => l());
const MAX = 5;

const DURATION: Record<NotificationKind, number> = { info: 5000, success: 5000, error: 10000, timer: 12000 };

export function notify(input: string | { message: string; title?: string; kind?: NotificationKind; duration?: number }): number {
    const n = typeof input === 'string' ? { message: input } : input;
    if (!n.message?.trim()) return 0;
    const kind = n.kind ?? 'info';
    // The same message again (e.g. a repeated error) refreshes the existing toast instead of stacking.
    const same = items.find(i => i.message === n.message && i.kind === kind && i.title === n.title);
    if (same) dismiss(same.id);
    const item: AppNotification = { id: next++, kind, title: n.title, message: n.message, duration: n.duration ?? DURATION[kind] };
    items = [...items, item].slice(-MAX);
    schedule(item.id, item.duration);
    emit();
    return item.id;
}

function schedule(id: number, ms: number) {
    if (ms > 0) timers.set(id, { timer: setTimeout(() => dismiss(id), ms), deadline: Date.now() + ms });
}

export function dismiss(id: number) {
    clearTimeout(timers.get(id)?.timer); timers.delete(id); remaining.delete(id);
    if (!items.some(i => i.id === id)) return;
    items = items.filter(i => i.id !== id);
    emit();
}

/** Hovering a toast pauses its countdown; leaving resumes it where it stopped. */
export function hold(id: number, held: boolean) {
    const running = timers.get(id);
    if (held) { if (running) { clearTimeout(running.timer); timers.delete(id); remaining.set(id, Math.max(1000, running.deadline - Date.now())); } return; }
    const left = remaining.get(id);
    if (left !== undefined) { remaining.delete(id); schedule(id, left); }
}

const empty: AppNotification[] = [];
export function useNotifications(): AppNotification[] {
    return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => items, () => empty);
}

/**
 * Also shows a system notification when the page is in the background and the person has allowed
 * them, so a finished timer is noticed from another tab or app.
 */
export function notifySystem(title: string, body: string) {
    try {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
        const n = new Notification(title, { body, icon: '/favicon.svg', tag: 'studysprint-timer' });
        n.onclick = () => { window.focus(); n.close(); };
    } catch { /* not supported here */ }
}
