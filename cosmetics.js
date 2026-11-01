// Cosméticos, monedas y perfil del jugador (se guarda en el navegador).
// Sin DOM: se prueba en Node (test/cosmetics.test.mjs).
import * as THREE from 'three';

export const SLOTS = ['head', 'badge', 'hand']; // deben coincidir con COS_SLOTS de rooms.js

/** Catálogo. Para añadir un cosmético: una entrada aquí y un constructor en BUILDERS. */
export const CATALOG = [
  { id: 'early_badge', slot: 'badge', name: 'Early Access Badge', price: 0 }, // gratis: para los primeros jugadores
  { id: 'headphones', slot: 'head', name: 'Headphones', price: 50 },
  { id: 'stick', slot: 'hand', name: 'Stick', price: 30 }, // un palo en la mano derecha
  // Solo para el dueño del servidor: no se compra ni sale en la tienda. Se desbloquea con la clave de dueño
  // (variable OWNER_KEY del servidor) y el servidor es quien lo comprueba. Lista en OWNER_ONLY de rooms.js.
  { id: 'owner_badge', slot: 'badge', name: 'Owner Badge', price: 0, ownerOnly: true },
];

/** Cosméticos que se pueden comprar (todos menos los de dueño). */
export const SHOP_CATALOG = CATALOG.filter((c) => !c.ownerOnly);
/** Cosméticos que ve un jugador en su computadora: los comprables y, si es dueño, los de dueño. */
export const visibleCatalog = (profile) => CATALOG.filter((c) => !c.ownerOnly || profile.owner);

/** Modelos de cuerpo del robot. 'sketch' = el del boceto; 'kyle' = el robot de cajas del Gorilla Tag de 2020. Deben coincidir con MODELS de rooms.js. */
export const MODELS = [
  { id: 'sketch', name: 'Robot del boceto', desc: 'Cabeza redonda, torso ovalado y brazos grandes' },
  { id: 'kyle', name: 'Kyle (clásico 2020)', desc: 'Robot de cajas con visor, como en el Gorilla Tag de 2020' },
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

const HAND_FONT = '"Segoe Print","Bradley Hand","Comic Sans MS","Marker Felt",cursive';
/** Fuente a mano que se encoge hasta que el texto quepa en maxW. */
function handFont(size, text, maxW, x) {
  const f = (n) => 'bold ' + n + 'px ' + HAND_FONT;
  x.font = f(size);
  while (x.measureText(text).width > maxW && size > 24) { size -= 4; x.font = f(size); }
  return f(size);
}

/** Placa rectangular negra con dibujo (un lienzo 512x330) que mira hacia delante (-Z), en el pecho. */
function badgePlate(draw) {
  const g = new THREE.Group();
  const W = 0.17, H = 0.11, D = 0.008;
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  let face;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 330;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    x.lineJoin = 'round'; x.lineCap = 'round';
    draw(x, c);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    face = new THREE.MeshBasicMaterial({ map: tex });
  } else {
    face = new THREE.MeshBasicMaterial({ color: 0x101010 }); // sin DOM (pruebas en Node): solo la placa
  }
  // Caras de la caja: +x, -x, +y, -y, +z, -z. El dibujo va en -z (hacia delante del robot).
  g.add(new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [black, black, black, black, black, face]));
  g.position.set(-0.08, -0.3, -0.106);
  return g;
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

  // Insignia "Early Access" como en el boceto: fondo negro, "Early" en verde lima y "Access" en rojo, a mano.
  early_badge() {
    return badgePlate((x, c) => {
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#b8f01e'; x.font = handFont(150, 'Early', 470, x); x.fillText('Early', 256, 95);
      x.fillStyle = '#ff2b2b'; x.font = handFont(150, 'Access', 470, x); x.fillText('Access', 256, 235);
    });
  },

  // Insignia de dueño: corona dorada y "OWNER" en dorado sobre negro.
  owner_badge() {
    return badgePlate((x, c) => {
      x.fillStyle = '#ffcf33';
      x.beginPath(); // corona: base y cinco picos
      x.moveTo(166, 140); x.lineTo(150, 40); x.lineTo(206, 90); x.lineTo(256, 28); x.lineTo(306, 90); x.lineTo(362, 40); x.lineTo(346, 140);
      x.closePath(); x.fill();
      x.fillStyle = '#e0402f';
      for (const px of [206, 256, 306]) { x.beginPath(); x.arc(px, 118, 9, 0, Math.PI * 2); x.fill(); }
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = 'bold 128px Impact,"Arial Black",sans-serif';
      let size = 128;
      while (x.measureText('OWNER').width > 470 && size > 30) { size -= 4; x.font = 'bold ' + size + 'px Impact,"Arial Black",sans-serif'; }
      x.lineWidth = 8; x.strokeStyle = '#7a1d12'; x.strokeText('OWNER', 256, 245);
      x.fillStyle = '#ffcf33'; x.fillText('OWNER', 256, 245);
    });
  },

  // Palo de madera en la mano derecha: sale hacia delante y un poco hacia arriba.
  stick() {
    const g = new THREE.Group();
    const wood = std(0x8a5a2b, { roughness: 0.9 });
    const dark = std(0x5e3c1b, { roughness: 0.9 });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.75, 12), wood);
    rod.rotation.x = -Math.PI / 2; // el eje del cilindro pasa de Y a -Z (hacia delante)
    rod.position.z = -0.26;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.019, 12, 10), dark);
    tip.position.z = -0.635;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 10), dark);
    knob.position.z = 0.115;
    g.add(rod, tip, knob);
    g.rotation.x = 0.35;
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
    this.model = 'sketch';
    this.owner = false;      // ¿el servidor confirmó que eres el dueño? (solo durante la sesión)
    this.ownerSeen = false;  // ¿ya se te dio la insignia de dueño alguna vez? (la primera vez se pone sola)
    this.ownerPref = false;  // ¿la llevabas puesta la última vez?
    this.owned = new Set(CATALOG.filter((c) => c.price === 0 && !c.ownerOnly).map((c) => c.id));
    this.equipped = {};
    for (const c of CATALOG) if (c.price === 0 && !c.ownerOnly && !this.equipped[c.slot]) this.equipped[c.slot] = c.id; // lo gratis viene puesto
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
    if (MODELS.some((m) => m.id === d.model)) this.model = d.model;
    if (Array.isArray(d.owned)) for (const id of d.owned) if (byId.has(id) && !byId.get(id).ownerOnly) this.owned.add(id); // lo de dueño no se guarda: lo da el servidor
    this.ownerSeen = d.ownerSeen === true;
    this.ownerPref = !!(d.equipped && typeof d.equipped === 'object' && d.equipped.badge === 'owner_badge');
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
    const equipped = { ...this.equipped };
    if (!this.owner && this.ownerPref) equipped.badge = 'owner_badge'; // se recuerda la preferencia hasta que el servidor confirme
    try {
      this.storage.setItem(KEY, JSON.stringify({
        name: this.name,
        color: this.color,
        coins: this.coins,
        model: this.model,
        owned: [...this.owned].filter((id) => !byId.get(id).ownerOnly),
        equipped,
        ownerSeen: this.ownerSeen,
        best: this.best,
      }));
    } catch { /* sin almacenamiento: el perfil dura lo que dure la página */ }
  }

  /** Lo que ven los demás jugadores (se manda al servidor). */
  publicInfo() {
    return { name: this.name, color: this.color, model: this.model, cos: { ...this.equipped } };
  }

  setName(name) {
    this.name = String(name || '').slice(0, NAME_MAX);
    this.save();
  }

  setModel(id) {
    if (MODELS.some((m) => m.id === id)) this.model = id;
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
    if (it.ownerOnly) return { ok: false, reason: 'owner' }; // no se compra
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
    this.rememberOwnerPref();
    this.save();
    return { ok: true, equipped: this.isEquipped(id) };
  }

  unequipAll() {
    this.equipped = {};
    this.rememberOwnerPref();
    this.save();
  }

  rememberOwnerPref() {
    if (this.owner) this.ownerPref = this.equipped.badge === 'owner_badge';
  }

  /**
   * El servidor confirmó (true) o rechazó (false) la clave de dueño. Solo el servidor decide: esto no se guarda.
   * La primera vez la insignia se pone sola; después se respeta si la llevabas o no.
   * @returns {boolean} true si acaba de desbloquearse ahora
   */
  setOwner(on) {
    on = !!on;
    if (on === this.owner) return false;
    this.owner = on;
    if (on) {
      this.owned.add('owner_badge');
      if (this.ownerPref || !this.ownerSeen) this.equipped.badge = 'owner_badge';
      this.ownerSeen = true;
      this.ownerPref = this.equipped.badge === 'owner_badge';
    } else {
      this.owned.delete('owner_badge');
      if (this.equipped.badge === 'owner_badge') delete this.equipped.badge;
    }
    this.save();
    return on;
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
