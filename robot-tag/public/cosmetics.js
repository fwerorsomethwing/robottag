// Cosméticos, monedas y perfil del jugador (se guarda en el navegador).
// Sin DOM: se prueba en Node (test/cosmetics.test.mjs).
import * as THREE from 'three';

export const SLOTS = ['head', 'badge']; // deben coincidir con COS_SLOTS de server.js

/** Catálogo. Para añadir un cosmético: una entrada aquí y un constructor en BUILDERS. */
export const CATALOG = [
  { id: 'early_badge', slot: 'badge', name: 'Early Access Badge', price: 0 }, // gratis: para los primeros jugadores
  { id: 'headphones', slot: 'head', name: 'Headphones', price: 50 },
];

export const PALETTE = [
  0x3da5ff, 0x45e08a, 0xffd23d, 0xc16bff, 0xff7fb0, 0x5ff0e0,
  0xffffff, 0x9aa7ff, 0xa0e84a, 0xb0b8c8, 0x7a5cff, 0x2dd4bf,
];

const byId = new Map(CATALOG.map((c) => [c.id, c]));
export const itemById = (id) => byId.get(id) || null;

// ---------- Modelos 3D (se cuelgan del grupo del robot; la cabeza está en el origen, el frente es -Z) ----------
const std = (color, o = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: o.roughness ?? 0.5,
    metalness: o.metalness ?? 0.1,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 0,
  });

function starShape(outer, inner, points = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / points;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

const BUILDERS = {
  // Diadema sobre la cabeza y dos almohadillas con un detalle luminoso.
  headphones() {
    const g = new THREE.Group();
    const dark = std(0x2b2f3a, { metalness: 0.3, roughness: 0.4 });
    const glow = std(0x00e5ff, { emissive: 0x00bcd4, emissiveIntensity: 0.9 });
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.188, 0.013, 10, 32, Math.PI), dark));
    for (const side of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.055, 24), dark);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.19, 0, 0);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.012, 20), glow);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(side * 0.221, 0, 0);
      g.add(cup, cap);
    }
    return g;
  },

  // Insignia dorada con una estrella, en el pecho (lado izquierdo del robot).
  early_badge() {
    const g = new THREE.Group();
    const gold = std(0xffc83d, { metalness: 0.7, roughness: 0.3 });
    const dark = std(0x3a2a00, { roughness: 0.6 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 28), gold);
    disc.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.005, 8, 28), gold);
    rim.position.z = -0.006;
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.034, 0.015), { depth: 0.006, bevelEnabled: false }), dark);
    star.position.z = -0.012;
    g.add(disc, rim, star);
    g.position.set(-0.075, -0.3, -0.104);
    return g;
  },
};

/** Devuelve el modelo del cosmético o null si no existe. */
export function buildCosmetic(id) {
  const make = BUILDERS[id];
  return make ? make() : null;
}

// ---------- Perfil ----------
const KEY = 'robottag.profile.v1';
export const NAME_MAX = 12;

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* sin almacenamiento */ }
  return null;
}

const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

export class Profile {
  constructor(storage = defaultStorage()) {
    this.storage = storage;
    this.name = '';
    this.color = randomColor();
    this.coins = 0;
    this.owned = new Set(CATALOG.filter((c) => c.price === 0).map((c) => c.id));
    this.equipped = {};
    for (const c of CATALOG) if (c.price === 0 && !this.equipped[c.slot]) this.equipped[c.slot] = c.id; // lo gratis viene puesto
    this.best = {};
    this.load();
  }

  load() {
    let d;
    try {
      d = JSON.parse(this.storage.getItem(KEY));
    } catch {
      d = null;
    }
    if (!d || typeof d !== 'object') return;
    if (typeof d.name === 'string') this.name = d.name.slice(0, NAME_MAX);
    if (Number.isInteger(d.color) && d.color >= 0 && d.color <= 0xffffff) this.color = d.color;
    if (Number.isFinite(d.coins) && d.coins >= 0) this.coins = Math.floor(d.coins);
    if (Array.isArray(d.owned)) for (const id of d.owned) if (byId.has(id)) this.owned.add(id);
    if (d.equipped && typeof d.equipped === 'object') {
      this.equipped = {};
      for (const slot of SLOTS) {
        const id = d.equipped[slot];
        if (typeof id === 'string' && this.owned.has(id) && byId.get(id).slot === slot) this.equipped[slot] = id;
      }
    }
    if (d.best && typeof d.best === 'object') {
      for (const [k, v] of Object.entries(d.best)) if (Number.isFinite(v) && v > 0) this.best[k] = v;
    }
  }

  save() {
    try {
      this.storage.setItem(KEY, JSON.stringify({
        name: this.name,
        color: this.color,
        coins: this.coins,
        owned: [...this.owned],
        equipped: this.equipped,
        best: this.best,
      }));
    } catch { /* sin almacenamiento: el perfil dura lo que dure la página */ }
  }

  /** Lo que ven los demás jugadores (se manda al servidor). */
  publicInfo() {
    return { name: this.name, color: this.color, cos: { ...this.equipped } };
  }

  setName(name) {
    this.name = String(name || '').slice(0, NAME_MAX);
    this.save();
  }

  setColor(color) {
    if (Number.isInteger(color) && color >= 0 && color <= 0xffffff) this.color = color;
    this.save();
  }

  addCoins(n) {
    this.coins = Math.max(0, this.coins + Math.floor(n));
    this.save();
  }

  isEquipped(id) {
    const it = byId.get(id);
    return !!it && this.equipped[it.slot] === id;
  }

  /** Compra y equipa. @returns {{ok: boolean, reason?: 'unknown'|'owned'|'coins', missing?: number}} */
  buy(id) {
    const it = byId.get(id);
    if (!it) return { ok: false, reason: 'unknown' };
    if (this.owned.has(id)) return { ok: false, reason: 'owned' };
    if (this.coins < it.price) return { ok: false, reason: 'coins', missing: it.price - this.coins };
    this.coins -= it.price;
    this.owned.add(id);
    this.equipped[it.slot] = id;
    this.save();
    return { ok: true };
  }

  /** Si lo tienes, lo pone o lo quita. Si no, intenta comprarlo. */
  toggle(id) {
    const it = byId.get(id);
    if (!it) return { ok: false, reason: 'unknown' };
    if (!this.owned.has(id)) return this.buy(id);
    if (this.equipped[it.slot] === id) delete this.equipped[it.slot];
    else this.equipped[it.slot] = id;
    this.save();
    return { ok: true, equipped: this.isEquipped(id) };
  }

  unequipAll() {
    this.equipped = {};
    this.save();
  }

  /** Guarda el mejor tiempo. @returns {{first: boolean, improved: boolean, best: number}} */
  recordTime(courseId, seconds) {
    const prev = this.best[courseId];
    const first = prev === undefined;
    const improved = first || seconds < prev;
    if (improved) this.best[courseId] = seconds;
    this.save();
    return { first, improved, best: this.best[courseId] };
  }
}
