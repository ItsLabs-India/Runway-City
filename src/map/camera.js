// Top-down 2D camera: drag to pan (with a little glide), wheel / pinch / keys to zoom, click detection.
// World units are metres: x east, y south. `scale` is screen pixels per metre.
const CLICK_SLOP_PX = 5;
const KEY_PAN_PX_PER_S = 700;
const FRICTION_PER_S = 6;

export class Camera2D {
  constructor(canvas, { scale = 0.2, minScale = 0.03, maxScale = 25, bounds = null } = {}) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.scale = scale;
    this.minScale = minScale;
    this.maxScale = maxScale;
    this.bounds = bounds; // { minX, minY, maxX, maxY } the centre may not leave
    this.velocity = [0, 0]; // screen px/s glide after a drag
    this.keys = new Set();
    this.pointers = new Map();
    this.onClick = null;
    this.following = null; // object with x, y
    this.#bindEvents();
  }

  get width() {
    return this.canvas.clientWidth;
  }

  get height() {
    return this.canvas.clientHeight;
  }

  // Sets ctx so that drawing in world metres lands on screen (dpr-aware).
  applyTo(ctx, dpr) {
    const s = this.scale * dpr;
    ctx.setTransform(s, 0, 0, s, dpr * (this.width / 2 - this.x * this.scale), dpr * (this.height / 2 - this.y * this.scale));
  }

  worldToScreen(x, y) {
    return [(x - this.x) * this.scale + this.width / 2, (y - this.y) * this.scale + this.height / 2];
  }

  screenToWorld(sx, sy) {
    return [(sx - this.width / 2) / this.scale + this.x, (sy - this.height / 2) / this.scale + this.y];
  }

  // Visible world rectangle, for culling.
  view(marginPx = 0) {
    const [x0, y0] = this.screenToWorld(-marginPx, -marginPx);
    const [x1, y1] = this.screenToWorld(this.width + marginPx, this.height + marginPx);
    return { minX: x0, minY: y0, maxX: x1, maxY: y1 };
  }

  setView({ x, y, scale }) {
    this.following = null;
    this.x = x;
    this.y = y;
    if (scale) this.scale = scale;
    this.velocity = [0, 0];
    this.#clamp();
  }

  zoomAt(factor, sx = this.width / 2, sy = this.height / 2) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    if (!this.following) {
      const [nx, ny] = this.screenToWorld(sx, sy);
      this.x += wx - nx;
      this.y += wy - ny;
    }
    this.#clamp();
  }

  panBy(dxPx, dyPx) {
    this.following = null;
    this.x -= dxPx / this.scale;
    this.y -= dyPx / this.scale;
    this.#clamp();
  }

  update(dt) {
    const kx = (this.keys.has('arrowright') || this.keys.has('d') ? 1 : 0) - (this.keys.has('arrowleft') || this.keys.has('a') ? 1 : 0);
    const ky = (this.keys.has('arrowdown') || this.keys.has('s') ? 1 : 0) - (this.keys.has('arrowup') || this.keys.has('w') ? 1 : 0);
    if (kx || ky) this.panBy(-kx * KEY_PAN_PX_PER_S * dt, -ky * KEY_PAN_PX_PER_S * dt);

    if (this.pointers.size === 0 && Math.hypot(...this.velocity) > 5) {
      this.panBy(this.velocity[0] * dt, this.velocity[1] * dt);
      const decay = Math.exp(-FRICTION_PER_S * dt);
      this.velocity = [this.velocity[0] * decay, this.velocity[1] * decay];
    }

    if (this.following) {
      this.x = this.following.x;
      this.y = this.following.y;
    }
  }

  #clamp() {
    if (!this.bounds) return;
    this.x = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, this.x));
    this.y = Math.min(this.bounds.maxY, Math.max(this.bounds.minY, this.y));
  }

  #bindEvents() {
    const el = this.canvas;
    el.style.touchAction = 'none';

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
    }, { passive: false });

    let dragged = false;
    let pinch = null;
    let lastMove = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      this.velocity = [0, 0];
      dragged = false;
      if (this.pointers.size === 2) pinch = this.#pinchState();
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.offsetX - p.x;
      const dy = e.offsetY - p.y;
      if (this.pointers.size === 2) {
        p.x = e.offsetX;
        p.y = e.offsetY;
        const next = this.#pinchState();
        if (pinch && pinch.dist > 0) this.zoomAt(next.dist / pinch.dist, next.cx, next.cy);
        if (pinch) this.panBy(next.cx - pinch.cx, next.cy - pinch.cy);
        pinch = next;
        dragged = true;
        return;
      }
      if (!dragged && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
      dragged = true;
      this.panBy(dx, dy);
      const now = performance.now();
      const dtMove = Math.max(1, now - lastMove) / 1000;
      this.velocity = [dx / dtMove, dy / dtMove];
      lastMove = now;
      p.x = e.offsetX;
      p.y = e.offsetY;
    });
    const release = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (performance.now() - lastMove > 80) this.velocity = [0, 0]; // no glide after a pause
      if (!dragged && e.type === 'pointerup') this.onClick?.(e.offsetX, e.offsetY);
      pinch = this.pointers.size === 2 ? this.#pinchState() : null;
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === '+' || k === '=') this.zoomAt(1.3);
      else if (k === '-' || k === '_') this.zoomAt(1 / 1.3);
      else if (k === 'escape') this.following = null;
      else this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  #pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }
}
