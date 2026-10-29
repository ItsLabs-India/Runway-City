// Top-down drawings of the people on the apron and of the working jet bridges, in metres.
import { ROLES } from '../sim/groundcrew.js';

const dot = (ctx, x, y, r) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

// A person seen from above, facing +x: hard hat, shoulders in a hi-vis vest with reflective tape,
// arms and (when walking) legs that swing. anim: stand | walk | work | wave. t is the game clock.
export function drawPerson(ctx, p, scale, t) {
  const role = ROLES[p.role] ?? ROLES.bags;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.heading);
  if (scale < 1.4) {
    // Far out: a dot in the vest colour is enough.
    ctx.fillStyle = role.vest;
    dot(ctx, 0, 0, Math.max(0.35, 1.2 / scale));
    ctx.restore();
    return;
  }
  // People are only half a metre across: draw them larger when zoomed out so they can be seen.
  const k = Math.min(2.2, Math.max(1, 9 / scale));
  ctx.scale(k, k);
  const phase = t * (p.anim === 'walk' ? 7 : 4) + (p.x + p.y) * 0.37;
  const swing = p.anim === 'walk' ? Math.sin(phase) * 0.22 : 0;
  ctx.fillStyle = 'rgba(20,25,20,0.25)';
  dot(ctx, 0.12, 0.12, 0.34); // shadow
  // Legs (dark trousers) step forward and back.
  if (p.anim === 'walk') {
    ctx.fillStyle = '#2a3442';
    ctx.fillRect(-0.08 + swing, -0.16, 0.22, 0.12);
    ctx.fillRect(-0.08 - swing, 0.04, 0.22, 0.12);
  }
  // Arms.
  ctx.strokeStyle = role.vest;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.11;
  ctx.beginPath();
  if (p.anim === 'wave') {
    // Marshalling: arms out to the side, raised and lowered together, orange wands.
    const lift = 0.35 + 0.3 * Math.sin(t * Math.PI * (p.rate ?? 1.2));
    for (const side of [-1, 1]) {
      ctx.moveTo(0, side * 0.2);
      ctx.lineTo(lift * 0.6, side * 0.55);
    }
    ctx.stroke();
    ctx.strokeStyle = '#ff6a00';
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(lift * 0.6, side * 0.55);
      ctx.lineTo(lift * 0.6 + 0.35, side * 0.62);
    }
  } else if (p.anim === 'work') {
    // Reaching forward (chocks, lifting bags, holding the fuel nozzle), bobbing a little.
    const reach = 0.32 + 0.08 * Math.sin(phase);
    ctx.moveTo(0, -0.2);
    ctx.lineTo(reach, -0.12);
    ctx.moveTo(0, 0.2);
    ctx.lineTo(reach, 0.12);
  } else {
    ctx.moveTo(-swing * 0.5, -0.22);
    ctx.lineTo(0.05 - swing, -0.27);
    ctx.moveTo(swing * 0.5, 0.22);
    ctx.lineTo(0.05 + swing, 0.27);
  }
  ctx.stroke();
  // Carried bag.
  if (p.carry) {
    ctx.fillStyle = '#3a5a8c';
    ctx.fillRect(0.2, -0.18, 0.28, 0.36);
  }
  // Body: vest with two reflective stripes.
  ctx.fillStyle = role.vest;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.17, 0.27, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(235,240,245,0.9)';
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  ctx.moveTo(-0.09, -0.24);
  ctx.lineTo(-0.09, 0.24);
  ctx.moveTo(0.06, -0.25);
  ctx.lineTo(0.06, 0.25);
  ctx.stroke();
  // Hard hat (with ear defenders as two dark dots).
  ctx.fillStyle = role.hat;
  dot(ctx, 0.02, 0, 0.13);
  ctx.fillStyle = '#20262c';
  dot(ctx, 0.02, -0.13, 0.045);
  dot(ctx, 0.02, 0.13, 0.045);
  ctx.restore();
}

const rr = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
};

// A jet bridge: rotunda, a telescoping tunnel in three sections, the drive wheels, and the cab with its
// canopy facing the door. b = { rotunda, cab, heading, e, state } from World.jetBridgeSprites().
export function drawJetBridge(ctx, b, scale, t) {
  const [rx, ry] = b.rotunda;
  const [cx, cy] = b.cab;
  // The tunnel ends at the back of the cab.
  const fx = Math.cos(b.heading);
  const fy = Math.sin(b.heading);
  const bx = cx - fx * 2.1;
  const by = cy - fy * 2.1;
  const len = Math.hypot(bx - rx, by - ry) || 1;
  const ang = Math.atan2(by - ry, bx - rx);
  const detail = scale > 1.2;

  // Shadows.
  ctx.save();
  ctx.translate(1.8, 1.8);
  ctx.fillStyle = 'rgba(20,25,20,0.22)';
  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate(ang);
  ctx.fillRect(0, -1.8, len, 3.6);
  ctx.restore();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(b.heading);
  ctx.fillRect(-2.2, -2.3, 4.2, 4.6);
  ctx.restore();
  ctx.restore();

  // Tunnel: three sections that slide into each other (widest at the cab end).
  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate(ang);
  const secs = [[0, len * 0.5, 2.9, '#c3cad1'], [len * 0.36, len * 0.82, 3.2, '#b6bec6'], [len * 0.68, len, 3.5, '#aab3bc']];
  for (const [a, z, wdt, col] of secs) {
    ctx.fillStyle = col;
    ctx.fillRect(a, -wdt / 2, z - a, wdt);
    ctx.strokeStyle = '#5c6670';
    ctx.lineWidth = Math.max(0.12, 0.8 / scale);
    ctx.strokeRect(a, -wdt / 2, z - a, wdt);
    if (detail) {
      ctx.strokeStyle = 'rgba(80,90,100,0.45)';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      for (let x = a + 1.2; x < z - 0.3; x += 1.2) {
        ctx.moveTo(x, -wdt / 2);
        ctx.lineTo(x, wdt / 2); // roof ribs
      }
      ctx.stroke();
    }
  }
  // Drive column and wheel bogie under the outer section.
  if (detail) {
    const wx = len * 0.8;
    ctx.fillStyle = '#2a2f35';
    ctx.fillRect(wx - 0.5, -2.2, 1.0, 0.55);
    ctx.fillRect(wx - 0.5, 1.65, 1.0, 0.55);
    ctx.fillStyle = '#7d8790';
    dot(ctx, wx, 0, 0.45);
  }
  ctx.restore();

  // Rotunda.
  ctx.fillStyle = '#a7b0b9';
  dot(ctx, rx, ry, 3.2);
  ctx.strokeStyle = '#59626b';
  ctx.lineWidth = Math.max(0.15, 0.8 / scale);
  ctx.beginPath();
  ctx.arc(rx, ry, 3.2, 0, Math.PI * 2);
  ctx.stroke();
  if (detail) {
    ctx.fillStyle = '#8f99a3';
    dot(ctx, rx, ry, 1.6);
  }

  // Cab with the canopy (bellows) at the front.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(b.heading);
  ctx.fillStyle = '#b9c1c9';
  rr(ctx, -2.1, -2.2, 4.0, 4.4, 0.4);
  ctx.fill();
  ctx.strokeStyle = '#59626b';
  ctx.lineWidth = Math.max(0.12, 0.8 / scale);
  ctx.stroke();
  ctx.fillStyle = b.e > 0.98 ? '#2b3138' : '#3b434c';
  ctx.fillRect(1.6, -1.9, 0.5 + (b.e > 0.98 ? 0.25 : 0), 3.8); // canopy, closed against the door when docked
  if (detail) {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    for (let y = -1.7; y <= 1.7; y += 0.42) {
      ctx.moveTo(1.6, y);
      ctx.lineTo(2.1, y); // bellows folds
    }
    ctx.stroke();
    ctx.fillStyle = '#26303a';
    ctx.fillRect(-1.6, -1.6, 0.9, 3.2); // operator window
  }
  // Amber light while the bridge drives.
  if (b.state === 'docking' || b.state === 'retracting') {
    ctx.fillStyle = Math.floor(t * 2.5) % 2 === 0 ? '#ffb020' : '#7a4a10';
    dot(ctx, 0, 0, 0.35);
  }
  ctx.restore();
}
