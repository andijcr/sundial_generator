// Minimal 3D view on a 2D canvas: wall, dial, gnomon, sun ray and day path.
// World coordinates: [east, north, up] in millimetres, origin at the gnomon foot F.
// Drag to orbit, wheel to zoom.

import { sunVector } from './astro.js';
import { dot, bladeHeight } from './dial.js';

const COLORS = {
  hour: '#1b1b1b', hourMinor: '#777', hourExt: '#999', zone: '#1f5fa8', zoneMinor: '#7fa3cf', zoneExt: '#9bb6d8',
  anaR: '#c0392b', anaF: '#c0392b', tick: '#c0392b', date: '#2a7f62', dateMinor: '#6aa88f',
  ital: '#8e44ad', bab: '#d35400', az: '#999', alt: '#999', construct: '#aaa',
};

export class View3D {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.yaw = null; this.pitch = 18; this.zoom = 1;
    this.scene = null;
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw -= (e.clientX - drag[0]) * 0.4;
      this.pitch = Math.max(-5, Math.min(85, this.pitch + (e.clientY - drag[1]) * 0.3));
      drag = [e.clientX, e.clientY];
      this.draw();
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.3, Math.min(5, this.zoom * Math.exp(-e.deltaY * 0.001)));
      this.draw();
    }, { passive: false });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  resetView(D) { this.yaw = 180 + D - 35; this.pitch = 18; this.zoom = 1; }

  setScene(sc) {
    if (this.yaw === null) this.resetView(sc.D);
    this.scene = sc;
    this.draw();
  }

  draw() {
    const sc = this.scene;
    if (!sc || !this.c.isConnected) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = this.c.clientWidth, ch = this.c.clientHeight;
    if (!cw || !ch) return;
    if (this.c.width !== Math.round(cw * dpr) || this.c.height !== Math.round(ch * dpr)) {
      this.c.width = Math.round(cw * dpr); this.c.height = Math.round(ch * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
    ctx.fillStyle = dark ? '#1c2230' : '#dfe9f3';
    ctx.fillRect(0, 0, cw, ch);

    const { dial, sun, decl, lat, S } = sc;
    const fr = dial.frame, P = dial.plate, L = dial.L;
    const W = (x, y) => [x * fr.u[0] + y * fr.v[0], x * fr.u[1] + y * fr.v[1], x * fr.u[2] + y * fr.v[2]];
    const size = Math.max(P.w, P.h);
    const target = W(P.w / 2 - P.fx, P.fy - P.h / 2);
    const y = this.yaw * Math.PI / 180, p = this.pitch * Math.PI / 180;
    const dir = [Math.cos(p) * Math.sin(y), Math.cos(p) * Math.cos(y), Math.sin(p)];
    const distc = 2.6 * size / this.zoom;
    const cam = target.map((t, i) => t + dir[i] * distc);
    const fwd = dir.map((d) => -d);
    let right = [fwd[1], -fwd[0], 0];
    const rn = Math.hypot(right[0], right[1]) || 1;
    right = right.map((r) => r / rn);
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    const focal = Math.min(cw, ch) * 1.3;
    const proj = (q) => {
      const d = [q[0] - cam[0], q[1] - cam[1], q[2] - cam[2]];
      const z = dot(d, fwd);
      if (z < 1) return null;
      return [cw / 2 + focal * dot(d, right) / z, ch / 2 - focal * dot(d, up) / z];
    };
    const poly = (pts, fill, stroke, lw = 1) => {
      const pp = pts.map(proj);
      if (pp.some((q) => !q)) return;
      ctx.beginPath();
      pp.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
    };
    const line = (pts, stroke, lw = 1, dash = []) => {
      ctx.beginPath();
      let pen = false;
      for (const q of pts) {
        const s = proj(q);
        if (!s) { pen = false; continue; }
        if (pen) ctx.lineTo(s[0], s[1]); else { ctx.moveTo(s[0], s[1]); pen = true; }
      }
      ctx.setLineDash(dash);
      ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
      ctx.setLineDash([]);
    };

    // ground
    const gz = P.fy - P.h - 0.35 * P.h;
    const G = 2.2 * size;
    const c0 = [target[0], target[1], gz];
    poly([[c0[0] - G, c0[1] - G, gz], [c0[0] + G, c0[1] - G, gz], [c0[0] + G, c0[1] + G, gz], [c0[0] - G, c0[1] + G, gz]], dark ? '#2a3324' : '#c9d8b4');
    ctx.font = `${Math.round(Math.min(cw, ch) / 26)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [lbl, v] of [['N', [0, 1]], ['E', [1, 0]], ['S', [0, -1]], ['W', [-1, 0]]]) {
      const q = proj([c0[0] + v[0] * G * 0.85, c0[1] + v[1] * G * 0.85, gz]);
      if (q) { ctx.fillStyle = dark ? '#cfd8c0' : '#3d4a2c'; ctx.fillText(lbl, q[0], q[1]); }
    }
    // wall
    const wx0 = -P.fx - 0.5 * P.w, wx1 = P.w - P.fx + 0.5 * P.w, wy1 = P.fy + 0.4 * P.h;
    poly([W(wx0, gz), W(wx1, gz), W(wx1, wy1), W(wx0, wy1)].map((q) => [q[0], q[1], q[2]]), '#d9c7a7', '#b9a47f');
    // plate & dial lines
    poly([W(-P.fx, P.fy), W(P.w - P.fx, P.fy), W(P.w - P.fx, P.fy - P.h), W(-P.fx, P.fy - P.h)], '#fbf6ea', '#555');
    for (const layer of dial.layers) {
      const col = COLORS[layer.cls] || '#444';
      for (const l of layer.lines) line(l.map(([x, yy]) => W(x, yy)), col, layer.cls === 'hour' || layer.cls === 'zone' ? 1.4 : 0.8);
    }
    // shadow on the wall
    if (S) {
      const big = 30 * size, n = Math.hypot(S[0], S[1]);
      const Sc = n > big ? [S[0] / n * big, S[1] / n * big] : S;
      if (sc.gPolar && dial.root) { const k = sc.rodX || 1, [rx, ry] = dial.root; poly([W(rx, ry), W(rx * (1 - k), ry * (1 - k)), W(rx + k * (Sc[0] - rx), ry + k * (Sc[1] - ry))], 'rgba(20,20,30,0.35)'); }
      if (sc.gBlade) poly([W(0, bladeHeight(L)), W(0, 0), W(...Sc)], 'rgba(20,20,30,0.35)');
      if (sc.gRod) line([W(0, 0), W(Sc[0] * (sc.rodX || 1), Sc[1] * (sc.rodX || 1))], 'rgba(20,20,30,0.5)', 2);
      if (n <= big) { const q = proj(W(...S)); if (q) { ctx.fillStyle = '#e4572e'; ctx.beginPath(); ctx.arc(q[0], q[1], 3, 0, 7); ctx.fill(); } }
    }
    if (sc.trail && sc.trail.length > 1) line(sc.trail.map(([x, yy]) => W(x, yy)), '#e4572e', 1.2);
    // gnomon
    const N = fr.n.map((v) => v * L);
    if (sc.gPolar && dial.root) { const k = sc.rodX || 1, [rx, ry] = dial.root, R3 = W(rx, ry); poly([R3, W(rx * (1 - k), ry * (1 - k)), N.map((c, i) => R3[i] + k * (c - R3[i]))], 'rgba(60,50,40,0.85)', '#222', 1); }
    if (sc.gBlade) poly([[0, 0, 0], N, W(0, bladeHeight(L))], 'rgba(60,50,40,0.85)', '#222', 1);
    if (sc.gRod) line([[0, 0, 0], N.map((v) => v * (sc.rodX || 1))], '#222', 3);
    // sun path for the day and sun ray
    const Rs = 1.8 * size;
    const path = [];
    for (let H = -180; H <= 180; H += 2) {
      const s = sunVector(decl, H, lat);
      path.push(s[2] > 0 ? N.map((v, i) => v + s[i] * Rs) : null);
    }
    ctx.setLineDash([5, 4]);
    let cur = [];
    for (const q of path) { if (q) cur.push(q); else { if (cur.length > 1) line(cur, '#f0a020', 1.5, [5, 4]); cur = []; } }
    if (cur.length > 1) line(cur, '#f0a020', 1.5, [5, 4]);
    ctx.setLineDash([]);
    if (sun && sun[2] > -0.05) {
      const sp = N.map((v, i) => v + sun[i] * Rs);
      const lit = dot(sun, fr.n) > 0 && sun[2] > 0;
      line([N, sp], lit ? 'rgba(240,160,32,0.9)' : 'rgba(150,150,150,0.6)', 1.5, lit ? [] : [3, 3]);
      const q = proj(sp);
      if (q) {
        ctx.fillStyle = lit ? '#ffcc33' : '#bbb';
        ctx.beginPath(); ctx.arc(q[0], q[1], 9, 0, 7); ctx.fill();
        ctx.strokeStyle = '#e09000'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
}
