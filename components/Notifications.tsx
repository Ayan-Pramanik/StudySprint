'use client';
import { CircleAlert, CircleCheck, Info, Timer, X } from 'lucide-react';
import { dismiss, hold, useNotifications, type NotificationKind } from '../lib/notifications';

const ICONS: Record<NotificationKind, typeof Info> = { info: Info, success: CircleCheck, error: CircleAlert, timer: Timer };

/** Toast stack in the top-right corner. Mounted once in the app shell. */
export function Notifications() {
    const items = useNotifications();
    return <div className="toasts" aria-live="polite" aria-relevant="additions">
        {items.map(n => { const Icon = ICONS[n.kind]; return <div key={n.id} className={'toast toast-' + n.kind} role={n.kind === 'error' ? 'alert' : 'status'} onMouseEnter={() => hold(n.id, true)} onMouseLeave={() => hold(n.id, false)}>
            <Icon size={17} className="toast-icon" aria-hidden="true"/>
            <div className="toast-body">{n.title && <strong>{n.title}</strong>}<span>{n.message}</span></div>
            <button className="icon toast-close" onClick={() => dismiss(n.id)} aria-label="Dismiss notification"><X size={15}/></button>
            {n.duration > 0 && <i className="toast-countdown" style={{ animationDuration: n.duration + 'ms' }}/>}
        </div>; })}
    </div>;
}
