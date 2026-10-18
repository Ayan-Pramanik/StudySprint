// A small force-directed simulation for the note graph: many-body repulsion (Barnes–Hut),
// spring links, and a pull toward the centre. Positions are in graph coordinates.
export type ForceSettings = {center: number; repel: number; link: number; distance: number};
export const defaultForces: ForceSettings = {center: 0.5, repel: 10, link: 1, distance: 120};
export type ForceNode = {id: string; x: number; y: number; vx: number; vy: number; fx?: number; fy?: number};
type Quad = {x0: number; y0: number; size: number; mass: number; cx: number; cy: number; node?: ForceNode; children?: (Quad | undefined)[]};

export class ForceSimulation {
    nodes: ForceNode[];
    settings: ForceSettings;
    alpha = 1;
    readonly alphaMin = 0.002;
    readonly alphaDecay = 1 - Math.pow(0.002, 1 / 300);
    readonly velocityDecay = 0.4;
    // The centre force pulls toward the notes' starting centroid, so the graph stays where it was arranged.
    readonly centerX: number;
    readonly centerY: number;
    private byId: Map<string, ForceNode>;
    private links: {source: ForceNode; target: ForceNode; bias: number; strength: number}[] = [];
    constructor(nodes: {id: string; x: number; y: number}[], links: {source: string; target: string}[], settings: ForceSettings = defaultForces) {
        this.settings = settings;
        this.nodes = nodes.map(n => ({id: n.id, x: n.x, y: n.y, vx: 0, vy: 0}));
        this.byId = new Map(this.nodes.map(n => [n.id, n]));
        this.centerX = this.nodes.reduce((t, n) => t + n.x, 0) / (this.nodes.length || 1);
        this.centerY = this.nodes.reduce((t, n) => t + n.y, 0) / (this.nodes.length || 1);
        const degree = new Map<string, number>();
        const valid = links.filter(l => l.source !== l.target && this.byId.has(l.source) && this.byId.has(l.target));
        for (const l of valid) for (const id of [l.source, l.target]) degree.set(id, (degree.get(id) || 0) + 1);
        // Like d3-force: links attached to well-connected notes are weaker, so hubs do not collapse.
        this.links = valid.map(l => {
            const a = degree.get(l.source)!, b = degree.get(l.target)!;
            return {source: this.byId.get(l.source)!, target: this.byId.get(l.target)!, bias: a / (a + b), strength: 1 / Math.min(a, b)};
        });
    }
    get running() { return this.alpha >= this.alphaMin; }
    node(id: string) { return this.byId.get(id); }
    reheat(alpha = 0.3) { this.alpha = Math.max(this.alpha, alpha); }
    pin(id: string, x: number, y: number) { const n = this.byId.get(id); if (n) { n.fx = x; n.fy = y; } }
    unpin(id: string) { const n = this.byId.get(id); if (n) { delete n.fx; delete n.fy; } }
    tick() {
        this.alpha += -this.alpha * this.alphaDecay;
        const {center, repel, link, distance} = this.settings, alpha = this.alpha;
        for (const l of this.links) {
            const {source: s, target: t} = l;
            let dx = t.x + t.vx - s.x - s.vx || jiggle(), dy = t.y + t.vy - s.y - s.vy || jiggle();
            const d = Math.sqrt(dx * dx + dy * dy), k = (d - distance) / d * alpha * l.strength * link;
            dx *= k; dy *= k;
            t.vx -= dx * l.bias; t.vy -= dy * l.bias;
            s.vx += dx * (1 - l.bias); s.vy += dy * (1 - l.bias);
        }
        if (repel > 0 && this.nodes.length > 1) {
            const tree = buildTree(this.nodes), strength = -repel * 30;
            for (const n of this.nodes) applyRepulsion(tree, n, strength * alpha);
        }
        if (center > 0) {
            const k = center * 0.02 * alpha;
            for (const n of this.nodes) { n.vx -= (n.x - this.centerX) * k; n.vy -= (n.y - this.centerY) * k; }
        }
        for (const n of this.nodes) {
            if (n.fx !== undefined && n.fy !== undefined) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; continue; }
            n.vx *= 1 - this.velocityDecay; n.vy *= 1 - this.velocityDecay;
            n.x += n.vx; n.y += n.vy;
        }
    }
    // Runs the simulation to rest without animation (used for reduced motion).
    settle(maxTicks = 300) { for (let i = 0; i < maxTicks && this.running; i++) this.tick(); }
}

const theta2 = 0.81, minDistance2 = 1, maxDistance2 = 1e6;
function jiggle() { return (Math.random() - 0.5) * 1e-6; }
function buildTree(nodes: ForceNode[]): Quad {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const root: Quad = {x0, y0, size: Math.max(x1 - x0, y1 - y0, 1), mass: 0, cx: 0, cy: 0};
    for (const n of nodes) insert(root, n, 0);
    accumulate(root);
    return root;
}
function insert(q: Quad, n: ForceNode, depth: number) {
    if (!q.children && !q.node) { q.node = n; return; }
    // Coincident points (or very deep trees) share a leaf; repulsion jiggles them apart.
    if (depth > 40) { q.children ||= []; q.children.push({x0: q.x0, y0: q.y0, size: 0, mass: 0, cx: 0, cy: 0, node: n}); return; }
    if (q.node) { const old = q.node; q.node = undefined; q.children = [undefined, undefined, undefined, undefined]; insert(q, old, depth); }
    const half = q.size / 2, right = n.x >= q.x0 + half ? 1 : 0, bottom = n.y >= q.y0 + half ? 1 : 0, i = right + bottom * 2;
    q.children![i] ||= {x0: q.x0 + right * half, y0: q.y0 + bottom * half, size: half, mass: 0, cx: 0, cy: 0};
    insert(q.children![i]!, n, depth + 1);
}
function accumulate(q: Quad) {
    if (q.node) { q.mass = 1; q.cx = q.node.x; q.cy = q.node.y; }
    for (const c of q.children || []) if (c) { accumulate(c); q.cx = (q.cx * q.mass + c.cx * c.mass) / (q.mass + c.mass); q.cy = (q.cy * q.mass + c.cy * c.mass) / (q.mass + c.mass); q.mass += c.mass; }
}
function applyRepulsion(q: Quad, n: ForceNode, strength: number) {
    if (!q.mass || q.node === n && !q.children) return;
    let dx = q.cx - n.x, dy = q.cy - n.y, d2 = dx * dx + dy * dy;
    if (q.children && q.size * q.size / theta2 >= d2) { for (const c of q.children) if (c) applyRepulsion(c, n, strength); if (q.node && q.node !== n) pointForce(q.node, n, strength); return; }
    if (d2 >= maxDistance2) return;
    if (dx === 0) { dx = jiggle(); d2 += dx * dx; }
    if (dy === 0) { dy = jiggle(); d2 += dy * dy; }
    if (d2 < minDistance2) d2 = Math.sqrt(minDistance2 * d2);
    const mass = q.node === n ? q.mass - 1 : q.mass, k = strength * mass / d2;
    n.vx += dx * k; n.vy += dy * k;
}
function pointForce(other: ForceNode, n: ForceNode, strength: number) {
    let dx = other.x - n.x || jiggle(), dy = other.y - n.y || jiggle(), d2 = dx * dx + dy * dy;
    if (d2 < minDistance2) d2 = Math.sqrt(minDistance2 * d2);
    const k = strength * 1 / d2; n.vx += dx * k; n.vy += dy * k;
}
