// Measures how well aircraft follow the painted lines: distance from each gear to the nearest
// painted taxi line, lead-in, lead-on/off curve or runway centreline. Used by the headless check
// and the in-browser inspection.
const CELL = 25;

export function createLineIndex(graph) {
  const segs = [];
  const paint = graph.paintLines();
  for (const [a, b] of paint.straight) segs.push([a, b]);
  for (const arc of paint.arcs) for (let i = 1; i < arc.pts.length; i++) segs.push([arc.pts[i - 1], arc.pts[i]]);
  for (const e of graph.edges) {
    if (e.kind !== 'runway') continue;
    const a = graph.nodes[e.a];
    const b = graph.nodes[e.b];
    segs.push([[a.x, a.y], [b.x, b.y]]);
  }
  const grid = new Map();
  segs.forEach(([a, b], i) => {
    const x0 = Math.floor(Math.min(a[0], b[0]) / CELL);
    const x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
    const y0 = Math.floor(Math.min(a[1], b[1]) / CELL);
    const y1 = Math.floor(Math.max(a[1], b[1]) / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  });
  return {
    segments: segs.length,
    distance([px, py]) {
      const cx = Math.floor(px / CELL);
      const cy = Math.floor(py / CELL);
      let best = Infinity;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (const id of grid.get(`${cx + i},${cy + j}`) ?? []) {
            const [a, b] = segs[id];
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
            best = Math.min(best, Math.hypot(a[0] + dx * t - px, a[1] + dy * t - py));
          }
        }
      }
      return best;
    },
  };
}

// Distance of an aircraft's nose gear and main gear from the nearest painted line (metres).
export function gearDeviation(index, f) {
  const c = Math.cos(f.heading);
  const s = Math.sin(f.heading);
  const nose = [f.x + c * f.gN, f.y + s * f.gN];
  const main = [nose[0] - c * f.wb, nose[1] - s * f.wb];
  return { nose: index.distance(nose), main: index.distance(main) };
}
