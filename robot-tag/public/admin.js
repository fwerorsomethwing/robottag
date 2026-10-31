// Herramientas del dueño (1.0.2.3): panel de admin flotante, Kick Gun y NaN Gun.
// El panel es una pantalla que aparece delante del jugador; se pulsa con la mira (PC), tocando (móvil)
// o tocándola con la mano (VR). Se abre con P (PC), el botón ⚙ (móvil) o el botón de agarre (grip) de cualquier mando.
// Todo lo que hacen estas herramientas lo vuelve a comprobar el servidor: solo vale si eres el dueño confirmado.
// Sin DOM: se prueba en Node (test/admin.test.mjs).
import * as THREE from 'three';
import { raySphere } from './locomotion.js';

export const TOOLS = {
  kick: { name: 'KICK GUN', color: 0xff3b3b, css: '#ff3b3b', hint: 'Expulsa a quien le aciertes' },
  nan: { name: 'NaN GUN', color: 0x39ff88, css: '#39ff88', hint: 'Congela y "glitchea" 8 s a quien le aciertes' },
};

// ---------- Un plano en el mundo (para apuntar o tocar el panel) ----------
// center: {x,y,z}. yaw: hacia dónde miraba el jugador al abrirlo. El panel mira de vuelta hacia él.

export function makePlane(center, yaw, w, h) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return {
    c: { x: center.x, y: center.y, z: center.z },
    yaw, w, h,
    R: { x: c, y: 0, z: -s }, // derecha del jugador (u crece hacia ahí)
    N: { x: s, y: 0, z: c },  // normal: hacia el jugador
  };
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Punto del panel al que apunta un rayo ({u,v} de 0 a 1, t = distancia) o null. */
export function planeRay(pl, o, d, maxT = 6) {
  const denom = dot(d, pl.N);
  if (denom > -1e-6) return null; // de espaldas o paralelo
  const t = ((pl.c.x - o.x) * pl.N.x + (pl.c.y - o.y) * pl.N.y + (pl.c.z - o.z) * pl.N.z) / denom;
  if (t < 0 || t > maxT) return null;
  const rel = { x: o.x + d.x * t - pl.c.x, y: o.y + d.y * t - pl.c.y, z: o.z + d.z * t - pl.c.z };
  const x = dot(rel, pl.R), y = rel.y;
  if (Math.abs(x) > pl.w / 2 || Math.abs(y) > pl.h / 2) return null;
  return { u: x / pl.w + 0.5, v: 0.5 - y / pl.h, t };
}

/** Dónde está un punto (la mano) respecto al panel: {u, v, z} (z = distancia por delante; negativa = atravesado) o null si está fuera. */
export function planePoke(pl, p, front = 0.3, back = 0.2) {
  const rel = { x: p.x - pl.c.x, y: p.y - pl.c.y, z: p.z - pl.c.z };
  const x = dot(rel, pl.R), z = dot(rel, pl.N);
  if (Math.abs(x) > pl.w / 2 || Math.abs(rel.y) > pl.h / 2 || z < -back || z > front) return null;
  return { u: x / pl.w + 0.5, v: 0.5 - rel.y / pl.h, z };
}

// ---------- Puntería ----------
export const BODY_R = 0.55; // se acierta a la cabeza y al torso

/**
 * Jugador al que apunta un rayo. targets = [{id, x, y, z}] (y = cabeza). blockT: distancia a la que hay una pared
 * (no se dispara a través de ellas).
 */
export function pickTarget(origin, dir, targets, maxT = 40, blockT = Infinity) {
  let best = null;
  for (const t of targets) {
    const h = raySphere(origin, dir, { c: new THREE.Vector3(t.x, t.y - 0.25, t.z), r: BODY_R }, maxT);
    if (h && h.t < blockT && (!best || h.t < best.t)) best = { id: t.id, t: h.t };
  }
  return best;
}

// ---------- Modelos de las pistolas (van en la mano derecha, apuntando hacia -Z) ----------
export function buildGun(tool) {
  const info = TOOLS[tool];
  if (!info) return null;
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.45, metalness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: info.color, emissive: info.color, emissiveIntensity: 1.0, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.2), dark);
  body.position.set(0, 0, -0.04);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.16, 12), dark);
  barrel.rotation.x = -Math.PI / 2; // eje -Z
  barrel.position.set(0, 0.008, -0.2);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.1, 0.055), dark);
  grip.position.set(0, -0.075, 0.03);
  grip.rotation.x = 0.25;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.014, 0.14), glow);
  stripe.position.set(0, 0.03, -0.04);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), glow);
  muzzle.position.set(0, 0.008, -0.285);
  g.add(body, barrel, grip, stripe, muzzle);
  g.position.set(0, 0.02, -0.05);
  g.rotation.x = 0.08;
  return g;
}

// ---------- El panel ----------
export const PANEL = { W: 1024, H: 680, ROWS: 4 };

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

export class AdminUI {
  /**
   * @param getState () => {players: {id, name, nan}[], tool: ''|'kick'|'nan', map: string}
   * @param actions  {tool(t), kick(id), nan(id), unnan(id), lava(id), newRound(), unnanAll(), toggleTest(), close()}
   */
  constructor({ getState, actions }) {
    this.getState = getState;
    this.actions = actions;
    this.buttons = [];
    this.hover = -1;
    this.page = 0;
    this.note = '';
    this.noteUntil = 0;
    this.dirty = true;
    this.build();
  }

  say(text, ms = 2500, now = Date.now()) {
    this.note = text; this.noteUntil = now + ms; this.dirty = true;
  }

  /** Vuelve a colocar los botones según el estado actual. */
  build() {
    const st = this.getState();
    const { W, ROWS } = PANEL;
    const b = [];
    const add = (o) => b.push(o);
    add({ id: 'close', x: 900, y: 12, w: 100, h: 54, label: 'X', color: '#b8442f', onPress: () => this.actions.close() });
    [['', 'SIN ARMA', '#3a4261'], ['kick', TOOLS.kick.name, '#a82f2f'], ['nan', TOOLS.nan.name, '#1d8f55']].forEach(([t, label, color], i) => {
      add({
        id: 'tool-' + (t || 'none'), x: 24 + i * 338, y: 88, w: 310, h: 70, label,
        sub: t ? (st.tool === t ? 'EQUIPADA' : 'toca para equipar') : st.tool ? 'toca para guardar' : 'sin arma',
        color, active: st.tool === t,
        onPress: () => this.actions.tool(t),
      });
    });
    const players = st.players;
    const pages = Math.max(1, Math.ceil(players.length / ROWS));
    this.page = Math.min(this.page, pages - 1);
    players.slice(this.page * ROWS, this.page * ROWS + ROWS).forEach((p, i) => {
      const y = 214 + i * 66;
      add({ id: 'kick-' + p.id, x: 520, y, w: 190, h: 56, label: 'EXPULSAR', color: '#a82f2f', onPress: () => this.actions.kick(p.id) });
      add({ id: 'nan-' + p.id, x: 718, y, w: 130, h: 56, label: p.nan ? 'QUITAR NaN' : 'NaN', color: p.nan ? '#6b7a2a' : '#1d8f55', fs: p.nan ? 20 : 26, onPress: () => (p.nan ? this.actions.unnan(p.id) : this.actions.nan(p.id)) });
      add({ id: 'lava-' + p.id, x: 856, y, w: 144, h: 56, label: 'LAVA', color: '#c4561f', onPress: () => this.actions.lava(p.id) });
    });
    if (pages > 1) {
      add({ id: 'prev', x: 24, y: 482, w: 120, h: 46, label: '◀', color: '#2f4aa8', onPress: () => { this.page = (this.page + pages - 1) % pages; this.dirty = true; } });
      add({ id: 'next', x: 880, y: 482, w: 120, h: 46, label: '▶', color: '#2f4aa8', onPress: () => { this.page = (this.page + 1) % pages; this.dirty = true; } });
    }
    add({ id: 'newround', x: 24, y: 548, w: 310, h: 74, label: 'RONDA NUEVA', sub: 'sortea otra LAVA', color: '#c4561f', onPress: () => this.actions.newRound() });
    add({ id: 'unnanall', x: 362, y: 548, w: 310, h: 74, label: 'QUITAR NaN A TODOS', color: '#1d8f55', fs: 24, onPress: () => this.actions.unnanAll() });
    add({ id: 'testmap', x: 700, y: 548, w: 300, h: 74, label: st.map === 'test' ? 'VOLVER A LA PLAZA' : 'MAPA DE PRUEBAS', fs: 26, color: '#2f4aa8', onPress: () => this.actions.toggleTest() });
    this.buttons = b;
    this.pages = pages;
    this.dirty = true;
  }

  indexAt(u, v) {
    const x = u * PANEL.W, y = v * PANEL.H;
    return this.buttons.findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  }

  hoverAt(u, v) {
    const i = this.indexAt(u, v);
    if (i !== this.hover) { this.hover = i; this.dirty = true; }
  }

  clearHover() {
    if (this.hover !== -1) { this.hover = -1; this.dirty = true; }
  }

  /** Pulsa el botón que haya en (u, v). @returns {string|null} id del botón pulsado */
  pressAt(u, v) {
    const i = this.indexAt(u, v);
    if (i < 0) return null;
    this.buttons[i].onPress();
    this.build();
    return this.buttons[i].id;
  }

  draw(ctx, now = Date.now()) {
    const { W, H, ROWS } = PANEL;
    const st = this.getState();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2a1230'; ctx.fillRect(0, 0, W, 78);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = 'bold 40px sans-serif'; ctx.fillStyle = '#ffcf33';
    ctx.fillText('PANEL DE ADMIN', 28, 40);

    ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = '#9fb0e6';
    ctx.fillText('JUGADORES EN LA SALA (' + st.players.length + ')', 28, 190);
    if (!st.players.length) {
      ctx.font = '28px sans-serif'; ctx.fillStyle = '#6f7aa0';
      ctx.fillText('No hay nadie más conectado', 28, 250);
    }
    st.players.slice(this.page * ROWS, this.page * ROWS + ROWS).forEach((p, i) => {
      const y = 214 + i * 66;
      ctx.fillStyle = i % 2 ? '#10172e' : '#141c38';
      ctx.fillRect(16, y - 5, W - 32, 66);
      ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'left';
      ctx.fillStyle = p.nan ? '#39ff88' : '#ffffff';
      let name = p.name;
      while (ctx.measureText(name).width > 380 && name.length > 3) name = name.slice(0, -1);
      ctx.fillText((p.nan ? '[NaN] ' : '') + name, 28, y + 28);
    });
    if (this.pages > 1) {
      ctx.textAlign = 'center'; ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = '#9fb0e6';
      ctx.fillText((this.page + 1) + ' / ' + this.pages, W / 2, 505);
    }

    this.buttons.forEach((b, i) => {
      roundRect(ctx, b.x, b.y, b.w, b.h, 14);
      ctx.fillStyle = b.color; ctx.fill();
      if (i === this.hover) { ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill(); }
      if (b.active) { ctx.lineWidth = 7; ctx.strokeStyle = '#ffffff'; ctx.stroke(); }
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + (b.fs || 30) + 'px sans-serif';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + (b.sub ? b.h * 0.36 : b.h / 2));
      if (b.sub) { ctx.font = '19px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(b.sub, b.x + b.w / 2, b.y + b.h * 0.74); }
    });
    ctx.textAlign = 'center'; ctx.font = '22px sans-serif';
    const hint = this.noteUntil > now ? this.note : (st.tool ? TOOLS[st.tool].name + ': ' + TOOLS[st.tool].hint + ' (F / gatillo)' : 'Elige un arma o usa los botones de cada jugador');
    ctx.fillStyle = this.noteUntil > now ? '#ffd23d' : '#8d98c4';
    ctx.fillText(hint, W / 2, 652);
    this.dirty = false;
  }
}
