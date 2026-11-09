'use client';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, CloudSun, Coins, Lock, Mountain, Sparkles, Sprout, TreeDeciduous } from 'lucide-react';
import { LANDS, SEASONALS, SHOP, SPECIALS, SPECIAL_UNLOCKS, WEATHERS, canGrow, groveFacts, groveFor, groveOf, landById, seasonOf, speciesById, weatherById, type Period, type Species } from '../lib/grove';
import type { GroveTree } from '../lib/study';
import { day, type WorkspaceSnapshot } from '../lib/study';

/*
 * The focus grove: a tree grows inside the timer while you focus, and every finished round adds a
 * tree to your grove. Trees are drawn here as simple SVG shapes in each kind's own colours.
 */

/** Darkens or lightens a #rrggbb colour by `amount` (−1 … 1). */
function shade(hex: string, amount: number) {
    const n = parseInt(hex.slice(1), 16), f = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(f).map(c => c.toString(16).padStart(2, '0')).join('');
}

function Canopy({ s }: { s: Species }) {
    const dark = shade(s.leaves, -0.18), light = s.accent;
    switch (s.shape) {
        case 'cone': return <g><path d="M50 22 L74 62 L26 62Z" fill={dark}/><path d="M50 34 L78 78 L22 78Z" fill={s.leaves}/><path d="M50 50 L82 94 L18 94Z" fill={dark}/><path d="M50 22 L58 36 L46 40Z" fill={light} opacity=".55"/></g>;
        case 'tall': return <g><ellipse cx="50" cy="48" rx="20" ry="30" fill={s.leaves}/><ellipse cx="44" cy="40" rx="10" ry="15" fill={light} opacity=".6"/></g>;
        case 'palm': return <g stroke={s.leaves} strokeWidth="7" strokeLinecap="round" fill="none"><path d="M52 34 Q30 26 16 40"/><path d="M52 34 Q74 24 86 40"/><path d="M52 34 Q38 14 26 18"/><path d="M52 34 Q66 12 80 18"/><path d="M52 34 Q52 18 50 10" stroke={light}/><circle cx="50" cy="38" r="4" fill="#8a5a35" stroke="none"/><circle cx="57" cy="39" r="4" fill="#8a5a35" stroke="none"/></g>;
        case 'willow': return <g><ellipse cx="50" cy="42" rx="34" ry="24" fill={s.leaves}/>{[22, 30, 38, 46, 54, 62, 70, 78].map(x => <path key={x} d={`M${x} 46 Q${x + 2} 70 ${x - 1} ${84 - Math.abs(50 - x) / 3}`} stroke={dark} strokeWidth="3" fill="none" strokeLinecap="round"/>)}<ellipse cx="42" cy="34" rx="14" ry="8" fill={light} opacity=".55"/></g>;
        case 'bush': return <g><ellipse cx="50" cy="86" rx="34" ry="18" fill={s.leaves}/><ellipse cx="36" cy="80" rx="16" ry="12" fill={dark}/><ellipse cx="60" cy="76" rx="18" ry="13" fill={s.leaves}/>{[[36, 82], [56, 74], [64, 88], [44, 92], [70, 80], [30, 90]].map(([x, y]) => <circle key={x + '-' + y} cx={x} cy={y} r="3.2" fill={light}/>)}</g>;
        case 'crystal': return <g><path d="M50 14 L64 44 L50 70 L36 44Z" fill={s.leaves}/><path d="M36 44 L26 30 L30 58 L42 66Z" fill={light}/><path d="M64 44 L76 28 L72 58 L58 66Z" fill={shade(s.leaves, -0.15)}/><path d="M50 14 L56 30 L50 40Z" fill="#fff" opacity=".6"/></g>;
        case 'twin': return <g><circle cx="34" cy="50" r="18" fill={dark}/><circle cx="66" cy="44" r="21" fill={s.leaves}/><circle cx="60" cy="36" r="9" fill={light} opacity=".6"/><circle cx="29" cy="44" r="7" fill={light} opacity=".45"/></g>;
        case 'blossom': return <g><circle cx="50" cy="44" r="24" fill={s.leaves}/><circle cx="34" cy="54" r="15" fill={s.leaves}/><circle cx="66" cy="54" r="15" fill={s.leaves}/>{[[40, 36], [58, 32], [50, 48], [32, 56], [68, 54], [46, 60], [60, 46]].map(([x, y]) => <circle key={x + '-' + y} cx={x} cy={y} r="3.4" fill={light}/>)}</g>;
        case 'fruit': return <g><circle cx="50" cy="40" r="23" fill={s.leaves}/><circle cx="33" cy="52" r="16" fill={dark}/><circle cx="67" cy="52" r="16" fill={s.leaves}/><circle cx="44" cy="31" r="8" fill="#fff" opacity=".25"/>{[[40, 42], [58, 34], [64, 54], [36, 58], [50, 54], [28, 48]].map(([x, y]) => <g key={x + '-' + y}><circle cx={x} cy={y} r="4.2" fill={light}/><circle cx={x - 1.3} cy={y - 1.3} r="1.2" fill="#fff" opacity=".7"/></g>)}</g>;
        case 'cactus': return <g><rect x="42" y="44" width="16" height="64" rx="8" fill={s.leaves}/><path d="M42 74 H34 Q28 74 28 66 V56 Q28 52 32 52 Q36 52 36 56 V66 H42" fill={s.leaves}/><path d="M58 64 H66 Q72 64 72 56 V48 Q72 44 68 44 Q64 44 64 48 V58 H58" fill={dark}/>{[52, 64, 76, 88, 100].map(y => <path key={y} d={`M46 ${y} h2 M52 ${y + 4} h2`} stroke="#e9f5d9" strokeWidth="1.4"/>)}<circle cx="50" cy="42" r="5" fill={light}/><circle cx="50" cy="42" r="2" fill="#ffe27a"/></g>;
        case 'bamboo': return <g>{[[38, 30, s.trunk], [50, 18, shade(s.trunk, -0.12)], [62, 36, s.trunk]].map(([x, top, c]) => <g key={x as number}><rect x={(x as number) - 3.5} y={top as number} width="7" height={108 - (top as number)} rx="2" fill={c as string}/>{Array.from({ length: 5 }, (_, i) => <rect key={i} x={(x as number) - 4} y={(top as number) + 12 + i * 16} width="8" height="2" fill={shade(s.trunk, -0.3)}/>)}<path d={`M${x} ${(top as number) + 6} q10 -6 16 -2 q-8 4 -16 2Z M${x} ${(top as number) + 20} q-10 -6 -16 -2 q8 4 16 2Z`} fill={s.leaves}/></g>)}<path d="M50 30 q9 -10 18 -8 q-8 8 -18 8Z" fill={light}/></g>;
        case 'cypress': return <g><path d="M50 8 Q66 44 62 92 Q50 98 38 92 Q34 44 50 8Z" fill={s.leaves}/><path d="M50 16 Q58 44 56 86 Q50 88 47 86 Q46 50 50 16Z" fill={light} opacity=".45"/></g>;
        case 'snowpine': return <g><path d="M50 18 L74 60 L26 60Z" fill={s.leaves}/><path d="M50 32 L80 78 L20 78Z" fill={dark}/><path d="M50 48 L84 96 L16 96Z" fill={s.leaves}/><path d="M50 18 L58 32 Q50 36 42 32Z M30 60 Q50 66 70 60 L66 54 Q50 58 34 54Z M24 78 Q50 84 76 78 L72 72 Q50 76 28 72Z M20 96 Q50 102 80 96 L76 90 Q50 94 24 90Z" fill="#fff"/></g>;
        case 'toadstool': return <g><path d="M42 108 Q40 76 44 60 H56 Q60 76 58 108Z" fill={s.trunk}/><path d="M14 62 Q14 24 50 22 Q86 24 86 62 Q50 70 14 62Z" fill={s.leaves}/><path d="M18 60 Q50 66 82 60" stroke={shade(s.leaves, -0.25)} strokeWidth="2" fill="none"/>{[[34, 40, 5], [52, 32, 4], [66, 44, 6], [44, 52, 3.5], [26, 54, 3]].map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} fill={light}/>)}</g>;
        case 'acacia': return <g><path d="M50 108 L50 70 L36 50 M50 76 L64 52 M50 70 L50 52" stroke={s.trunk} strokeWidth="6" strokeLinecap="round" fill="none"/><ellipse cx="50" cy="46" rx="40" ry="10" fill={s.leaves}/><ellipse cx="44" cy="38" rx="28" ry="8" fill={dark}/><ellipse cx="58" cy="36" rx="20" ry="6" fill={light}/></g>;
        case 'bonsai': return <g><path d="M30 96 H70 L66 108 H34Z" fill={light}/><rect x="28" y="92" width="44" height="6" rx="2" fill={shade(light, -0.2)}/><path d="M50 92 Q44 80 52 72 Q60 64 50 54 Q44 48 48 40" stroke={s.trunk} strokeWidth="6" fill="none" strokeLinecap="round"/><path d="M52 72 Q62 70 68 62" stroke={s.trunk} strokeWidth="4" fill="none" strokeLinecap="round"/><ellipse cx="46" cy="38" rx="18" ry="9" fill={s.leaves}/><ellipse cx="70" cy="58" rx="13" ry="7" fill={dark}/><ellipse cx="32" cy="56" rx="12" ry="6" fill={s.leaves}/></g>;
        case 'baobab': return <g><path d="M36 108 Q30 80 40 50 H60 Q70 80 64 108Z" fill={s.trunk}/><path d="M42 54 L32 38 M50 52 L50 32 M58 54 L68 38" stroke={s.trunk} strokeWidth="5" strokeLinecap="round"/><ellipse cx="32" cy="34" rx="12" ry="7" fill={s.leaves}/><ellipse cx="50" cy="28" rx="14" ry="8" fill={dark}/><ellipse cx="68" cy="34" rx="12" ry="7" fill={s.leaves}/><path d="M44 70 Q46 84 44 96 M56 66 Q54 80 57 98" stroke={shade(s.trunk, -0.2)} strokeWidth="1.5" fill="none"/></g>;
        case 'heart': return <g><path d="M50 78 C20 58 18 30 34 24 C44 20 50 28 50 34 C50 28 56 20 66 24 C82 30 80 58 50 78Z" fill={s.leaves}/><path d="M36 30 C42 28 46 32 46 36" stroke={light} strokeWidth="4" fill="none" strokeLinecap="round"/></g>;
        case 'topiary': return <g><path d="M36 108 H64 L60 96 H40Z" fill={light}/><rect x="48" y="40" width="4" height="58" fill={s.trunk}/><circle cx="50" cy="84" r="13" fill={dark}/><circle cx="50" cy="60" r="11" fill={s.leaves}/><circle cx="50" cy="40" r="9" fill={dark}/><circle cx="50" cy="26" r="6" fill={s.leaves}/></g>;
        case 'rainbow': return <g>{['#ef5350', '#ffa726', '#ffee58', '#66bb6a', '#42a5f5', '#ab47bc'].map((c, i) => <circle key={c} cx={30 + (i % 3) * 20} cy={36 + Math.floor(i / 3) * 18} r="15" fill={c}/>)}<circle cx="50" cy="44" r="9" fill="#fff" opacity=".35"/></g>;
        case 'starry': return <g><circle cx="50" cy="40" r="24" fill={s.leaves}/><circle cx="33" cy="54" r="15" fill={shade(s.leaves, -0.2)}/><circle cx="67" cy="54" r="15" fill={s.leaves}/>{[[40, 34], [58, 28], [62, 48], [36, 54], [50, 50], [70, 58], [28, 46]].map(([x, y], i) => <path key={i} d={`M${x} ${y - 4} L${x + 1.2} ${y - 1.2} L${x + 4} ${y} L${x + 1.2} ${y + 1.2} L${x} ${y + 4} L${x - 1.2} ${y + 1.2} L${x - 4} ${y} L${x - 1.2} ${y - 1.2}Z`} fill={light}/>)}<circle cx="44" cy="28" r="3" fill="#fff" opacity=".7"/></g>;
        case 'moon': return <g><circle cx="50" cy="42" r="24" fill={s.leaves}/><circle cx="33" cy="54" r="15" fill={dark}/><circle cx="67" cy="54" r="15" fill={s.leaves}/><path d="M58 22 A12 12 0 1 0 70 38 A9 9 0 1 1 58 22Z" fill={light}/>{[[34, 38], [46, 56], [62, 60]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="1.6" fill="#fff"/>)}</g>;
        case 'dawn': return <g><circle cx="50" cy="44" r="30" fill={light} opacity=".35"/><circle cx="50" cy="42" r="22" fill={s.leaves}/><circle cx="34" cy="54" r="14" fill={shade(s.leaves, -0.12)}/><circle cx="66" cy="54" r="14" fill={s.leaves}/><circle cx="50" cy="36" r="9" fill={light}/></g>;
        case 'flame': return <g><path d="M50 8 Q72 34 66 58 Q78 50 76 40 Q88 66 66 86 Q50 96 34 86 Q12 66 24 40 Q22 50 34 58 Q28 34 50 8Z" fill={s.leaves}/><path d="M50 30 Q62 48 58 66 Q66 62 66 56 Q70 74 50 82 Q30 74 34 56 Q34 62 42 66 Q38 48 50 30Z" fill={light}/></g>;
        case 'storm': return <g><ellipse cx="50" cy="40" rx="30" ry="18" fill={s.leaves}/><ellipse cx="34" cy="50" rx="16" ry="11" fill={dark}/><ellipse cx="66" cy="50" rx="16" ry="11" fill={s.leaves}/><path d="M54 30 L42 50 H51 L44 68 L62 44 H53 L60 30Z" fill={light}/></g>;
        case 'ancient': return <g><path d="M38 108 Q34 80 42 64 Q36 58 30 60 M62 108 Q66 82 58 64 Q64 58 70 60" stroke={s.trunk} strokeWidth="5" fill="none"/><path d="M40 108 Q36 82 44 60 H56 Q64 82 60 108Z" fill={s.trunk}/><path d="M44 74 Q50 70 56 76 M46 90 Q50 86 55 92" stroke={shade(s.trunk, -0.3)} strokeWidth="1.8" fill="none"/><circle cx="50" cy="38" r="26" fill={s.leaves}/><circle cx="28" cy="50" r="17" fill={dark}/><circle cx="72" cy="50" r="17" fill={s.leaves}/><circle cx="42" cy="28" r="9" fill={light} opacity=".6"/><path d="M44 62 Q46 70 43 76 M58 64 Q57 70 59 74" stroke={light} strokeWidth="3" fill="none" strokeLinecap="round"/></g>;
        case 'cloud': return <g><circle cx="38" cy="46" r="15" fill={s.leaves}/><circle cx="54" cy="38" r="18" fill={s.leaves}/><circle cx="68" cy="48" r="13" fill={s.leaves}/><rect x="30" y="46" width="44" height="14" rx="7" fill={s.leaves}/><path d="M32 56 Q50 64 70 56" stroke={light} strokeWidth="3" fill="none"/><circle cx="48" cy="34" r="5" fill={light} opacity=".7"/></g>;
        case 'coral': return <g stroke={s.trunk} strokeLinecap="round" fill="none"><path d="M50 108 L50 70" strokeWidth="8"/><path d="M50 82 Q34 72 32 50 M50 74 Q66 66 68 44 M50 70 Q48 50 54 32 M32 50 Q24 44 24 34 M32 50 Q38 40 36 30 M68 44 Q76 36 76 26 M68 44 Q62 34 64 26" strokeWidth="6" stroke={s.leaves}/>{[[24, 32], [36, 28], [54, 30], [76, 24], [64, 24]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="4" fill={light} stroke="none"/>)}</g>;
        case 'firefly': return <g><circle cx="50" cy="42" r="24" fill={s.leaves}/><circle cx="32" cy="54" r="15" fill={shade(s.leaves, -0.2)}/><circle cx="68" cy="54" r="15" fill={s.leaves}/>{[[38, 34, 2.6], [58, 30, 2.2], [64, 50, 2.8], [30, 56, 2.2], [48, 58, 2.4], [74, 38, 2], [22, 40, 2]].map(([x, y, r]) => <g key={x}><circle cx={x} cy={y} r={r * 2.2} fill={light} opacity=".25"/><circle cx={x} cy={y} r={r} fill={light}/></g>)}</g>;
        case 'clover': return <g>{[[50, 26], [33, 44], [67, 44], [50, 58]].map(([x, y], i) => <g key={i}><circle cx={x - 7} cy={y} r="11" fill={i % 2 ? dark : s.leaves}/><circle cx={x + 7} cy={y} r="11" fill={i % 2 ? dark : s.leaves}/><path d={`M${x - 16} ${y + 2} Q${x} ${y + 22} ${x + 16} ${y + 2}Z`} fill={i % 2 ? dark : s.leaves}/></g>)}<circle cx="50" cy="44" r="6" fill={light}/></g>;
        case 'treasure': return <g><circle cx="50" cy="40" r="23" fill={s.leaves}/><circle cx="33" cy="52" r="15" fill={dark}/><circle cx="67" cy="52" r="15" fill={s.leaves}/>{[[38, 36], [56, 30], [64, 48], [36, 54], [50, 50], [26, 46], [72, 58]].map(([x, y]) => <g key={x}><circle cx={x} cy={y} r="4.6" fill={light}/><circle cx={x} cy={y} r="2.4" fill={shade(light, -0.25)}/></g>)}</g>;
        case 'sunflower': return <g><path d="M50 108 Q48 80 50 44" stroke={s.trunk} strokeWidth="5" fill="none"/><path d="M50 84 Q36 76 32 66 Q44 68 50 80Z M50 72 Q64 64 68 54 Q56 56 50 68Z" fill={s.trunk}/>{Array.from({ length: 14 }, (_, i) => <ellipse key={i} cx="50" cy="20" rx="5" ry="12" fill={s.leaves} transform={`rotate(${i * 360 / 14} 50 32)`}/>)}<circle cx="50" cy="32" r="11" fill={light}/><circle cx="47" cy="29" r="2" fill={shade(light, 0.3)}/></g>;
        case 'frost': return <g><path d="M50 18 L74 60 L26 60Z" fill={s.leaves}/><path d="M50 32 L80 78 L20 78Z" fill={dark}/><path d="M50 48 L84 96 L16 96Z" fill={s.leaves}/><path d="M34 56 Q50 64 68 54 M28 74 Q50 84 74 72 M22 92 Q50 100 80 90" stroke="#fff" strokeWidth="1.4" fill="none" opacity=".8"/>{[[40, 59], [58, 58], [32, 77], [50, 80], [68, 75], [26, 94], [46, 98], [62, 97], [76, 92]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.4" fill={i % 3 ? light : '#ff7a7a'}/>)}<path d="M50 10 l2.4 5 5.4 .6 -4 3.6 1.2 5.4 -5-2.8 -5 2.8 1.2-5.4 -4-3.6 5.4-.6Z" fill="#ffe27a"/></g>;
        case 'ember': return <g><circle cx="50" cy="40" r="23" fill={s.leaves}/><circle cx="33" cy="52" r="16" fill={shade(s.leaves, -0.15)}/><circle cx="67" cy="52" r="16" fill={light}/><circle cx="44" cy="32" r="8" fill={light} opacity=".6"/>{[[22, 78, 20], [76, 84, -30], [64, 100, 45], [32, 96, -15]].map(([x, y, r]) => <path key={x} d={`M${x} ${y} q4 -6 8 0 q-4 6 -8 0Z`} fill={x % 2 ? light : s.leaves} transform={`rotate(${r} ${x} ${y})`}/>)}</g>;
        case 'guardian': return <g><path d="M36 108 Q32 72 44 54 H56 Q68 72 64 108Z" fill={s.trunk}/><circle cx="45" cy="78" r="2.6" fill={light}/><circle cx="55" cy="78" r="2.6" fill={light}/><path d="M45 88 Q50 92 55 88" stroke={light} strokeWidth="2" fill="none" strokeLinecap="round"/><path d="M50 6 L78 40 L68 40 L84 62 L16 62 L32 40 L22 40Z" fill={s.leaves}/><path d="M50 14 L64 34 L36 34Z" fill={light} opacity=".45"/></g>;
        default: return <g><circle cx="50" cy="40" r="22" fill={s.leaves}/><circle cx="34" cy="52" r="16" fill={dark}/><circle cx="66" cy="52" r="16" fill={s.leaves}/><circle cx="44" cy="32" r="9" fill={light} opacity=".55"/></g>;
    }
}

function Trunk({ s }: { s: Species }) {
    if (['bush', 'cactus', 'bamboo', 'toadstool', 'acacia', 'bonsai', 'baobab', 'topiary', 'ancient', 'coral', 'sunflower', 'guardian'].includes(s.shape)) return null;
    if (s.shape === 'frost') return <rect x="46" y="84" width="8" height="24" rx="2" fill={s.trunk}/>;
    if (s.shape === 'palm') return <path d="M50 108 Q46 70 52 36" stroke={s.trunk} strokeWidth="7" fill="none" strokeLinecap="round"/>;
    if (s.shape === 'twin') return <g fill={s.trunk}><rect x="31" y="60" width="6" height="48" rx="2"/><rect x="63" y="56" width="7" height="52" rx="2"/></g>;
    return <g><rect x="46" y={s.shape === 'cone' ? 84 : 56} width="8" height={s.shape === 'cone' ? 24 : 52} rx="2" fill={s.trunk}/>{s.shape === 'tall' && [64, 74, 86, 96].map(y => <rect key={y} x={y % 20 ? 46 : 50} y={y} width="4" height="2" fill="#4a4a4a" opacity=".6"/>)}</g>;
}

/**
 * One tree. `progress` (0–1) picks the growth stage: a seed, a sprout, a sapling, then a tree that
 * keeps growing to full size. A withered tree is bare and grey.
 */
export function TreeArt({ species, progress = 1, withered = false, size = 64, title, x, y }: { species: string; progress?: number; withered?: boolean; size?: number; title?: string; /** Position when drawn inside another SVG. */ x?: number; y?: number }) {
    const s = speciesById(species), p = Math.max(0, Math.min(1, progress));
    const ground = <ellipse cx="50" cy="109" rx="30" ry="6" fill={withered ? '#9b8f80' : '#9b7653'} opacity=".55"/>;
    let body;
    if (withered) body = <g stroke="#8b8378" strokeWidth="4" strokeLinecap="round" fill="none"><path d="M50 108 L51 62"/><path d="M51 80 L36 66"/><path d="M51 72 L66 58"/><path d="M51 64 L44 52"/><path d="M36 66 L32 60"/><path d="M66 58 L71 54"/><circle cx="40" cy="104" r="2" fill="#a59b8d" stroke="none"/><circle cx="60" cy="105" r="2.4" fill="#a59b8d" stroke="none"/></g>;
    else if (p < 0.12) body = <g><ellipse cx="50" cy="104" rx="10" ry="5" fill="#7a5a3a"/><ellipse cx="50" cy="100" rx="4" ry="3" fill="#c8a26b"/></g>;
    else if (p < 0.35) { const k = 0.6 + (p - 0.12) * 2; body = <g transform={`translate(50 108) scale(${k}) translate(-50 -108)`}><path d="M50 108 Q49 96 50 86" stroke="#5d8f3e" strokeWidth="3" fill="none"/><path d="M50 92 Q40 86 38 78 Q48 80 50 90Z" fill={s.shape === 'blossom' || s.shape === 'crystal' ? s.leaves : '#6dbb6a'}/><path d="M50 88 Q60 80 63 72 Q52 74 50 86Z" fill={s.shape === 'blossom' || s.shape === 'crystal' ? s.accent : '#4f9a52'}/></g>; }
    else { const k = 0.4 + 0.6 * ((p - 0.35) / 0.65); body = <g transform={`translate(50 108) scale(${k}) translate(-50 -108)`}><Trunk s={s}/><Canopy s={s}/></g>; }
    return <svg viewBox="0 0 100 116" x={x} y={y} width={size} height={size * 1.16} role="img" aria-label={title || (withered ? `Withered ${s.name}` : s.name)} className={'tree-art' + (withered ? ' withered' : '')}>{title && <title>{title}</title>}{ground}{body}</svg>;
}

/** A small deterministic shuffle, so trees fill the plot in a natural-looking order that stays put. */
function scatter(n: number) {
    const cells = Array.from({ length: n * n }, (_, i) => i);
    let seed = 7;
    for (let i = cells.length - 1; i > 0; i--) { seed = (seed * 9301 + 49297) % 233280; const j = Math.floor(seed / 233280 * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    return cells;
}

/**
 * An isometric (3-D) square plot with a tree in a cell for every focus round in the period:
 * grown trees in their own kind, withered ones bare and grey. Grows with the number of trees.
 */
/** Animated weather over the grove (CSS only; still when the person prefers reduced motion). */
export function WeatherLayer({ weather }: { weather: string }) {
    const count = ({ rain: 46, snow: 36, petals: 22, breeze: 16, fireflies: 22, stars: 48, mist: 3, aurora: 3, sunny: 1, rainbow: 1 } as Record<string, number>)[weather] || 0;
    if (!count) return null;
    return <div className={'weather weather-' + weather} aria-hidden="true">{Array.from({ length: count }, (_, i) => <i key={i} style={{ ['--x' as string]: `${(i * 37 + 11) % 100}%`, ['--y' as string]: `${(i * 53 + 7) % 70}%`, ['--d' as string]: `${((i * 29) % 40) / 10}s`, ['--s' as string]: `${0.8 + ((i * 17) % 10) / 10}`, ['--t' as string]: `${2.2 + ((i * 13) % 30) / 10}s` } as CSSProperties}/>)}</div>;
}

export function GroveIsland({ trees, empty, land = 'meadow', weather = 'clear' }: { trees: GroveTree[]; empty: string; land?: string; weather?: string }) {
    const L = landById(land), W_ = weatherById(weather);
    const night = L.dark || W_.dark;
    const n = Math.min(14, Math.max(4, Math.ceil(Math.sqrt(trees.length))));
    const shown = trees.slice(0, n * n), extra = trees.length - shown.length;
    const tw = 56, th = 28, depth = L.id === 'sky' ? 34 : 18, treeSize = 46;
    const top = treeSize * 1.05, W = n * tw + 20, H = top + n * th + depth + 10, cx = W / 2;
    const order = useMemo(() => scatter(n), [n]);
    const at = (i: number, j: number) => ({ x: cx + (i - j) * tw / 2, y: top + (i + j + 1) * th / 2 });
    const left = { x: cx - n * tw / 2, y: top + n * th / 2 }, right = { x: cx + n * tw / 2, y: top + n * th / 2 }, bottom = { x: cx, y: top + n * th };
    // Fill cells in scattered order, then draw back to front so nearer trees overlap farther ones.
    const placed = shown.map((t, k) => { const cell = order[k]; return { t, i: cell % n, j: Math.floor(cell / n) }; }).sort((a, b) => (a.i + a.j) - (b.i + b.j) || a.i - b.i);
    const sky = night && !L.dark ? ['#1b2340', '#0f1424'] : L.sky;
    return <div className={'grove-island' + (night ? ' night' : '')} style={{ background: `radial-gradient(ellipse at 50% 85%, ${sky[1]} 0, ${sky[0]} 75%)` }}>
        <WeatherLayer weather={W_.id}/>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${trees.filter(t => !t.withered).length} trees grown and ${trees.filter(t => t.withered).length} withered`}>
            <polygon style={{ fill: L.left }} points={`${left.x},${left.y} ${bottom.x},${bottom.y} ${bottom.x},${bottom.y + depth} ${left.x},${left.y + depth}`}/>
            <polygon style={{ fill: L.right }} points={`${bottom.x},${bottom.y} ${right.x},${right.y} ${right.x},${right.y + depth} ${bottom.x},${bottom.y + depth}`}/>
            {L.id === 'sky' && <path style={{ fill: L.right }} d={`M${left.x + 20},${left.y + depth} L${cx},${bottom.y + depth + 46} L${right.x - 20},${right.y + depth} Z`} opacity=".85"/>}
            {Array.from({ length: n * n }, (_, k) => { const i = k % n, j = Math.floor(k / n), c = at(i, j); return <polygon key={k} className={'island-tile' + (L.id === 'volcano' ? ' glow' : '')} style={{ fill: (i + j) % 2 ? L.alt : L.tile, stroke: L.edge }} points={`${c.x},${c.y - th / 2} ${c.x + tw / 2},${c.y} ${c.x},${c.y + th / 2} ${c.x - tw / 2},${c.y}`}/>; })}
            {placed.map(({ t, i, j }) => { const c = at(i, j); return <TreeArt key={t.id} species={t.species} withered={t.withered} size={treeSize} x={c.x - treeSize / 2} y={c.y - treeSize * 1.16 * (109 / 116)} title={`${t.withered ? 'Withered ' : ''}${speciesById(t.species).name} · ${t.minutes} min · ${when(t.at)}`}/>; })}
        </svg>
        {!trees.length && <p className="island-empty">{empty}</p>}
        {extra > 0 && <p className="small island-more">+{extra} more trees not shown</p>}
    </div>;
}

const PERIODS: { value: Period; label: string; empty: string }[] = [
    { value: 'day', label: 'Day', empty: 'No trees on this day yet.' },
    { value: 'week', label: 'Week', empty: 'No trees this week yet.' },
    { value: 'month', label: 'Month', empty: 'No trees this month yet.' },
    { value: 'year', label: 'Year', empty: 'No trees this year yet.' },
];

/** The grove for a day, week, month or year: the 3-D plot, totals and a small chart. */
function GroveByPeriod({ trees, zone, land, weather }: { trees: GroveTree[]; zone: string; land?: string; weather?: string }) {
    const [period, setPeriod] = useState<Period>('day'), [offset, setOffset] = useState(0);
    const todayKey = day(new Date(), zone);
    const view = groveFor(trees, period, todayKey, offset, at => day(at, zone), zone);
    const top = Math.max(...view.slots.map(s => s.minutes));
    // A round number of minutes for the chart's top line.
    const step = [10, 15, 30, 60, 120, 240, 480, 960, 1920, 3840].find(v => v * 4 >= top) || Math.ceil(top / 4 / 60) * 60, max = step * 4;
    const label = (m: number) => m >= 60 ? `${Math.round(m / 6) / 10} h` : `${m} m`;
    const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const info = PERIODS.find(p => p.value === period)!;
    const hours = Math.floor(view.minutes / 60), mins = view.minutes % 60;
    return <div className="grove-period">
        <div className="grove-period-bar">
            <div className="pill-tabs" role="radiogroup" aria-label="Grove period">{PERIODS.map(p => <button key={p.value} role="radio" aria-checked={period === p.value} className={period === p.value ? 'selected' : ''} onClick={() => { setPeriod(p.value); setOffset(0); }}>{p.label}</button>)}</div>
            <div className="period-nav"><button className="icon" onClick={() => setOffset(o => o - 1)} aria-label={`Previous ${period}`}><ChevronLeft size={16}/></button><strong>{view.label}</strong><button className="icon" onClick={() => setOffset(o => o + 1)} disabled={offset >= 0} aria-label={`Next ${period}`}><ChevronRight size={16}/></button>{offset < 0 && <button className="text-button" onClick={() => setOffset(0)}>Today</button>}</div>
        </div>
        <div className="grove-period-body">
            <GroveIsland trees={view.trees} empty={info.empty} land={land} weather={weather}/>
            <div className="grove-period-side">
                <div className="grove-counts"><div className="grown"><strong>{view.grown}</strong><small>{view.grown === 1 ? 'tree grown' : 'trees grown'}</small></div><div className="withered"><strong>{view.withered}</strong><small>withered</small></div><div><strong>{hours ? `${hours} h ${mins} m` : `${mins} m`}</strong><small>focused</small></div></div>
                <h3 className="grove-chart-title">Focused time</h3>
                <p className="small">Total: <strong>{hours ? `${hours} h ${mins} min` : `${mins} min`}</strong> in {plural(view.grown, 'finished round')}</p>
                <div className="grove-chart-wrap"><div className="grove-axis" aria-hidden="true">{[4, 3, 2, 1, 0].map(k => <span key={k}>{label(step * k)}</span>)}</div>
                    <div className="grove-chart" aria-label={`Focused minutes by ${period === 'day' ? 'hour' : period === 'year' ? 'month' : 'day'}`}>{view.slots.map(s => <div key={s.key} className="grove-bar" title={`${s.minutes} min focused · ${s.grown} grown${s.withered ? `, ${s.withered} withered` : ''}`}><span className="stack"><i className="g" style={{ height: `${s.minutes / max * 100}%` }}/>{s.withered > 0 && <i className="w-dot"/>}</span><small>{s.label}</small></div>)}</div></div>
                {period !== 'day' && view.bestWeekday >= 0 && <p className="small best-day">Most focused day: <strong>{WEEKDAY_NAMES[view.bestWeekday]}</strong> ({label(view.weekdays[view.bestWeekday])})</p>}
                <p className="small legend"><i className="g"/>Focused minutes <i className="w"/>Has withered trees</p>
            </div>
        </div>
    </div>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const when = (at: string) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** The grove: coins, today's trees, every tree grown, and the tree shop. */
export function GrovePanel({ w, mutate, busy }: { w: WorkspaceSnapshot; mutate: (action: string, data: object) => Promise<WorkspaceSnapshot>; busy: boolean }) {
    const g = groveOf(w);
    const todayKey = day(new Date(), w.zone);
    const todays = g.trees.filter(t => day(t.at, w.zone) === todayKey);
    const grown = g.trees.filter(t => !t.withered).length, withered = g.trees.length - grown;
    const shown = g.trees;
    return <>
        <section className="panel grove-panel" aria-label="Your grove">
            <div className="section-heading"><h2><TreeDeciduous size={18}/> Your grove</h2><span className="coin-balance" title="Coins: one per focus minute">{g.coins.toLocaleString()}<Coins size={16}/></span></div>
            <p className="small">Every finished focus round grows a tree and earns a coin per minute. Reset, skip or leave the tab during focus and that round’s tree withers.</p>
            <div className="grove-stats"><div><strong>{grown}</strong><small>trees grown</small></div><div><strong>{todays.filter(t => !t.withered).length}</strong><small>today</small></div><div><strong>{withered}</strong><small>withered</small></div><div><strong>{g.owned.length} / {SHOP.length + SPECIALS.length}</strong><small>kinds unlocked</small></div></div>
            {g.trees.length ? <GroveByPeriod trees={shown} zone={w.zone} land={g.land} weather={g.weather}/> : <div className="grove-empty"><Sprout size={28}/><p>Your grove is empty. Start a focus round and stay with it to grow your first tree.</p></div>}
        </section>
        <GroveShop w={w} mutate={mutate} busy={busy}/>
    </>;
}

type Mutate = (action: string, data: object) => Promise<WorkspaceSnapshot>;
const run = (mutate: Mutate, action: string, data: object) => void mutate(action, data).catch(() => { });
/** "Growing next" / "In use" marker. */
const Active = ({ label }: { label: string }) => <span className="shop-badge"><Check size={14}/>{label}</span>;
/** Price of something not yet owned: a gold Unlock button when affordable, otherwise a price tag and coin progress. */
function Price({ price, coins, busy, onBuy, label }: { price: number; coins: number; busy: boolean; onBuy: () => void; label: string }) {
    if (coins >= price) return <button className="shop-action buy" disabled={busy} onClick={onBuy} aria-label={`Unlock ${label} for ${price} coins`}>Unlock · {price.toLocaleString()}<Coins size={14}/></button>;
    return <div className="price-wrap"><span className="price-tag" title={`${price - coins} more coins needed`}><Lock size={13}/>{price.toLocaleString()}<Coins size={13}/></span>
        <span className="coin-progress" aria-label={`${coins} of ${price} coins`}><i style={{ width: `${Math.round(coins / price * 100)}%` }}/></span><small className="shop-need">{coins.toLocaleString()} / {price.toLocaleString()} coins</small></div>;
}

type ShopTab = 'shop' | 'special' | 'seasonal' | 'land' | 'weather';
type Preview = { tree?: string; land?: string; weather?: string };

/**
 * One shop for the whole grove: trees (bought, earned or seasonal), lands and weather. Clicking any
 * item previews it on the plot, so a tree, a land and a weather can be tried together before
 * buying; "Use this look" then buys what's needed and switches to the combination.
 */
function GroveShop({ w, mutate, busy }: { w: WorkspaceSnapshot; mutate: Mutate; busy: boolean }) {
    const g = groveOf(w), todayKey = day(new Date(), w.zone), season = seasonOf(todayKey, w.zone), facts = groveFacts(g, w.zone);
    const [tab, setTab] = useState<ShopTab>('shop'), [pv, setPv] = useState<Preview>({}), [applying, setApplying] = useState(false);
    const tree = pv.tree || g.selected, land = pv.land || g.land!, weather = pv.weather || g.weather!;
    const demo = Array.from({ length: 12 }, (_, i) => ({ id: 'preview-' + i, species: tree, at: '2026-01-01T00:00:00.000Z', minutes: 25 }));
    const growable = (id: string) => canGrow(g, id, w.zone, todayKey);
    const ownsTree = (id: string) => { const s = speciesById(id); return s.kind ? growable(id) : s.price === 0 || g.owned.includes(id); };
    // What applying the previewed look would need.
    const t = speciesById(tree), treeBlocked = t.kind === 'special' ? !growable(tree) : t.kind === 'seasonal' ? t.season !== season : false;
    const cost = (ownsTree(tree) || t.kind ? 0 : t.price) + (g.lands!.includes(land) ? 0 : landById(land).price) + (g.weathers!.includes(weather) ? 0 : weatherById(weather).price);
    const changed = tree !== g.selected || land !== g.land || weather !== g.weather;
    async function apply() {
        setApplying(true);
        try {
            if (tree !== g.selected) await mutate(ownsTree(tree) ? 'selectTree' : 'buyTree', { species: tree });
            if (land !== g.land) await mutate('buyScene', { kind: 'land', id: land });
            if (weather !== g.weather) await mutate('buyScene', { kind: 'weather', id: weather });
            setPv({});
        } catch { /* the error is shown as a notification */ } finally { setApplying(false); }
    }
    const pick = (key: keyof Preview, id: string) => setPv(p => ({ ...p, [key]: id }));
    const card = (key: keyof Preview, id: string, active: boolean, inUse: boolean, art: ReactNode, name: string, text: string, action: ReactNode, extra = '') =>
        <li key={id} role="button" tabIndex={0} aria-pressed={active} className={'shop-item' + (active ? ' previewing' : '') + (inUse ? ' selected' : '') + extra} onClick={() => pick(key, id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(key, id); } }}>
            {art}<strong>{name}</strong><small>{text}</small><div className="shop-actions" onClick={e => e.stopPropagation()}>{action}</div>
        </li>;
    const treeAction = (s: Species, ok: boolean, locked: ReactNode) => g.selected === s.id ? <Active label="Growing next"/> : ok ? <button className="shop-action use" disabled={busy} onClick={() => run(mutate, 'selectTree', { species: s.id })}>Grow this</button> : locked;
    const sceneAction = (kind: 'land' | 'weather', x: { id: string; name: string; price: number }) => {
        const owned = (kind === 'land' ? g.lands! : g.weathers!).includes(x.id), using = (kind === 'land' ? g.land : g.weather) === x.id;
        return using ? <Active label="In use"/> : owned ? <button className="shop-action use" disabled={busy} onClick={() => run(mutate, 'buyScene', { kind, id: x.id })}>Use</button> : <Price price={x.price} coins={g.coins} busy={busy} label={x.name} onBuy={() => run(mutate, 'buyScene', { kind, id: x.id })}/>;
    };
    const TABS: [ShopTab, string][] = [['shop', `Trees ${SHOP.filter(s => ownsTree(s.id)).length}/${SHOP.length}`], ['special', `Special ${SPECIALS.filter(s => growable(s.id)).length}/${SPECIALS.length}`], ['seasonal', 'Seasonal'], ['land', `Lands ${g.lands!.length}/${LANDS.length}`], ['weather', `Weather ${g.weathers!.length}/${WEATHERS.length}`]];
    return <section className="panel grove-shop" aria-label="Customise your grove">
        <div className="section-heading"><h2><Sparkles size={18}/> Customise your grove</h2><span className="coin-balance">{g.coins.toLocaleString()}<Coins size={16}/></span></div>
        <p className="small">Click any tree, land or weather to try it in the preview, even ones you don’t own yet. Mix them, then use the look you like.</p>
        <div className="grove-shop-body">
            <div className="shop-preview">
                <GroveIsland trees={demo} empty="" land={land} weather={weather}/>
                <div className="preview-picks">
                    <button className={'pick' + (pv.tree ? ' changed' : '')} onClick={() => setTab(t.kind === 'special' ? 'special' : t.kind === 'seasonal' ? 'seasonal' : 'shop')}><TreeDeciduous size={14}/><span><small>Tree</small>{t.name}</span></button>
                    <button className={'pick' + (pv.land ? ' changed' : '')} onClick={() => setTab('land')}><Mountain size={14}/><span><small>Land</small>{landById(land).name}</span></button>
                    <button className={'pick' + (pv.weather ? ' changed' : '')} onClick={() => setTab('weather')}><CloudSun size={14}/><span><small>Weather</small>{weatherById(weather).name}</span></button>
                </div>
                {changed ? <div className="preview-apply">
                    {treeBlocked ? <p className="small">{t.kind === 'seasonal' ? `The ${t.name} only grows in ${t.season}.` : `The ${t.name} isn’t unlocked yet.`} Pick another tree to use this look.</p>
                        : cost > g.coins ? <p className="small">This look needs {cost.toLocaleString()} coins; you have {g.coins.toLocaleString()}.</p> : null}
                    <div className="actions"><button className="shop-action use" disabled={busy || applying || treeBlocked || cost > g.coins} onClick={() => void apply()}>{applying ? 'Applying…' : cost ? <>Buy & use this look · {cost.toLocaleString()}<Coins size={14}/></> : 'Use this look'}</button><button className="text-button" onClick={() => setPv({})}>Back to my grove</button></div>
                </div> : <p className="small preview-note">This is your grove’s current look.</p>}
            </div>
            <div className="shop-list">
                <div className="pill-tabs" role="tablist">{TABS.map(([v, label]) => <button key={v} role="tab" aria-selected={tab === v} className={tab === v ? 'selected' : ''} onClick={() => setTab(v)}>{label}</button>)}</div>
                {tab === 'shop' && <ul className="shop-grid">{SHOP.map(s => card('tree', s.id, tree === s.id, g.selected === s.id, <TreeArt species={s.id} size={64}/>, s.name, s.blurb,
                    treeAction(s, ownsTree(s.id), <Price price={s.price} coins={g.coins} busy={busy} label={s.name} onBuy={() => run(mutate, 'buyTree', { species: s.id })}/>), ownsTree(s.id) ? ' owned' : ''))}</ul>}
                {tab === 'special' && <><p className="small">Earned by focus achievements, never bought. The lucky clover turns up by chance.</p><ul className="shop-grid">{SPECIALS.map(s => {
                    const ok = growable(s.id), u = SPECIAL_UNLOCKS[s.id], p = u.progress(facts, g);
                    return card('tree', s.id, tree === s.id, g.selected === s.id, <span className="shop-art"><TreeArt species={s.id} size={64}/>{!ok && <Lock size={16} className="shop-lock"/>}</span>, s.name, ok ? s.blurb : u.hint + '.',
                        treeAction(s, ok, p.need > 1 ? <div className="price-wrap"><span className="price-tag earn"><Lock size={13}/>Locked</span><span className="coin-progress earn"><i style={{ width: `${Math.round(p.have / p.need * 100)}%` }}/></span><small className="shop-need">{p.have} / {p.need}</small></div> : <span className="price-tag earn"><Lock size={13}/>{s.id === 'clover' ? 'Found by luck' : 'Locked'}</span>), ' special' + (ok ? ' owned' : ' locked'));
                })}</ul></>}
                {tab === 'seasonal' && <><p className="small">Free, but each grows only in its season. It’s <strong>{season}</strong> where you are.</p><ul className="shop-grid">{SEASONALS.map(s => card('tree', s.id, tree === s.id, g.selected === s.id, <TreeArt species={s.id} size={64}/>, s.name, s.blurb,
                    treeAction(s, s.season === season, <span className="price-tag earn"><Lock size={13}/>Grows in {s.season}</span>), s.season === season ? ' owned' : ' locked'))}</ul></>}
                {tab === 'land' && <ul className="shop-grid">{LANDS.map(l => card('land', l.id, land === l.id, g.land === l.id, <span className="scene-swatch big" style={{ background: `linear-gradient(135deg, ${l.tile} 50%, ${l.alt} 50%)`, borderColor: l.left }}/>, l.name, l.blurb, sceneAction('land', l), g.lands!.includes(l.id) ? ' owned' : ''))}</ul>}
                {tab === 'weather' && <ul className="shop-grid">{WEATHERS.map(x => card('weather', x.id, weather === x.id, g.weather === x.id, <span className={'scene-swatch big weather-' + x.id}/>, x.name, x.blurb, sceneAction('weather', x), g.weathers!.includes(x.id) ? ' owned' : ''))}</ul>}
            </div>
        </div>
        <p className="small muted">Trees grow from focus rounds of 10 minutes or more. Weather moves gently and stays still if your device is set to reduce motion.</p>
    </section>;
}
