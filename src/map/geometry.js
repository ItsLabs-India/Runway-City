// Small 2D geometry helpers. Points are [x, y] in metres.

export function closestOnSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { x, y, t, dist: Math.hypot(px - x, py - y) };
}

// Nearest point on a polyline (or closed ring) to p, with the segment direction there.
export function closestOnPolyline(p, points) {
  let best = { dist: Infinity };
  for (let i = 1; i < points.length; i++) {
    const c = closestOnSegment(p, points[i - 1], points[i]);
    if (c.dist < best.dist) {
      const dx = points[i][0] - points[i - 1][0];
      const dy = points[i][1] - points[i - 1][1];
      const len = Math.hypot(dx, dy) || 1;
      best = { ...c, dir: [dx / len, dy / len] };
    }
  }
  return best;
}

export function polygonArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  return Math.abs(a / 2);
}

export function centroid(points) {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}

export function pointInPolygon([px, py], points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export const overlaps = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

// Deterministic pseudo-random numbers from an integer seed (stable props across reloads).
export function seeded(seed) {
  let s = (Number(seed) % 2147483647) || 1;
  const next = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  next.getState = () => s; // so a saved game continues with the same random sequence
  next.setState = (v) => {
    s = v;
  };
  return next;
}

export function polylineLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return len;
}

// Point and direction at distance d along a polyline.
export function alongPolyline(points, d) {
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (d <= seg || i === points.length - 1) {
      const t = seg ? Math.min(1, d / seg) : 0;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dir: [(bx - ax) / (seg || 1), (by - ay) / (seg || 1)] };
    }
    d -= seg;
  }
  return { x: points[0][0], y: points[0][1], dir: [1, 0] };
}
