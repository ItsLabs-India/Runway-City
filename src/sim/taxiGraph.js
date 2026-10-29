// Ground movement network built from the real taxiways and runways: nodes where OSM ways share
// points, dangling ends snapped onto nearby edges, stands linked by their lead-in lines.
// A* routing; runway edges carry a penalty so aircraft cross runways only when they must.

const MERGE_M = 1.2;
const SNAP_M = 7;
const LEAD_IN_M = 70;

export class TaxiGraph {
  constructor({ taxiways, runways }) {
    this.nodes = []; // { id, x, y, edges: [edgeId] }
    this.edges = []; // { id, a, b, len, kind: 'taxi' | 'runway' | 'stand', ref, standId? }
    this.grid = new Map();
    for (const t of taxiways) this.#addLine(t.points, 'taxi', t.ref);
    for (const r of runways) if (!r.stopway) this.#addLine(r.points, 'runway', r.ref);
    this.#snapDanglingEnds();
    this.standNode = new Map(); // standId -> { node, entry }
  }

  // Corridors: stretches of taxiway between junctions (nodes with 3+ edges). Each taxi edge gets
  // e.corr (corridor id) and e.corrDir (+1 if a→b runs along the corridor's own direction).
  // Call after all stands are linked, since stand lead-ins create junctions on the taxilanes.
  // Number of taxiway/runway edges at a node, not counting stand lead-ins.
  junctionDegree(id) {
    return this.nodes[id].edges.filter((e) => this.edges[e].kind !== 'stand').length;
  }

  buildCorridors() {
    let next = 0;
    for (const e of this.edges) delete e.corr;
    // Stand lead-ins do not split a corridor: the apron taxilane between two real taxiway
    // junctions is one stretch (as ground control treats it).
    const isJunction = (id) => this.junctionDegree(id) !== 2;
    for (const start of this.edges) {
      if (start.kind !== 'taxi' || start.corr !== undefined) continue;
      const id = next++;
      start.corr = id;
      start.corrDir = 1;
      // Walk forward from b and backward from a through two-edge nodes.
      for (const [from, sign] of [[start.b, 1], [start.a, -1]]) {
        let node = from;
        let came = start;
        while (!isJunction(node)) {
          const nextId = this.nodes[node].edges.find((x) => x !== came.id && this.edges[x].kind !== 'stand');
          const e = this.edges[nextId];
          if (!e || e.kind !== 'taxi' || e.corr !== undefined) break;
          e.corr = id;
          // Along the corridor's direction means leaving `node` forward when sign is +1.
          e.corrDir = (e.a === node ? 1 : -1) * sign;
          came = e;
          node = e.a === node ? e.b : e.a;
        }
      }
    }
    this.corridorCount = next;
  }

  #key(x, y) {
    return `${Math.floor(x / 4)},${Math.floor(y / 4)}`;
  }

  #node(x, y) {
    const cx = Math.floor(x / 4);
    const cy = Math.floor(y / 4);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const id of this.grid.get(`${cx + i},${cy + j}`) ?? []) {
          const n = this.nodes[id];
          if (Math.hypot(n.x - x, n.y - y) < MERGE_M) return id;
        }
      }
    }
    const id = this.nodes.length;
    this.nodes.push({ id, x, y, edges: [] });
    const k = this.#key(x, y);
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k).push(id);
    return id;
  }

  #edge(a, b, kind, ref, extra = {}) {
    if (a === b) return null;
    const na = this.nodes[a];
    const nb = this.nodes[b];
    const id = this.edges.length;
    const e = { id, a, b, len: Math.hypot(nb.x - na.x, nb.y - na.y), kind, ref, ...extra };
    this.edges.push(e);
    na.edges.push(id);
    nb.edges.push(id);
    return e;
  }

  #addLine(points, kind, ref) {
    let prev = null;
    for (const [x, y] of points) {
      const id = this.#node(x, y);
      if (prev !== null && prev !== id) this.#edge(prev, id, kind, ref);
      prev = id;
    }
  }

  // Splits edge e at the point closest to (x, y); returns the new (or an existing end) node.
  #split(e, x, y) {
    const a = this.nodes[e.a];
    const b = this.nodes[e.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    if (Math.hypot(px - a.x, py - a.y) < 2) return e.a;
    if (Math.hypot(px - b.x, py - b.y) < 2) return e.b;
    const mid = this.#node(px, py);
    // Re-point the old edge to end at mid, and add mid -> b.
    const oldB = e.b;
    b.edges = b.edges.filter((id) => id !== e.id);
    e.b = mid;
    e.len = Math.hypot(px - a.x, py - a.y);
    this.nodes[mid].edges.push(e.id);
    this.#edge(mid, oldB, e.kind, e.ref);
    return mid;
  }

  #closestEdge(x, y, filter) {
    let best = null;
    for (const e of this.edges) {
      if (filter && !filter(e)) continue;
      const a = this.nodes[e.a];
      const b = this.nodes[e.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
      if (!best || d < best.d) best = { e, d, t };
    }
    return best;
  }

  #snapDanglingEnds() {
    for (const n of [...this.nodes]) {
      if (n.edges.length !== 1) continue;
      const own = n.edges[0];
      const hit = this.#closestEdge(n.x, n.y, (e) => e.id !== own && e.a !== n.id && e.b !== n.id);
      if (!hit || hit.d > SNAP_M) continue;
      const target = this.#split(hit.e, n.x, n.y);
      if (target !== n.id) this.#edge(n.id, target, this.edges[own].kind === 'runway' ? 'runway' : 'taxi', this.edges[own].ref);
    }
  }

  // Links a stand (nose stop point + direction) to the nearest taxilane with a lead-in edge.
  addStand(stand) {
    const sx = stand.x - stand.dir[0] * LEAD_IN_M;
    const sy = stand.y - stand.dir[1] * LEAD_IN_M;
    let hit = this.#closestEdge(sx, sy, (e) => e.kind === 'taxi');
    if (!hit || hit.d > 120) hit = this.#closestEdge(stand.x, stand.y, (e) => e.kind === 'taxi');
    if (!hit) return null;
    const a = this.nodes[hit.e.a];
    const b = this.nodes[hit.e.b];
    const entry = this.#split(hit.e, a.x + (b.x - a.x) * hit.t, a.y + (b.y - a.y) * hit.t);
    const id = this.nodes.length;
    this.nodes.push({ id, x: stand.x, y: stand.y, edges: [] }); // not in the merge grid: private to the stand
    this.#edge(id, entry, 'stand', `stand ${stand.ref}`, { standId: stand.id });
    const link = { node: id, entry };
    this.standNode.set(stand.id, link);
    return link;
  }

  nearestNode(x, y, filter) {
    let best = null;
    for (const n of this.nodes) {
      if (filter && !filter(n)) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (!best || d < best.d) best = { n, d };
    }
    return best?.n ?? null;
  }

  // --- Taxi lines: one geometry for both the paint and the aircraft ----------------------------
  //
  // Each turn at a node (arriving from p, leaving to q) is a circular fillet tangent to both
  // edges. The painted lines and every aircraft route use exactly these arcs, so aircraft always
  // follow the yellow lines. Radii: 40 m on taxiways and lead-ins, 55 m for runway turn-offs.

  #radius(p, x, q) {
    const kinds = [this.edgeBetween(p, x)?.kind, this.edgeBetween(x, q)?.kind];
    return kinds.includes('runway') ? 55 : 40;
  }

  // { d, pts } — d: distance from the node to where the arc meets each edge; pts: arc samples.
  filletArc(p, x, q) {
    const key = p < q ? `${p}|${x}|${q}` : `${q}|${x}|${p}`;
    let arc = this.arcCache?.get(key);
    if (!arc) {
      const [a, b] = p < q ? [p, q] : [q, p];
      arc = this.#computeArc(this.nodes[a], this.nodes[x], this.nodes[b], this.#radius(a, x, b));
      (this.arcCache ??= new Map()).set(key, arc);
    }
    return p < q ? arc : { ...arc, pts: [...arc.pts].reverse() };
  }

  #computeArc(P, X, Q, R) {
    const inLen = Math.hypot(X.x - P.x, X.y - P.y);
    const outLen = Math.hypot(Q.x - X.x, Q.y - X.y);
    if (inLen < 0.01 || outLen < 0.01) return { d: 0, theta: 0, pts: [[X.x, X.y]] };
    const ui = [(X.x - P.x) / inLen, (X.y - P.y) / inLen];
    const uo = [(Q.x - X.x) / outLen, (Q.y - X.y) / outLen];
    const cross = ui[0] * uo[1] - ui[1] * uo[0];
    const theta = Math.acos(Math.max(-1, Math.min(1, ui[0] * uo[0] + ui[1] * uo[1])));
    if (theta < 0.02) return { d: 0, theta, pts: [[X.x, X.y]] };
    const t = Math.tan(theta / 2);
    const d = Math.min(R * t, inLen * 0.45, outLen * 0.45);
    const r = d / t;
    const s = Math.sign(cross) || 1; // +1 turning right (screen coordinates, y down)
    const t1 = [X.x - ui[0] * d, X.y - ui[1] * d];
    const centre = [t1[0] - ui[1] * r * s, t1[1] + ui[0] * r * s];
    const a0 = Math.atan2(t1[1] - centre[1], t1[0] - centre[0]);
    const steps = Math.max(2, Math.ceil((theta * r) / 2)); // a point every ~2 m
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + s * theta * (i / steps);
      pts.push([centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r]);
    }
    return { d, theta, r, pts };
  }

  // Smooth polyline for a route through graph nodes. `prev` is the node before the first id (the
  // route may start part-way along that edge); `start` points are prepended (e.g. the gear
  // positions of an aircraft already on the line).
  smoothRoute(ids, { prev = null, next = null, start = [] } = {}) {
    const out = [...start];
    for (let i = 0; i < ids.length; i++) {
      const p = i === 0 ? prev : ids[i - 1];
      const q = i === ids.length - 1 ? next : ids[i + 1];
      const n = this.nodes[ids[i]];
      if (p === null || q === null || p === undefined || q === undefined) out.push([n.x, n.y]);
      else out.push(...this.filletArc(p, ids[i], q).pts);
    }
    // Drop repeated points.
    return out.filter((pt, i) => i === 0 || Math.hypot(pt[0] - out[i - 1][0], pt[1] - out[i - 1][1]) > 0.05);
  }

  // Everything to paint: straight centrelines (trimmed where a bend has only one way through)
  // and the turn arcs at every junction, bend and stand lead-in. Runway-to-runway is skipped
  // (white runway paint); arcs onto or off a runway are the yellow lead-on / lead-off lines.
  paintLines(hide = null) {
    const hidden = (e) => hide !== null && e.kind === 'stand' && hide.has(e.standId);
    const straight = [];
    const arcs = [];
    const trim = new Map(); // `${node}|${edge}` -> metres
    for (const n of this.nodes) {
      const nbrs = n.edges.map((id) => {
        const e = this.edges[id];
        return { e, other: e.a === n.id ? e.b : e.a };
      });
      for (let i = 0; i < nbrs.length; i++) {
        for (let j = i + 1; j < nbrs.length; j++) {
          const A = nbrs[i];
          const B = nbrs[j];
          if (A.e.kind === 'runway' && B.e.kind === 'runway') continue;
          if (hidden(A.e) || hidden(B.e)) continue;
          const arc = this.filletArc(A.other, n.id, B.other);
          if (arc.theta < 0.03 || arc.theta > 2.6 || arc.d < 0.3) continue;
          arcs.push({ pts: arc.pts, runway: A.e.kind === 'runway' || B.e.kind === 'runway' });
          if (nbrs.length === 2) {
            trim.set(`${n.id}|${A.e.id}`, arc.d);
            trim.set(`${n.id}|${B.e.id}`, arc.d);
          }
        }
      }
    }
    for (const e of this.edges) {
      if (e.kind === 'runway' || hidden(e)) continue;
      const a = this.nodes[e.a];
      const b = this.nodes[e.b];
      const ux = (b.x - a.x) / (e.len || 1);
      const uy = (b.y - a.y) / (e.len || 1);
      const ta = trim.get(`${e.a}|${e.id}`) ?? 0;
      const tb = trim.get(`${e.b}|${e.id}`) ?? 0;
      if (ta + tb >= e.len) continue;
      straight.push([[a.x + ux * ta, a.y + uy * ta], [b.x - ux * tb, b.y - uy * tb], e.kind]);
    }
    return { straight, arcs };
  }

  edgeBetween(u, v) {
    for (const id of this.nodes[u].edges) {
      const e = this.edges[id];
      if ((e.a === u && e.b === v) || (e.a === v && e.b === u)) return e;
    }
    return null;
  }

  // A*; stand edges only usable at the very start or end. `runwayCost(edge)` adds runway
  // penalties; `extraCost(edge, fromNode)` adds traffic-flow penalties.
  // The search tracks which way the aircraft is facing (state = node + the node it came from), so
  // routes never contain a turn sharper than `maxTurnDeg` — an aircraft cannot reverse on a
  // taxiway. `prev` is where the aircraft is coming from at the start (its facing direction).
  findPath(from, to, { runwayCost = () => 400, extraCost = null, prev = null, maxTurnDeg = 110 } = {}) {
    const goal = this.nodes[to];
    const cosMax = Math.cos((maxTurnDeg * Math.PI) / 180);
    const key = (node, back) => `${node}|${back}`;
    const startKey = key(from, prev);
    const g = new Map([[startKey, 0]]);
    const came = new Map();
    const open = new MinHeap();
    open.push({ node: from, back: prev, k: startKey }, Math.hypot(this.nodes[from].x - goal.x, this.nodes[from].y - goal.y));
    const closed = new Set();
    let endKey = null;
    while (open.size) {
      const { node: u, back, k } = open.pop();
      if (u === to) {
        endKey = k;
        break;
      }
      if (closed.has(k)) continue;
      closed.add(k);
      const U = this.nodes[u];
      const inDir = back === null || back === undefined ? null : [U.x - this.nodes[back].x, U.y - this.nodes[back].y];
      const inLen = inDir ? Math.hypot(...inDir) || 1 : 1;
      for (const eid of U.edges) {
        const e = this.edges[eid];
        const v = e.a === u ? e.b : e.a;
        if (v === back) continue;
        if (e.kind === 'stand' && u !== from && v !== to) continue;
        let cost = e.len;
        if (inDir) {
          const V = this.nodes[v];
          const out = [V.x - U.x, V.y - U.y];
          const cos = (inDir[0] * out[0] + inDir[1] * out[1]) / (inLen * (Math.hypot(...out) || 1));
          if (cos < cosMax) continue; // too sharp to turn
          cost += (1 - cos) * 40; // prefer gentle turns
        }
        if (e.kind === 'runway') cost += runwayCost(e);
        if (extraCost) cost += extraCost(e, u);
        const vk = key(v, u);
        const ng = g.get(k) + cost;
        if (ng < (g.get(vk) ?? Infinity)) {
          g.set(vk, ng);
          came.set(vk, k);
          open.push({ node: v, back: u, k: vk }, ng + Math.hypot(this.nodes[v].x - goal.x, this.nodes[v].y - goal.y));
        }
      }
    }
    if (endKey === null) return null;
    const path = [];
    for (let k = endKey; k !== undefined; k = came.get(k)) path.unshift(Number(k.split('|')[0]));
    return path;
  }

  points(path) {
    return path.map((id) => [this.nodes[id].x, this.nodes[id].y]);
  }

  // Runway nodes of `ref` that connect to at least one taxiway, with distance along the runway
  // from threshold `from` (an [x, y] point) towards `to`.
  runwayExits(ref, from, to) {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const ux = (to[0] - from[0]) / len;
    const uy = (to[1] - from[1]) / len;
    const out = [];
    for (const n of this.nodes) {
      const edges = n.edges.map((id) => this.edges[id]);
      if (!edges.some((e) => e.kind === 'runway' && e.ref === ref)) continue;
      if (!edges.some((e) => e.kind === 'taxi')) continue;
      out.push({ node: n.id, s: (n.x - from[0]) * ux + (n.y - from[1]) * uy });
    }
    return out.sort((a, b) => a.s - b.s);
  }
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(value, priority) {
    const a = this.items;
    a.push({ value, priority });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].priority <= a[i].priority) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].priority < a[m].priority) m = l;
        if (r < a.length && a[r].priority < a[m].priority) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.value;
  }
}
