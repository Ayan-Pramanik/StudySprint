'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { WorkspaceLink as Link } from './WorkspaceLink';
import { BookOpen, Brain, TreeDeciduous, CalendarDays, Crown, Flame, Folder, Heart, Layers, Link2, ListChecks, Lock, Moon, Sparkles, Star, Sunrise, Target, Timer, Trophy } from 'lucide-react';
import { BADGES, CATEGORIES, TIERS, earnedBadges, goalsOf, level, nextBadges, today, week, xp, type Badge, type BadgeIcon } from '../lib/gamification';
import type { WorkspaceSnapshot } from '../lib/study';
import { notify } from '../lib/notifications';
import { localFocusHistory, onFocusRound, pendingRounds, removePendingRound } from './Pomodoro';

/*
 * Gentle gamification UI: level chip, today's goals, badges, goal settings and celebrations.
 * All numbers come from lib/gamification.ts, computed from the workspace.
 */

const ICONS: Record<BadgeIcon, typeof Sparkles> = { tree: TreeDeciduous, spark: Sparkles, layers: Layers, trophy: Trophy, quiz: ListChecks, timer: Timer, note: BookOpen, link: Link2, folder: Folder, calendar: CalendarDays, heart: Heart, star: Star, sunrise: Sunrise, moon: Moon, flame: Flame, target: Target, brain: Brain, crown: Crown };
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* per-device extras only */ } };
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Sidebar: level, title and progress to the next level. */
export function LevelChip({ w }: { w: WorkspaceSnapshot }) {
    const l = level(xp(w).total);
    return <Link href="/achievements" className="level-chip" title={`${l.into} of ${l.needed} XP to level ${l.level + 1}`}>
        <span className="level-number" aria-hidden="true">{l.level}</span>
        <span className="level-text"><strong>Level {l.level} · {l.title}</strong><small>{l.into} / {l.needed} XP</small><i className="level-bar"><b style={{ width: `${Math.round(l.into / l.needed * 100)}%` }}/></i></span>
    </Link>;
}

function Ring({ value, goal, label, unit }: { value: number; goal: number; label: string; unit: string }) {
    const r = 30, c = 2 * Math.PI * r, pct = Math.min(1, goal ? value / goal : 0), done = value >= goal;
    return <div className={'goal-ring' + (done ? ' done' : '')} role="img" aria-label={`${label}: ${value} of ${goal} ${unit}`}>
        <svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r={r} className="track"/><circle cx="36" cy="36" r={r} className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - pct)}/></svg>
        <div><strong>{value}<span>/{goal}</span></strong><small>{label}</small></div>
    </div>;
}

/** Today: daily goals, this week's study days and level progress. Nothing here ever resets to punish a gap. */
export function GoalsPanel({ w }: { w: WorkspaceSnapshot }) {
    const goals = goalsOf(w), t = today(w), wk = week(w), total = xp(w).total, l = level(total);
    return <section className="panel goals-panel" aria-label="Today’s goals">
        <div className="section-heading"><h2>Today’s goals</h2><Link className="text-button" href="/settings#goals">Adjust goals</Link></div>
        <div className="goals-grid">
            <Ring value={t.reviews} goal={goals.reviews} label="reviews" unit="reviews"/>
            <Ring value={t.focusMinutes} goal={goals.focusMinutes} label="focus min" unit="focus minutes"/>
            <div className="goals-week"><div className="week-dots" aria-label={`${wk.studied} study days this week`}>{wk.days.map((d, i) => <span key={d.key} className={(d.studied ? 'on' : '') + (d.today ? ' today' : '') + (d.future ? ' future' : '')} title={d.key}><i/>{WEEKDAYS[i]}</span>)}</div>
                <p><strong>{wk.studied} of {goals.weekDays}</strong> study days this week{wk.studied >= goals.weekDays ? ' · goal met 🎉' : ''}</p>
                <div className="goals-level"><span>Level {l.level} · {l.title}</span><i className="level-bar"><b style={{ width: `${Math.round(l.into / l.needed * 100)}%` }}/></i><small>{l.needed - l.into} XP to level {l.level + 1}</small></div></div>
        </div>
    </section>;
}

/** Progress: level and XP breakdown, what's closest to unlocking, and every badge by category and rank. */
export function AchievementsPanel({ w }: { w: WorkspaceSnapshot }) {
    const [show, setShow] = useState<'all' | 'earned' | 'locked'>('all');
    const x = xp(w), l = level(x.total), earned = earnedBadges(w), next = nextBadges(w);
    const tiers = TIERS.map((name, i) => ({ name, n: BADGES.filter(b => b.tier === i + 1 && earned.has(b.id)).length })).filter(t => t.n);
    const card = (b: Badge) => {
        const Icon = ICONS[b.icon], got = earned.has(b.id), p = b.progress(w), at = w.achievements?.[b.id];
        return <li key={b.id} className={'badge' + (got ? ' earned' : '') + (b.tier ? ' tier-' + b.tier : ' special')}>
            <span className="badge-icon">{got ? <Icon size={20}/> : <Lock size={16}/>}</span>
            <div><strong>{b.name}</strong>{b.tier && <span className="tier-pill">{TIERS[b.tier - 1]}</span>}<small>{b.hint}</small>
                {got ? <small className="badge-date">{at ? 'Unlocked ' + new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unlocked'}</small>
                    : p.need > 1 && <><i className="level-bar small"><b style={{ width: `${Math.round(p.have / p.need * 100)}%` }}/></i><small>{p.have.toLocaleString()} / {p.need.toLocaleString()}</small></>}</div>
        </li>;
    };
    return <section className="panel achievements" aria-label="Level and badges">
        <div className="achievements-head">
            <span className="level-number big" aria-hidden="true">{l.level}</span>
            <div className="grow"><h2>Level {l.level} · {l.title}</h2><i className="level-bar"><b style={{ width: `${Math.round(l.into / l.needed * 100)}%` }}/></i><p className="small">{x.total.toLocaleString()} XP in total · {l.needed - l.into} XP to level {l.level + 1}</p></div>
            <dl className="xp-breakdown"><div><dt>Reviews</dt><dd>{x.reviews.toLocaleString()}</dd></div><div><dt>Quizzes</dt><dd>{x.quizzes.toLocaleString()}</dd></div><div><dt>Focus</dt><dd>{x.focus.toLocaleString()}</dd></div></dl>
        </div>
        {next.length > 0 && <><h3>Closest to unlocking</h3><ul className="next-badges">{next.map(({ badge, have, need }) => { const Icon = ICONS[badge.icon]; return <li key={badge.id}><span className={'badge-icon' + (badge.tier ? ' tier-' + badge.tier : '')}><Icon size={17}/></span><div><strong>{badge.name}{badge.tier ? <span className="tier-pill">{TIERS[badge.tier - 1]}</span> : null}</strong><small>{badge.hint}</small><i className="level-bar small"><b style={{ width: `${Math.round(have / need * 100)}%` }}/></i><small>{have.toLocaleString()} / {need.toLocaleString()} · {Math.round(have / need * 100)}%</small></div></li>; })}</ul></>}
        <div className="badges-bar"><h3>Badges <span className="number">{earned.size} / {BADGES.length}</span></h3>
            {tiers.length > 0 && <span className="tier-summary">{tiers.map(t => <span key={t.name} className={'tier-dot tier-' + (TIERS.indexOf(t.name) + 1)}>{t.n} {t.name}</span>)}</span>}
            <div className="segmented" role="radiogroup" aria-label="Show badges">{(['all', 'earned', 'locked'] as const).map(v => <button key={v} role="radio" aria-checked={show === v} className={show === v ? 'selected' : ''} onClick={() => setShow(v)}>{v === 'all' ? 'All' : v === 'earned' ? 'Unlocked' : 'Locked'}</button>)}</div></div>
        {CATEGORIES.map(category => {
            const all = BADGES.filter(b => b.category === category), list = all.filter(b => show === 'all' || (show === 'earned') === earned.has(b.id));
            if (!list.length) return null;
            return <section key={category} className="badge-category" aria-label={category}><h4>{category} <span className="number">{all.filter(b => earned.has(b.id)).length} / {all.length}</span></h4><ul className="badge-grid">{list.map(card)}</ul></section>;
        })}
        <p className="small muted">Ranks go Bronze, Silver, Gold, Platinum, Diamond, Master, Legend. XP: 10 per review (+5 for a new card), 2 per correct quiz answer, 15 per finished quiz (+25 for a perfect test), 1 per focus minute. Badges stay unlocked even if you later delete what earned them.</p>
    </section>;
}

/** Settings: daily and weekly goals, and celebrations. */
export function GoalsSettings({ w, mutate, busy }: { w: WorkspaceSnapshot; mutate: (a: string, p: object) => Promise<WorkspaceSnapshot>; busy: boolean }) {
    const g = goalsOf(w);
    return <section className="panel goals-settings" id="goals"><h2>Goals and celebrations</h2><p>Gentle targets for each day and week. Missing a day never resets anything.</p>
        <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void mutate('goals', { reviews: Number(f.get('reviews')), focusMinutes: Number(f.get('focusMinutes')), weekDays: Number(f.get('weekDays')), celebrate: f.get('celebrate') === 'on' }).then(() => notify({ kind: 'success', message: 'Goals saved.' })).catch(() => { }); }}>
            <div className="goals-fields">
                <label>Reviews per day<input name="reviews" type="number" min={1} max={500} defaultValue={g.reviews} required/></label>
                <label>Focus minutes per day<input name="focusMinutes" type="number" min={5} max={600} defaultValue={g.focusMinutes} required/></label>
                <label>Study days per week<input name="weekDays" type="number" min={1} max={7} defaultValue={g.weekDays} required/></label>
            </div>
            <label className="checkbox"><input name="celebrate" type="checkbox" defaultChecked={g.celebrate}/>Celebrate badges, level-ups and goals with a notification and confetti</label>
            <button className="primary" disabled={busy}>Save goals</button>
        </form></section>;
}

// ---------- confetti ----------
let bursts = 0;
const burstListeners = new Set<() => void>();
/** A short burst of confetti; skipped when the person prefers reduced motion. */
export function burst() { if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return; bursts++; burstListeners.forEach(l => l()); }
const COLORS = ['#5653ce', '#f2b84b', '#3f8f58', '#e46f5a', '#4aa3df', '#c06bd6'];
export function Confetti() {
    const id = useSyncExternalStore(l => { burstListeners.add(l); return () => { burstListeners.delete(l); }; }, () => bursts, () => 0);
    const [shown, setShown] = useState<number>();
    useEffect(() => { if (!id) return; const show = setTimeout(() => setShown(id), 0), hide = setTimeout(() => setShown(s => s === id ? undefined : s), 1800); return () => { clearTimeout(show); clearTimeout(hide); }; }, [id]);
    if (!shown) return null;
    return <div className="confetti" aria-hidden="true" key={shown}>{Array.from({ length: 36 }, (_, i) => <i key={i} style={{ ['--x' as string]: `${(i * 37) % 100}vw`, ['--d' as string]: `${(i % 6) * 0.08}s`, ['--r' as string]: `${(i * 53) % 360}deg`, ['--s' as string]: `${1.1 + (i % 5) * 0.12}s`, background: COLORS[i % COLORS.length] } as CSSProperties}/>)}</div>;
}

// ---------- background work: focus sync, badge unlocks, celebrations ----------
function deviceId() { let id = read('studysprint-device'); if (!id) { id = crypto.randomUUID(); store('studysprint-device', id); } return id; }

/**
 * Uploads completed focus rounds (and, once per browser, the focus history kept here before syncing
 * existed), records newly earned badges, and celebrates new badges, level-ups and goals met.
 */
export function useGamification({ w, account, send }: { w?: WorkspaceSnapshot; account: string; /** Saves quietly, queued behind the person's own saves. */ send: (body: { action: string } & Record<string, unknown>) => Promise<void> }) {
    const post = send;
    const syncing = useRef(false);
    const syncFocus = useCallback(async () => {
        if (!account || syncing.current) return;
        syncing.current = true;
        try {
            const flag = 'ss-focus-imported:' + account;
            if (!read(flag)) {
                // Rounds still waiting to upload are in the local history too; leave them out of the backfill.
                const days: Record<string, { ms: number; rounds: number }> = structuredClone(localFocusHistory());
                for (const r of pendingRounds()) { const d = days[new Date(r.at).toLocaleDateString('en-CA')]; if (d) { d.ms = Math.max(0, d.ms - r.ms); d.rounds = Math.max(0, d.rounds - 1); } }
                const clean = Object.fromEntries(Object.entries(days).filter(([, d]) => d.ms > 0));
                if (Object.keys(clean).length) await post({ action: 'focusImport', device: deviceId(), days: clean });
                store(flag, '1');
            }
            for (const round of pendingRounds()) {
                const { withered, ...data } = round;
                await post({ action: withered ? 'witherTree' : 'focusRound', ...data });
                removePendingRound(round.id);
            }
        } catch { /* offline or busy: retried on the next round, reconnect or minute */ }
        finally { syncing.current = false; }
    }, [account, post]);
    const loaded = !!w;
    useEffect(() => {
        if (!loaded) return;
        void syncFocus();
        const off = onFocusRound(() => void syncFocus());
        const online = () => void syncFocus();
        window.addEventListener('online', online);
        const timer = setInterval(() => { if (pendingRounds().length) void syncFocus(); }, 60000);
        return () => { off(); window.removeEventListener('online', online); clearInterval(timer); };
    }, [loaded, syncFocus]);

    const unlocking = useRef(false);
    useEffect(() => {
        if (!w || !account) return;
        const goals = goalsOf(w), earned = earnedBadges(w), total = xp(w).total, lv = level(total);
        const seenKey = 'ss-badges-seen:' + account, levelKey = 'ss-level-seen:' + account;
        const seenRaw = read(seenKey), first = seenRaw === null;
        let seen: string[] = []; try { seen = JSON.parse(seenRaw || '[]'); } catch { /* start over */ }
        const fresh = [...earned].filter(id => !seen.includes(id));
        if (fresh.length || first) store(seenKey, JSON.stringify([...new Set([...seen, ...earned])]));
        const lastLevel = Number(read(levelKey) || 0);
        if (lv.level > lastLevel) store(levelKey, String(lv.level));
        // Goals met: once per day (and week) on this device.
        const t = today(w), wk = week(w), messages: { title: string; message: string }[] = [];
        const goal = (key: string, met: boolean, title: string, message: string) => { const k = `ss-goal:${account}:${key}`; if (!met || read(k)) return; store(k, '1'); if (!first) messages.push({ title, message }); };
        goal(`${t.key}:reviews`, t.reviews >= goals.reviews, 'Daily review goal reached', `${t.reviews} reviews today. Nicely done.`);
        goal(`${t.key}:focus`, t.focusMinutes >= goals.focusMinutes, 'Daily focus goal reached', `${t.focusMinutes} focused minutes today.`);
        goal(`${wk.days[0].key}:week`, wk.studied >= goals.weekDays, 'Weekly goal reached', `You studied on ${wk.studied} days this week.`);
        if (!first) {
            const unlocked = fresh.map(id => BADGES.find(b => b.id === id)).filter((b): b is Badge => !!b);
            // Several at once (e.g. new badges added to the app) get one summary instead of a pile of toasts.
            if (unlocked.length > 3) messages.unshift({ title: `${unlocked.length} badges unlocked`, message: unlocked.slice(0, 4).map(b => b.name).join(', ') + (unlocked.length > 4 ? ' and more. See them on Progress.' : '.') });
            else for (const b of unlocked) messages.unshift({ title: `Badge unlocked: ${b.name}${b.tier ? ` (${TIERS[b.tier - 1]})` : ''}`, message: b.hint + '.' });
            if (lastLevel && lv.level > lastLevel) messages.unshift({ title: 'Level up!', message: `You reached level ${lv.level} · ${lv.title}.` });
        }
        if (goals.celebrate && messages.length) { messages.slice(0, 4).forEach(m => notify({ kind: 'success', ...m })); burst(); }
        // Record unlock dates so a badge stays earned even if what earned it is deleted later.
        const missing = [...earned].filter(id => !w.achievements?.[id]);
        if (missing.length && !unlocking.current) { unlocking.current = true; void post({ action: 'unlock', ids: missing }).catch(() => { }).finally(() => { unlocking.current = false; }); }
    }, [w, account, post]);
}

export const xpForReview = (isNew: boolean) => 10 + (isNew ? 5 : 0);
