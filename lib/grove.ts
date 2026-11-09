import { z } from 'zod';
import type { Grove, GroveTree } from './study.ts';

/*
 * The focus grove: every completed focus round grows a tree and earns coins (one per focus
 * minute); a round abandoned partway leaves a withered tree and earns nothing. Coins unlock new
 * kinds of tree. Synced to the account inside the workspace.
 */

export type TreeShape = 'round' | 'cone' | 'blossom' | 'tall' | 'palm' | 'willow' | 'bush' | 'crystal' | 'twin' | 'fruit' | 'cactus' | 'bamboo' | 'cypress' | 'snowpine' | 'toadstool' | 'acacia' | 'bonsai' | 'baobab' | 'heart' | 'topiary' | 'rainbow' | 'starry'
    | 'moon' | 'dawn' | 'flame' | 'storm' | 'ancient' | 'cloud' | 'coral' | 'firefly' | 'clover' | 'treasure' | 'sunflower' | 'frost' | 'ember' | 'guardian';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
/** `shop` trees are bought with coins; `special` ones are earned by an achievement; `seasonal` ones grow only in their season. */
export type Species = { id: string; name: string; price: number; shape: TreeShape; trunk: string; leaves: string; accent: string; blurb: string; kind?: 'shop' | 'special' | 'seasonal'; season?: Season };

/** Tree kinds. The first is free and owned by everyone. Prices are in coins. */
const SHOP_TREES: Species[] = [
    { id: 'oak', name: 'Oak', price: 0, shape: 'round', trunk: '#8a5a35', leaves: '#4f9a52', accent: '#6dbb6a', blurb: 'Sturdy and patient. Everyone starts here.' },
    { id: 'pine', name: 'Pine', price: 100, shape: 'cone', trunk: '#7a4e2d', leaves: '#2f7a4f', accent: '#479a68', blurb: 'Evergreen focus, whatever the season.' },
    { id: 'apple', name: 'Apple tree', price: 120, shape: 'fruit', trunk: '#7d4f30', leaves: '#5aa34a', accent: '#e0453a', blurb: 'An apple a session keeps distraction away.' },
    { id: 'shrub', name: 'Berry shrub', price: 150, shape: 'bush', trunk: '#6d4a2f', leaves: '#3f8f4f', accent: '#d9485f', blurb: 'Small, round and full of berries.' },
    { id: 'cactus', name: 'Cactus', price: 180, shape: 'cactus', trunk: '#3f8a4f', leaves: '#57a85e', accent: '#f27ba6', blurb: 'Thrives on very little. Flowers when you focus.' },
    { id: 'lemon', name: 'Lemon tree', price: 220, shape: 'fruit', trunk: '#80583a', leaves: '#3f8f4a', accent: '#f5d23a', blurb: 'Bright and zesty.' },
    { id: 'blossom', name: 'Blossom', price: 250, shape: 'blossom', trunk: '#7b4b3a', leaves: '#f2a7c3', accent: '#f7c9db', blurb: 'Soft pink petals for calm sessions.' },
    { id: 'bamboo', name: 'Bamboo', price: 300, shape: 'bamboo', trunk: '#7fb04a', leaves: '#5d9a3b', accent: '#a7cf6b', blurb: 'Grows fast, bends but never breaks.' },
    { id: 'maple', name: 'Maple', price: 350, shape: 'round', trunk: '#7d4a2a', leaves: '#e2763a', accent: '#f0a04b', blurb: 'Warm autumn colours all year round.' },
    { id: 'cypress', name: 'Cypress', price: 400, shape: 'cypress', trunk: '#6b4a30', leaves: '#2e6b48', accent: '#3f8a5c', blurb: 'Tall, slim and quietly determined.' },
    { id: 'birch', name: 'Birch', price: 450, shape: 'tall', trunk: '#e9e4d8', leaves: '#8cc56b', accent: '#b6dc8f', blurb: 'Light, tall and bright.' },
    { id: 'snowpine', name: 'Snowy pine', price: 500, shape: 'snowpine', trunk: '#6e4a2d', leaves: '#2c6e57', accent: '#ffffff', blurb: 'Cool and calm under fresh snow.' },
    { id: 'toadstool', name: 'Giant toadstool', price: 550, shape: 'toadstool', trunk: '#f3ead8', leaves: '#d8402f', accent: '#ffffff', blurb: 'Not strictly a tree. Nobody minds.' },
    { id: 'palm', name: 'Palm', price: 600, shape: 'palm', trunk: '#a87b4f', leaves: '#3e9e6e', accent: '#5fc08a', blurb: 'A holiday for your mind.' },
    { id: 'acacia', name: 'Savanna acacia', price: 700, shape: 'acacia', trunk: '#7a5232', leaves: '#7ca23f', accent: '#a4c45c', blurb: 'Wide and flat-topped, like a sunset on the plains.' },
    { id: 'willow', name: 'Willow', price: 800, shape: 'willow', trunk: '#6f5a3c', leaves: '#7fb069', accent: '#a3cd8a', blurb: 'Long, flowing branches.' },
    { id: 'bonsai', name: 'Bonsai', price: 900, shape: 'bonsai', trunk: '#6b4a33', leaves: '#4c8f4a', accent: '#b0573c', blurb: 'Patience, shaped over many sessions.' },
    { id: 'twin', name: 'Twin oaks', price: 1000, shape: 'twin', trunk: '#80553a', leaves: '#3d8b5f', accent: '#5aae7b', blurb: 'Two trees that grew up together.' },
    { id: 'baobab', name: 'Baobab', price: 1100, shape: 'baobab', trunk: '#9c7656', leaves: '#5f9a45', accent: '#86b860', blurb: 'Stores up focus like water for the dry season.' },
    { id: 'heart', name: 'Heart tree', price: 1200, shape: 'heart', trunk: '#7b4b3a', leaves: '#e8608a', accent: '#f6a6bf', blurb: 'For sessions you loved.' },
    { id: 'lavender', name: 'Lavender tree', price: 1300, shape: 'blossom', trunk: '#6d5560', leaves: '#a98bd6', accent: '#cbb6ef', blurb: 'Purple blooms, very relaxing.' },
    { id: 'topiary', name: 'Topiary', price: 1600, shape: 'topiary', trunk: '#6b4a33', leaves: '#3f8a4a', accent: '#c46a3a', blurb: 'Neatly trimmed, like a tidy mind.' },
    { id: 'crystal', name: 'Crystal tree', price: 1800, shape: 'crystal', trunk: '#5f6b8a', leaves: '#7fd6e6', accent: '#c7b8ff', blurb: 'Glows a little when you focus.' },
    { id: 'rainbow', name: 'Rainbow tree', price: 2100, shape: 'rainbow', trunk: '#7b5a3e', leaves: '#7cc576', accent: '#ffffff', blurb: 'Every colour of a good study week.' },
    { id: 'golden', name: 'Golden tree', price: 2500, shape: 'round', trunk: '#8b6a2b', leaves: '#e8b931', accent: '#f8dc75', blurb: 'For the truly dedicated.' },
    { id: 'starlight', name: 'Starlight tree', price: 3000, shape: 'starry', trunk: '#3d3a5c', leaves: '#2b3f7a', accent: '#ffe27a', blurb: 'A night sky you grew yourself.' },
];
/** Earned, not bought: each unlocks when its condition (see SPECIAL_UNLOCKS) is met. */
const SPECIAL_TREES: Species[] = [
    { id: 'moon', name: 'Moon tree', price: 0, kind: 'special', shape: 'moon', trunk: '#4b4f6b', leaves: '#8aa0d6', accent: '#f3f0c8', blurb: 'Silver leaves that shine for night-time study.' },
    { id: 'dawn', name: 'Dawn tree', price: 0, kind: 'special', shape: 'dawn', trunk: '#7a4e3a', leaves: '#f59e6b', accent: '#ffd36b', blurb: 'Glows like the sunrise you studied through.' },
    { id: 'storm', name: 'Storm tree', price: 0, kind: 'special', shape: 'storm', trunk: '#4a4a52', leaves: '#5d6577', accent: '#ffe066', blurb: 'Stood firm through one very long round.' },
    { id: 'firefly', name: 'Firefly tree', price: 0, kind: 'special', shape: 'firefly', trunk: '#4d3b2a', leaves: '#1f5a43', accent: '#e9ff7a', blurb: 'Lit up by a day full of focus.' },
    { id: 'phoenix', name: 'Phoenix tree', price: 0, kind: 'special', shape: 'flame', trunk: '#6b3b25', leaves: '#ef5b2a', accent: '#ffc93c', blurb: 'Ten trees in a row, not one withered.' },
    { id: 'coral', name: 'Coral tree', price: 0, kind: 'special', shape: 'coral', trunk: '#e8796b', leaves: '#ff8f7a', accent: '#ffd0c2', blurb: 'Grown from a full week of focus.' },
    { id: 'cloud', name: 'Cloud tree', price: 0, kind: 'special', shape: 'cloud', trunk: '#8e8a9c', leaves: '#ffffff', accent: '#c9e3ff', blurb: 'Fifty focused hours, light as air.' },
    { id: 'treasure', name: 'Treasure tree', price: 0, kind: 'special', shape: 'treasure', trunk: '#7b5a2a', leaves: '#3f8f4a', accent: '#f5c542', blurb: 'For collecting fifteen kinds of tree.' },
    { id: 'ancient', name: 'Ancient oak', price: 0, kind: 'special', shape: 'ancient', trunk: '#6a4a33', leaves: '#3f7a3c', accent: '#9cc46a', blurb: 'A hundred trees grown. Wise and mossy.' },
    { id: 'guardian', name: 'Guardian tree', price: 0, kind: 'special', shape: 'guardian', trunk: '#5b4636', leaves: '#2f6d5a', accent: '#7fe0c4', blurb: 'Watches over a grove of 250 trees.' },
    { id: 'clover', name: 'Lucky clover tree', price: 0, kind: 'special', shape: 'clover', trunk: '#6b5a3a', leaves: '#3fae5a', accent: '#d8f7a0', blurb: 'Found by chance after a finished round. Lucky you!' },
];
/** Free, but only grown during their season (by your time zone's hemisphere). Trees already grown stay forever. */
const SEASONAL_TREES: Species[] = [
    { id: 'springbloom', name: 'Spring bloom', price: 0, kind: 'seasonal', season: 'spring', shape: 'blossom', trunk: '#7b5a48', leaves: '#ffffff', accent: '#ffc7dd', blurb: 'White blossom, only in spring.' },
    { id: 'sunflower', name: 'Giant sunflower', price: 0, kind: 'seasonal', season: 'summer', shape: 'sunflower', trunk: '#5f9a3b', leaves: '#ffcf33', accent: '#7a4a1e', blurb: 'Taller than you. Summer only.' },
    { id: 'ember', name: 'Ember maple', price: 0, kind: 'seasonal', season: 'autumn', shape: 'ember', trunk: '#6d3f26', leaves: '#d9472b', accent: '#ffa53a', blurb: 'Falling leaves, autumn only.' },
    { id: 'frost', name: 'Frost pine', price: 0, kind: 'seasonal', season: 'winter', shape: 'frost', trunk: '#5e4a3a', leaves: '#5e9fb8', accent: '#ffe27a', blurb: 'Icy needles and warm lights. Winter only.' },
];
export const SPECIES: Species[] = [...SHOP_TREES, ...SPECIAL_TREES, ...SEASONAL_TREES];
export const SHOP = SHOP_TREES, SPECIALS = SPECIAL_TREES, SEASONALS = SEASONAL_TREES;
export const speciesById = (id: string) => SPECIES.find(s => s.id === id) || SPECIES[0];
export const MAX_TREES = 5000;

// ---------- seasons ----------
const SOUTH = /^(Australia\/|Antarctica\/|Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia|Noumea|Efate|Norfolk)|America\/(Argentina|Sao_Paulo|Santiago|Montevideo|Asuncion|La_Paz|Lima|Punta_Arenas)|Africa\/(Johannesburg|Maputo|Harare|Lusaka|Windhoek|Gaborone|Maseru|Mbabane|Antananarivo|Blantyre|Lubumbashi)|Indian\/(Mauritius|Reunion|Antananarivo))/;
const NORTH_SEASONS: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
const OPPOSITE: Record<Season, Season> = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' };
/** The season on a day (YYYY-MM-DD) for a time zone, flipped for the southern hemisphere. */
export function seasonOf(key: string, zone: string): Season { const s = NORTH_SEASONS[Number(key.slice(5, 7)) - 1]; return SOUTH.test(zone) ? OPPOSITE[s] : s; }

// ---------- what the grove has achieved (for special trees and grove badges) ----------
export type GroveFacts = { grown: number; withered: number; minutes: number; bestDay: number; longest: number; night: boolean; dawn: boolean; cleanRun: number; fullWeek: boolean; shopKinds: number; spent: number; coins: number; cleanWeek: boolean; secondChance: boolean; seasons: Set<Season>; hours: number };
const factsCache = new WeakMap<object, GroveFacts>();
const localHour = (at: string, zone: string) => { try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(at))); } catch { return new Date(at).getUTCHours(); } };
const localDay = (at: string, zone: string) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(at)); } catch { return at.slice(0, 10); } };
const mondayOf = (key: string) => { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); };
export function groveFacts(g: Grove, zone: string): GroveFacts {
    // Tree-derived facts are cached per trees list (a new list whenever a tree is added); ownership is cheap and read fresh.
    const shopOwned = SHOP_TREES.filter(s => s.id === 'oak' || g.owned.includes(s.id));
    const live = { shopKinds: shopOwned.length, spent: shopOwned.reduce((n, s) => n + s.price, 0), coins: g.coins };
    const hit = factsCache.get(g.trees); if (hit) return { ...hit, ...live };
    const grown = g.trees.filter(t => !t.withered), perDay = new Map<string, number>(), weeks = new Map<string, Set<string>>(), weekWithered = new Map<string, number>(), weekGrown = new Map<string, number>();
    let run = 0, cleanRun = 0, secondChance = false;
    const witheredDays = new Set<string>();
    for (const t of g.trees) {
        const key = localDay(t.at, zone), week = mondayOf(key);
        if (t.withered) { run = 0; witheredDays.add(key); weekWithered.set(week, (weekWithered.get(week) || 0) + 1); continue; }
        run++; cleanRun = Math.max(cleanRun, run);
        if (witheredDays.has(key)) secondChance = true;
        perDay.set(key, (perDay.get(key) || 0) + 1);
        weeks.set(week, (weeks.get(week) || new Set()).add(key));
        weekGrown.set(week, (weekGrown.get(week) || 0) + 1);
    }
    const hours = grown.map(t => localHour(t.at, zone));
    const facts: GroveFacts = {
        grown: grown.length, withered: g.trees.length - grown.length,
        minutes: grown.reduce((n, t) => n + t.minutes, 0), hours: Math.floor(grown.reduce((n, t) => n + t.minutes, 0) / 60),
        bestDay: Math.max(0, ...perDay.values()), longest: Math.max(0, ...grown.map(t => t.minutes)),
        night: hours.some(h => h >= 22 || h < 4), dawn: hours.some(h => h >= 4 && h < 7),
        cleanRun, fullWeek: [...weeks.values()].some(days => days.size >= 7),
        ...live,
        cleanWeek: [...weekGrown].some(([week, n]) => n >= 5 && !weekWithered.get(week)),
        secondChance,
        seasons: new Set(grown.map(t => speciesById(t.species)).filter(s => s.kind === 'seasonal').map(s => s.season!)),
    };
    factsCache.set(g.trees, facts);
    return facts;
}

const need = (n: number, have: number) => ({ have: Math.min(have, n), need: n });
/** How each special tree is earned. `clover` is a lucky find instead (see plantTree). */
export const SPECIAL_UNLOCKS: Record<string, { hint: string; progress: (f: GroveFacts, g: Grove) => { have: number; need: number } }> = {
    moon: { hint: 'Finish a focus round between 10 pm and 4 am', progress: f => need(1, f.night ? 1 : 0) },
    dawn: { hint: 'Finish a focus round between 4 and 7 am', progress: f => need(1, f.dawn ? 1 : 0) },
    storm: { hint: 'Finish a focus round of 90 minutes or more', progress: f => need(90, f.longest) },
    firefly: { hint: 'Grow 5 trees in one day', progress: f => need(5, f.bestDay) },
    phoenix: { hint: 'Grow 10 trees in a row without one withering', progress: f => need(10, f.cleanRun) },
    coral: { hint: 'Grow a tree on all 7 days of one week', progress: f => need(1, f.fullWeek ? 1 : 0) },
    cloud: { hint: 'Grow trees worth 50 focused hours', progress: f => need(50, f.hours) },
    treasure: { hint: 'Own 15 kinds of tree from the shop', progress: f => need(15, f.shopKinds) },
    ancient: { hint: 'Grow 100 trees', progress: f => need(100, f.grown) },
    guardian: { hint: 'Grow 250 trees', progress: f => need(250, f.grown) },
    clover: { hint: 'A lucky find: any finished round has a small chance of revealing it', progress: (_f, g) => need(1, g.owned.includes('clover') ? 1 : 0) },
};

// ---------- lands and weather (the grove's scenery, bought with coins) ----------
export type Land = { id: string; name: string; price: number; tile: string; alt: string; edge: string; left: string; right: string; sky: [string, string]; blurb: string; dark?: boolean };
export const LANDS: Land[] = [
    { id: 'meadow', name: 'Meadow', price: 0, tile: '#9fd27a', alt: '#a9d986', edge: '#8cc46a', left: '#8a5f3c', right: '#6f4a2d', sky: ['#eef5ea', '#dfeedd'], blurb: 'Soft green grass. Where every grove begins.' },
    { id: 'desert', name: 'Desert dunes', price: 300, tile: '#ecd28f', alt: '#f2dca0', edge: '#d9bd77', left: '#c4934f', right: '#a9773a', sky: ['#fdf3dc', '#f6e2b8'], blurb: 'Warm sand under a big sky.' },
    { id: 'autumn', name: 'Autumn field', price: 400, tile: '#e3b25a', alt: '#eabd6c', edge: '#cf9c45', left: '#8a5f3c', right: '#6f4a2d', sky: ['#fbf0e1', '#f6dfc0'], blurb: 'Golden grass and crunchy leaves.' },
    { id: 'beach', name: 'Sunny beach', price: 500, tile: '#f3e1a6', alt: '#7fd3d8', edge: '#e2cc8a', left: '#d8b77a', right: '#bf9a5d', sky: ['#e6f7fb', '#c9eef5'], blurb: 'Sand and shallow water, side by side.' },
    { id: 'snow', name: 'Snowfield', price: 600, tile: '#f4f8fb', alt: '#e6eef5', edge: '#d3dee8', left: '#9fb3c6', right: '#7f96ad', sky: ['#eef4fa', '#dbe7f2'], blurb: 'Fresh, quiet snow.' },
    { id: 'stone', name: 'Mossy stones', price: 700, tile: '#a6ad9e', alt: '#8fbf74', edge: '#8d9486', left: '#6d6a63', right: '#57544e', sky: ['#eef1ec', '#dde3da'], blurb: 'Old paving stones, slowly turning green.' },
    { id: 'sakura', name: 'Blossom garden', price: 900, tile: '#b9dd94', alt: '#f6c9d9', edge: '#a6cf80', left: '#8a5f3c', right: '#6f4a2d', sky: ['#fdf0f5', '#f8dce7'], blurb: 'Petals scattered over the grass.' },
    { id: 'night', name: 'Moonlit garden', price: 1100, tile: '#3f6b5a', alt: '#466f61', edge: '#5f9c86', left: '#3a2f45', right: '#2c2435', sky: ['#1d2340', '#121628'], blurb: 'Cool grass under the stars.', dark: true },
    { id: 'volcano', name: 'Volcanic rock', price: 1400, tile: '#5a5552', alt: '#4c4745', edge: '#ff7a3d', left: '#3b2a24', right: '#2b1d18', sky: ['#3a2622', '#1f1513'], blurb: 'Dark stone with glowing cracks.', dark: true },
    { id: 'sky', name: 'Floating island', price: 1700, tile: '#a5dc7c', alt: '#b4e48c', edge: '#93cc6d', left: '#9b8a7a', right: '#7c6c5e', sky: ['#d6ecff', '#a9d4ff'], blurb: 'A grove drifting among the clouds.' },
    { id: 'crystal', name: 'Crystal cave', price: 2200, tile: '#8f7fd6', alt: '#a593e6', edge: '#c8b8ff', left: '#4b3f7a', right: '#3a305f', sky: ['#2a2350', '#1a1636'], blurb: 'Glowing purple crystal floors.', dark: true },
];
export type Weather = { id: string; name: string; price: number; blurb: string; dark?: boolean };
export const WEATHERS: Weather[] = [
    { id: 'clear', name: 'Clear', price: 0, blurb: 'A calm, still day.' },
    { id: 'sunny', name: 'Sunshine', price: 200, blurb: 'Warm rays across the grove.' },
    { id: 'breeze', name: 'Falling leaves', price: 300, blurb: 'Leaves drifting on the wind.' },
    { id: 'rain', name: 'Gentle rain', price: 400, blurb: 'Soft rain. Very good for focus.' },
    { id: 'mist', name: 'Morning mist', price: 450, blurb: 'Low fog rolling between the trees.' },
    { id: 'snow', name: 'Snowfall', price: 550, blurb: 'Slow, quiet snowflakes.' },
    { id: 'petals', name: 'Petal shower', price: 650, blurb: 'Pink petals floating down.' },
    { id: 'fireflies', name: 'Fireflies', price: 800, blurb: 'Tiny lights at dusk.', dark: true },
    { id: 'stars', name: 'Starry night', price: 1000, blurb: 'A clear night full of stars.', dark: true },
    { id: 'rainbow', name: 'Rainbow', price: 1300, blurb: 'A rainbow after the rain.' },
    { id: 'aurora', name: 'Aurora', price: 2000, blurb: 'Ribbons of light in the night sky.', dark: true },
];
export const landById = (id?: string) => LANDS.find(l => l.id === id) || LANDS[0];
export const weatherById = (id?: string) => WEATHERS.find(x => x.id === id) || WEATHERS[0];

const sceneInput = z.object({ kind: z.enum(['land', 'weather']), id: z.string().max(40) });
/** Buys (or, if already owned, just switches to) a land or weather with coins. */
export function buyScene(w: GroveHost, input: unknown) {
    const { kind, id } = sceneInput.parse(input), g = mutable(w);
    const item = kind === 'land' ? LANDS.find(l => l.id === id) : WEATHERS.find(x => x.id === id);
    if (!item) throw Error(kind === 'land' ? 'That land doesn’t exist.' : 'That weather doesn’t exist.');
    const owned = kind === 'land' ? g.lands! : g.weathers!;
    if (!owned.includes(id)) {
        if (g.coins < item.price) throw Error(`You need ${item.price - g.coins} more coins for ${item.name}.`);
        g.coins -= item.price; owned.push(id);
    }
    if (kind === 'land') g.land = id; else g.weather = id;
}

export function groveOf(w: { grove?: Grove }): Grove {
    const g = w.grove;
    const lands = [...new Set(['meadow', ...(g?.lands || [])])].filter(id => LANDS.some(l => l.id === id)), weathers = [...new Set(['clear', ...(g?.weathers || [])])].filter(id => WEATHERS.some(x => x.id === id));
    return { trees: g?.trees || [], coins: g?.coins || 0, owned: [...new Set(['oak', ...(g?.owned || [])])], selected: g && SPECIES.some(s => s.id === g.selected) ? g.selected : 'oak',
        lands, land: g?.land && lands.includes(g.land) ? g.land : 'meadow', weathers, weather: g?.weather && weathers.includes(g.weather) ? g.weather : 'clear' };
}
const mutable = (w: { grove?: Grove }) => (w.grove = groveOf(w));
const addTree = (g: Grove, tree: GroveTree) => { g.trees = [...g.trees, tree].slice(-MAX_TREES); };

/** Whether a kind of tree can be grown on a day: bought, earned, or in season. */
export function canGrow(g: Grove, id: string, zone: string, dayKey: string) {
    const s = SPECIES.find(s => s.id === id);
    if (!s) return false;
    if (s.kind === 'seasonal') return seasonOf(dayKey, zone) === s.season;
    if (s.kind === 'special') return g.owned.includes(id) || (id !== 'clover' && (() => { const p = SPECIAL_UNLOCKS[id].progress(groveFacts(g, zone), g); return p.have >= p.need; })());
    return id === 'oak' || g.owned.includes(id);
}
/** Special trees whose condition is now met but that aren't recorded as owned yet. */
export function newlyEarned(g: Grove, zone: string) { return SPECIAL_TREES.filter(s => s.id !== 'clover' && !g.owned.includes(s.id) && canGrow(g, s.id, zone, '')).map(s => s.id); }

/** Coins for a completed round: one per focus minute. */
export const coinsFor = (ms: number) => Math.floor(ms / 60000);
/** Shorter focus rounds still count as focus time, but don't grow (or wither) a tree or earn coins. */
export const MIN_TREE_MINUTES = 10;
/** Lucky find: about 1 in 30 finished rounds of 15+ minutes, decided by the round's id so it never changes. */
export function isLucky(id: string, ms: number) { if (ms < 15 * 60000) return false; let h = 2166136261; for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h % 30 === 7; }

const treeInput = z.object({ id: z.string().min(1).max(100), at: z.string().datetime(), ms: z.number().int().min(0).max(4 * 3600000), species: z.string().max(40).optional() });
type GroveHost = { grove?: Grove; zone?: string };

/**
 * A completed focus round grows a tree and earns coins (call once per new round, after
 * recordFocusRound). It may also earn special trees, or reveal the lucky clover tree.
 */
export function plantTree(w: GroveHost, input: unknown) {
    const p = treeInput.parse(input), g = mutable(w), zone = w.zone || 'UTC', key = localDay(p.at, zone);
    if (g.trees.some(t => t.id === p.id) || p.ms < MIN_TREE_MINUTES * 60000) return 0;
    const wanted = p.species || g.selected, species = canGrow(g, wanted, zone, key) ? wanted : canGrow(g, g.selected, zone, key) ? g.selected : 'oak';
    const coins = coinsFor(p.ms);
    addTree(g, { id: p.id, species, at: p.at, minutes: Math.round(p.ms / 60000) });
    g.coins += coins;
    const earned = newlyEarned(groveOf(w), zone);
    if (isLucky(p.id, p.ms) && !g.owned.includes('clover')) earned.push('clover');
    if (earned.length) g.owned = [...g.owned, ...earned];
    return coins;
}

/** A focus round abandoned partway leaves a withered tree and earns nothing. */
export function witherTree(w: GroveHost, input: unknown) {
    const p = treeInput.parse(input), g = mutable(w);
    if (g.trees.some(t => t.id === p.id)) return false;
    // Only rounds long enough to grow a tree can leave a withered one (the round's planned length is not sent, so this is checked on the client).
    const wanted = p.species || g.selected;
    addTree(g, { id: p.id, species: SPECIES.some(s => s.id === wanted) ? wanted : 'oak', at: p.at, minutes: Math.round(p.ms / 60000), withered: true });
    return true;
}

const speciesInput = z.object({ species: z.string().max(40) });
/** Spends coins to unlock a shop tree, and selects it. */
export function buyTree(w: GroveHost, input: unknown) {
    const { species } = speciesInput.parse(input), g = mutable(w), s = SPECIES.find(s => s.id === species);
    if (!s) throw Error('That tree doesn’t exist.');
    if (s.kind) throw Error(s.kind === 'seasonal' ? 'Seasonal trees are free in their season.' : 'Special trees are earned, not bought.');
    if (g.owned.includes(species)) { g.selected = species; return; }
    if (g.coins < s.price) throw Error(`You need ${s.price - g.coins} more coins for the ${s.name}.`);
    g.coins -= s.price; g.owned = [...g.owned, species]; g.selected = species;
}

export function selectTree(w: GroveHost, input: unknown, now = new Date()) {
    const { species } = speciesInput.parse(input), g = mutable(w), zone = w.zone || 'UTC';
    if (!canGrow(g, species, zone, localDay(now.toISOString(), zone))) { const s = SPECIES.find(s => s.id === species); throw Error(s?.kind === 'seasonal' ? `The ${s.name} only grows in ${s.season}.` : 'Unlock this tree first.'); }
    if (SPECIES.find(s => s.id === species)?.kind === 'special' && !g.owned.includes(species)) g.owned = [...g.owned, species];
    g.selected = species;
}

/** Folds a restored backup's grove in: trees by id, the larger coin balance, every tree owned. */
export function mergeGrove(target: { grove?: Grove }, source: { grove?: unknown }) {
    const raw = source.grove as Partial<Grove> | undefined;
    if (!raw || typeof raw !== 'object') return;
    const g = mutable(target), known = new Set(g.trees.map(t => t.id));
    for (const t of Array.isArray(raw.trees) ? raw.trees : []) {
        if (!t || typeof t.id !== 'string' || known.has(t.id) || typeof t.at !== 'string') continue;
        addTree(g, { id: t.id.slice(0, 100), species: speciesById(String(t.species)).id, at: t.at, minutes: Math.max(0, Math.min(240, Number(t.minutes) || 0)), ...(t.withered ? { withered: true as const } : {}) });
    }
    g.trees.sort((a, b) => a.at.localeCompare(b.at));
    if (typeof raw.coins === 'number' && raw.coins > g.coins) g.coins = Math.floor(raw.coins);
    g.owned = [...new Set([...g.owned, ...(Array.isArray(raw.owned) ? raw.owned : []).filter(id => SPECIES.some(s => s.id === id))])];
    g.lands = [...new Set([...g.lands!, ...(Array.isArray(raw.lands) ? raw.lands : []).filter(id => LANDS.some(l => l.id === id))])];
    g.weathers = [...new Set([...g.weathers!, ...(Array.isArray(raw.weathers) ? raw.weathers : []).filter(id => WEATHERS.some(x => x.id === id))])];
}

// ---------- grove views by period (day / week / month / year) ----------
export type Period = 'day' | 'week' | 'month' | 'year';
const keyDate = (key: string) => new Date(key + 'T00:00:00Z');
const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const shiftDays = (key: string, n: number) => { const d = keyDate(key); d.setUTCDate(d.getUTCDate() + n); return keyOf(d); };
const fmt = (key: string, options: Intl.DateTimeFormatOptions) => keyDate(key).toLocaleDateString(undefined, { timeZone: 'UTC', ...options });

/**
 * The day, week (Monday–Sunday), month or year that is `offset` periods before (negative) or after
 * `todayKey` (YYYY-MM-DD in the workspace time zone), with a label and the slots its chart shows.
 */
export function periodRange(period: Period, todayKey: string, offset = 0) {
    const today = keyDate(todayKey);
    if (period === 'day') {
        const key = shiftDays(todayKey, offset);
        return { start: key, end: key, label: fmt(key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), slots: Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: h % 6 === 0 ? `${h}:00` : '' })) };
    }
    if (period === 'week') {
        const start = shiftDays(todayKey, -((today.getUTCDay() + 6) % 7) + offset * 7), end = shiftDays(start, 6);
        return { start, end, label: `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}`, slots: Array.from({ length: 7 }, (_, i) => { const k = shiftDays(start, i); return { key: k, label: fmt(k, { weekday: 'short' }) }; }) };
    }
    if (period === 'month') {
        const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1)), last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
        const start = keyOf(first), end = keyOf(last), days = last.getUTCDate();
        return { start, end, label: fmt(start, { month: 'long', year: 'numeric' }), slots: Array.from({ length: days }, (_, i) => { const k = shiftDays(start, i); return { key: k, label: (i + 1) % 5 === 1 ? String(i + 1) : '' }; }) };
    }
    const year = today.getUTCFullYear() + offset;
    return { start: `${year}-01-01`, end: `${year}-12-31`, label: String(year), slots: Array.from({ length: 12 }, (_, m) => ({ key: `${year}-${String(m + 1).padStart(2, '0')}`, label: fmt(`${year}-${String(m + 1).padStart(2, '0')}-01`, { month: 'narrow' }) })) };
}

function hourIn(at: string, zone: string) { try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(at))); } catch { return new Date(at).getUTCHours(); } }

/** The trees planted in a period, with totals and per-slot counts (hours, days or months) for its chart. */
export function groveFor(trees: GroveTree[], period: Period, todayKey: string, offset: number, dayOf: (at: string) => string, zone = 'UTC') {
    const range = periodRange(period, todayKey, offset);
    const inRange = trees.filter(t => { const k = dayOf(t.at); return k >= range.start && k <= range.end; });
    const slotOf = (t: GroveTree) => period === 'day' ? String(hourIn(t.at, zone)) : period === 'year' ? dayOf(t.at).slice(0, 7) : dayOf(t.at);
    const slots = range.slots.map(s => { const here = inRange.filter(t => slotOf(t) === s.key), ok = here.filter(t => !t.withered); return { ...s, grown: ok.length, withered: here.length - ok.length, minutes: ok.reduce((n, t) => n + t.minutes, 0) }; });
    const grown = inRange.filter(t => !t.withered);
    // Focused minutes by weekday (Monday first), for "most focused day of the week".
    const weekdays = [0, 0, 0, 0, 0, 0, 0];
    for (const t of grown) weekdays[(keyDate(dayOf(t.at)).getUTCDay() + 6) % 7] += t.minutes;
    const best = weekdays.indexOf(Math.max(...weekdays));
    return { ...range, trees: inRange, grown: grown.length, withered: inRange.length - grown.length, minutes: grown.reduce((n, t) => n + t.minutes, 0), slots, weekdays, bestWeekday: grown.length ? best : -1 };
}
