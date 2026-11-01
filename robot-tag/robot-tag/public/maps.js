// Mapas del juego, al estilo de Gorilla Tag de 2020: Plaza (el mapa clásico; desde la 1.0.3 ya sin el cubo y la esfera),
// Bosque, Cueva, Cañón y Ciudad. Solo datos: sin DOM ni three.js, para poder probarlo en Node.
//
// Todos los jugadores deben ver EXACTAMENTE el mismo mapa, por eso se genera con un generador
// pseudoaleatorio con semilla fija (nada de Math.random).
//
// Cada mapa devuelve:
//   boxes   cajas con colisión {x,y,z (centro), sx,sy,sz, color, opacity?, emissive?}
//   decor   cajas solo visuales
//   spheres esferas con colisión {x,y,z,r,color}
//   lights  luces puntuales {x,y,z,color,intensity,dist}
//   portals círculos de luz que te llevan a otro mapa {x,z,to,name,color}

export const LOBBY = 'lobby';
export const HALF = 30; // la arena mide 60 x 60

export const MAP_INFO = [
  { id: 'lobby', name: 'PLAZA', color: 0xffffff, desc: 'El mapa clásico: cursos, computadora y tienda (y un homenaje al cubo y la esfera)' },
  { id: 'forest', name: 'BOSQUE', color: 0x45e08a, desc: 'Árboles para trepar, ramas, troncos y una casa del árbol' },
  { id: 'cave', name: 'CUEVA', color: 0xc16bff, desc: 'Oscura, con estalactitas, pilares y una pirámide de roca' },
  { id: 'canyon', name: 'CAÑÓN', color: 0xff9a3d, desc: 'Mesas de roca, pasillos para saltar de pared a pared y un arco' },
  { id: 'city', name: 'CIUDAD', color: 0x3da5ff, desc: 'Edificios, calles, coches y tejados para saltar' },
  // Mapa para probar la física: no sale entre los portales de la Plaza; se elige en el menú o desde el panel de admin.
  { id: 'test', name: 'MAPA DE PRUEBAS', color: 0xffd23d, desc: 'Escaleras, pilares, huecos, pasillo de paredes, esferas y una barra baja', hidden: true },
];
export const MAP_IDS = MAP_INFO.map((m) => m.id);
export const mapInfo = (id) => MAP_INFO.find((m) => m.id === id) || null;

/** Zona de aparición de los mapas que no son la Plaza, y su portal de vuelta. Siempre queda libre. */
export const SPAWN_KEEP = { x0: -5, x1: 13, z0: 19, z1: 29.9 };
const RETURN_PORTAL = { x: 9, z: 26, to: LOBBY, name: 'VOLVER', color: 0xffffff };

// ---------- Utilidades ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Gen {
  constructor(seed) {
    this.r = rng(seed);
    this.boxes = []; this.decor = []; this.spheres = []; this.lights = [];
    this.keep = [];   // rectángulos donde no se coloca nada al azar
    this.placed = []; // círculos ya ocupados {x,z,r}
  }
  rand(a, b) { return a + (b - a) * this.r(); }
  pick(list) { return list[Math.floor(this.r() * list.length)]; }
  box(x, y, z, sx, sy, sz, color, o = {}) { this.boxes.push({ x, y, z, sx, sy, sz, color, ...o }); }
  deco(x, y, z, sx, sy, sz, color, o = {}) { this.decor.push({ x, y, z, sx, sy, sz, color, ...o }); }
  sphere(x, y, z, r, color) { this.spheres.push({ x, y, z, r, color }); }
  keepOut(rect) { this.keep.push(rect); }
  /** ¿Cabe un círculo de radio r en (x,z) sin tocar zonas reservadas ni salirse de la arena? */
  free(x, z, r) {
    if (Math.abs(x) > HALF - 1.5 - r || Math.abs(z) > HALF - 1.5 - r) return false;
    for (const k of this.keep) if (x + r > k.x0 && x - r < k.x1 && z + r > k.z0 && z - r < k.z1) return false;
    return true;
  }
  /** Coloca hasta `count` cosas con separación `minDist` entre centros. `make(x, z)` crea cada una. */
  scatter(count, minDist, radius, make, tries = 900) {
    let n = 0;
    for (let i = 0; i < tries && n < count; i++) {
      const x = this.rand(-HALF + 2, HALF - 2), z = this.rand(-HALF + 2, HALF - 2);
      if (!this.free(x, z, radius)) continue;
      if (this.placed.some((p) => Math.hypot(p.x - x, p.z - z) < minDist)) continue;
      this.placed.push({ x, z, r: radius });
      make(x, z);
      n++;
    }
    return n;
  }
  out(extra) {
    return { boxes: this.boxes, decor: this.decor, spheres: this.spheres, lights: this.lights, ...extra };
  }
}

/** Suelo y cuatro muros. */
function arena(g, { ground, wall, wallH = 12, wallOpacity, ceiling }) {
  g.box(0, -0.5, 0, 60, 1, 60, ground, { ground: true });
  const o = wallOpacity ? { opacity: wallOpacity } : {};
  g.box(0, wallH / 2, -30.5, 62, wallH, 1, wall, o);
  g.box(0, wallH / 2, 30.5, 62, wallH, 1, wall, o);
  g.box(-30.5, wallH / 2, 0, 1, wallH, 62, wall, o);
  g.box(30.5, wallH / 2, 0, 1, wallH, 62, wall, o);
  if (ceiling) g.box(0, 12.5, 0, 62, 3, 62, ceiling); // la cara de abajo queda a 11 m
}

const gap1 = (aMin, aMax, bMin, bMax) => Math.max(0, aMin - bMax, bMin - aMax);

// ---------- PLAZA (el mapa clásico) ----------
function lobby() {
  const g = new Gen(1);
  arena(g, { ground: 0x4f9a4a, wall: 0x9bb7e0, wallOpacity: 0.25 });
  // Homenaje: aquí estuvieron el cubo y la esfera (2026-2026). Solo decoración, sin colisión.
  g.deco(-6, 0.1, -6, 2.4, 0.2, 1.4, 0x8a8f98);
  g.deco(-6, 0.75, -6, 1.5, 1.1, 0.3, 0x9a9fa8);
  const portals = MAP_INFO.filter((m) => m.id !== LOBBY && !m.hidden).map((m, i) => ({
    x: -12 + i * 8, z: 26, to: m.id, name: m.name, color: m.color,
  }));
  return g.out({
    id: LOBBY, name: 'PLAZA', sky: 0x8ec5ff, fog: { color: 0x8ec5ff, near: 30, far: 90 },
    light: { hemi: 1.0, sun: 1.2 }, grid: true, spawn: { x: 0, z: 9, jitter: 4 }, portals,
  });
}

// ---------- BOSQUE ----------
function forest() {
  const g = new Gen(11);
  arena(g, { ground: 0x3f8a3c, wall: 0x2d6b34 });
  g.keepOut(SPAWN_KEEP);
  g.keepOut({ x0: -8, x1: 8, z0: -13, z1: 2 }); // casa del árbol

  // Casa del árbol: plataforma a 4,5 m sobre cuatro pilares, con techo y escalones para subir.
  g.box(0, 4.25, -6, 8, 0.5, 8, 0x9a6b3c);
  for (const [px, pz] of [[-3.5, -9.5], [3.5, -9.5], [-3.5, -2.5], [3.5, -2.5]]) g.box(px, 2, pz, 0.9, 4, 0.9, 0x6b4a2b);
  for (const [px, pz] of [[-3.8, -9.8], [3.8, -9.8], [-3.8, -2.2], [3.8, -2.2]]) g.box(px, 6.25, pz, 0.5, 3.5, 0.5, 0x7a5230);
  g.box(0, 8.2, -6, 9, 0.4, 9, 0x2f8f3a);
  g.box(-0.8, 0.75, 0.9, 2, 1.5, 2, 0x8a8f98);   // escalón 1 (1,5 m)
  g.box(1.2, 1.5, -1, 2, 3, 2, 0x8a8f98);        // escalón 2 (3 m)

  // Árboles: tronco (caja), copa (esfera con colisión) y una o dos ramas para apoyarse.
  g.scatter(34, 7, 3.2, (x, z) => {
    const h = g.rand(5.5, 9.5);
    g.box(x, h / 2, z, 1, h, 1, 0x6b4a2b);
    g.sphere(x, h + 1.0, z, g.rand(2.4, 3.1), g.pick([0x2f8f3a, 0x3aa045, 0x28803a]));
    for (let k = 0; k < (g.r() < 0.5 ? 2 : 1); k++) {
      const [dx, dz] = g.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      g.box(x + dx * 2.25, h * g.rand(0.4, 0.6), z + dz * 2.25, dx ? 3.5 : 0.6, 0.4, dz ? 3.5 : 0.6, 0x7a5230);
    }
  });
  // Troncos caídos y rocas
  g.scatter(6, 6, 3, (x, z) => { const along = g.r() < 0.5; g.box(x, 0.4, z, along ? 5 : 0.8, 0.8, along ? 0.8 : 5, 0x7a5230); });
  g.scatter(8, 5, 2.2, (x, z) => { const r = g.rand(1, 2); g.sphere(x, r * 0.35, z, r, 0x8a8f98); });
  return g.out({
    id: 'forest', name: 'BOSQUE', sky: 0x9ad0ff, fog: { color: 0xbfdcb0, near: 25, far: 80 },
    light: { hemi: 0.9, sun: 1.1 }, spawn: { x: 0, z: 24, jitter: 4 }, portals: [RETURN_PORTAL],
  });
}

// ---------- CUEVA ----------
function cave() {
  const g = new Gen(23);
  arena(g, { ground: 0x3b3834, wall: 0x4a4540, ceiling: 0x34302c });
  g.keepOut(SPAWN_KEEP);
  g.keepOut({ x0: -15, x1: -1, z0: -15, z1: -1 }); // pirámide
  g.keepOut({ x0: 24, x1: 30, z0: -9, z1: 14 });   // escalera de roca

  // Pirámide de roca de cuatro pisos
  [12, 9, 6, 3].forEach((s, i) => g.box(-8, 1 + i * 2, -8, s, 2, s, i % 2 ? 0x625850 : 0x5a5148));
  // Escalera de roca por la pared este (de 1,5 m en 1,5 m) y un puente alto hacia el oeste
  for (let i = 1; i <= 5; i++) g.box(28, (1.5 * i) / 2, 12 - 4 * (i - 1) - 0.0, 3, 1.5 * i, 3, 0x6a625a);
  g.box(21.5, 7.25, -4, 14, 0.5, 3, 0x6a625a);

  // Pilares de suelo a techo
  g.scatter(11, 9, 2.2, (x, z) => g.box(x, 5.5, z, 3, 11, 3, 0x57504a));
  // Estalactitas (cuelgan del techo) y estalagmitas (escalonadas)
  for (let i = 0; i < 26; i++) {
    const len = g.rand(1.8, 4.5), x = g.rand(-27, 27), z = g.rand(-27, 27);
    g.box(x, 11 - len / 2, z, 1.1, len, 1.1, 0x6a625a);
  }
  g.scatter(22, 4, 1.8, (x, z) => { g.box(x, 0.8, z, 2.2, 1.6, 2.2, 0x6a625a); g.box(x, 2.4, z, 1.2, 1.6, 1.2, 0x756c63); });
  // Cristales que brillan (solo visuales) y luces de colores
  for (let i = 0; i < 18; i++) {
    const x = g.rand(-27, 27), z = g.rand(-27, 27);
    if (!g.free(x, z, 0.5)) continue;
    g.deco(x, 0.6, z, 0.4, 1.2, 0.4, g.pick([0x4df0ff, 0xff5cf0]), { emissive: true });
  }
  g.lights.push(
    { x: -8, y: 6, z: -8, color: 0x66e0ff, intensity: 70, dist: 30 },
    { x: 15, y: 5, z: 8, color: 0xff66ee, intensity: 60, dist: 28 },
    { x: 4, y: 6, z: 23, color: 0xffc880, intensity: 60, dist: 26 },
  );
  return g.out({
    id: 'cave', name: 'CUEVA', sky: 0x07070c, fog: { color: 0x07070c, near: 6, far: 48 },
    light: { hemi: 0.5, sun: 0.0 }, spawn: { x: 0, z: 24, jitter: 4 }, portals: [RETURN_PORTAL],
  });
}

// ---------- CAÑÓN ----------
function canyon() {
  const g = new Gen(37);
  arena(g, { ground: 0xd9a066, wall: 0xb5532f });
  g.keepOut(SPAWN_KEEP);
  g.keepOut({ x0: -13, x1: 10, z0: -22.5, z1: -2 }); // arco y su escalera

  // Arco natural: dos pilares y una viga encima, con escalones de 1,5 m por el lado oeste
  g.box(-7, 4.5, -20, 3, 9, 3, 0xc4673d);
  g.box(7, 4.5, -20, 3, 9, 3, 0xc4673d);
  g.box(0, 9.5, -20, 18, 2, 3, 0xb85c38);
  for (let i = 1; i <= 6; i++) g.box(-10.5, (1.5 * i) / 2, -20 + 3.3 * (6 - i), 3, 1.5 * i, 3, 0xd27a4a);

  // Mesas de roca separadas por pasillos de 3 a 5 m (para saltar de pared a pared)
  const rects = [];
  for (let i = 0; i < 900 && rects.length < 15; i++) {
    const sx = g.rand(5, 9), sz = g.rand(5, 9), x = g.rand(-26, 26), z = g.rand(-26, 26);
    if (!g.free(x, z, Math.max(sx, sz) / 2)) continue;
    if (rects.some((r) => Math.hypot(gap1(x - sx / 2, x + sx / 2, r.x - r.sx / 2, r.x + r.sx / 2), gap1(z - sz / 2, z + sz / 2, r.z - r.sz / 2, r.z + r.sz / 2)) < 3)) continue;
    rects.push({ x, z, sx, sz });
    const h = g.rand(3.5, 8), t = g.rand(2, 3.5), c = g.pick([0xc4673d, 0xb85c38, 0xd27a4a]);
    g.box(x, h / 2, z, sx, h, sz, c);
    g.box(x, h + t / 2, z, sx * 0.6, t, sz * 0.6, g.pick([0xc4673d, 0xb85c38, 0xd27a4a]));
  }
  // Rocas sueltas
  g.scatter(10, 4, 2.4, (x, z) => { const r = g.rand(1, 2.2); g.sphere(x, r * 0.5, z, r, 0xa8532f); });
  return g.out({
    id: 'canyon', name: 'CAÑÓN', sky: 0xf2c08f, fog: { color: 0xeebb8c, near: 30, far: 100 },
    light: { hemi: 1.0, sun: 1.3 }, spawn: { x: 0, z: 24, jitter: 4 }, portals: [RETURN_PORTAL],
  });
}

// ---------- CIUDAD ----------
function city() {
  const g = new Gen(53);
  arena(g, { ground: 0x3d4048, wall: 0x59606e });
  const centers = [-24, -12, 0, 12, 24];
  const colors = [0x8b95a5, 0xa7937c, 0x6f7f95, 0xb5836b, 0x7d8e7a, 0x9a8fb0];
  const heights = [4.5, 6, 7.5, 9, 10.5]; // múltiplos de 1,5 m: los escalones siempre llegan al tejado
  const inKeep = (x0, x1, z0, z1) => x1 > SPAWN_KEEP.x0 && x0 < SPAWN_KEEP.x1 && z1 > SPAWN_KEEP.z0 && z0 < SPAWN_KEEP.z1;

  for (const cx of centers) {
    for (const cz of centers) {
      if (cx === 0 && cz === 0) { // plaza central con una estatua
        g.box(0, 0.3, 0, 8, 0.6, 8, 0x9aa2ad);
        g.sphere(0, 2.3, 0, 1.8, 0xd8b04a);
        continue;
      }
      if (inKeep(cx - 4, cx + 4, cz - 4, cz + 4)) continue; // aparición y portal de vuelta
      const h = g.pick(heights), c = g.pick(colors);
      g.box(cx, h / 2, cz, 8, h, 8, c);
      g.deco(cx, h * 0.5, cz, 8.06, 0.9, 8.06, 0xbfe3ff);
      if (h >= 7.5) g.deco(cx, h * 0.5 + 2.2, cz, 8.06, 0.9, 8.06, 0xbfe3ff);
      if (g.r() < 0.6) { // escalones pegados a una pared
        const side = g.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
        const n = h / 1.5 - 1;
        for (let i = 1; i <= n; i++) {
          const along = -3.9 + 1.3 * (i - 0.5);
          const x = cx + side[0] * 5 + (side[0] ? 0 : along), z = cz + side[1] * 5 + (side[1] ? 0 : along);
          g.box(x, (1.5 * i) / 2, z, side[0] ? 2 : 1.3, 1.5 * i, side[1] ? 2 : 1.3, 0xc9ccd4);
        }
      }
    }
  }
  // Líneas de las calles (solo visuales)
  for (const s of [-18, -6, 6, 18]) {
    g.deco(s, 0.02, 0, 0.2, 0.02, 56, 0xe8d87a);
    g.deco(0, 0.02, s, 56, 0.02, 0.2, 0xe8d87a);
  }
  // Coches y farolas en las calles
  const cars = [];
  for (let i = 0; i < 400 && cars.length < 14; i++) {
    const vertical = g.r() < 0.5, line = g.pick([-18, -6, 6, 18]) + g.pick([-1, 1]) * 1.1, t = g.rand(-26, 26);
    const x = vertical ? line : t, z = vertical ? t : line, sx = vertical ? 2 : 4.2, sz = vertical ? 4.2 : 2;
    if (inKeep(x - sx / 2, x + sx / 2, z - sz / 2, z + sz / 2)) continue;
    if (cars.some((q) => Math.abs(q.x - x) < (q.sx + sx) / 2 + 1 && Math.abs(q.z - z) < (q.sz + sz) / 2 + 1)) continue;
    cars.push({ x, z, sx, sz });
    g.box(x, 0.6, z, sx, 1.2, sz, g.pick([0xd64545, 0x3d7de0, 0xe0c13d, 0xe8e8e8, 0x3dbf6b]));
  }
  for (let i = 0; i < 14; i++) {
    const vertical = g.r() < 0.5, line = g.pick([-18, -6, 6, 18]) + g.pick([-1, 1]) * 1.8, t = g.rand(-26, 26);
    const x = vertical ? line : t, z = vertical ? t : line;
    if (inKeep(x - 1, x + 1, z - 1, z + 1)) continue;
    g.box(x, 2.5, z, 0.3, 5, 0.3, 0x2c2f36);
    g.box(x, 5.1, z, 0.9, 0.25, 0.4, 0xfff2b0, { emissive: true });
  }
  return g.out({
    id: 'city', name: 'CIUDAD', sky: 0xa9bdd6, fog: { color: 0xa9bdd6, near: 35, far: 110 },
    light: { hemi: 0.95, sun: 1.1 }, spawn: { x: 0, z: 24, jitter: 4 }, portals: [RETURN_PORTAL],
  });
}

// ---------- MAPA DE PRUEBAS ----------
// Una pieza de cada cosa para probar la física: escalera, pilares de varias alturas, huecos de 1 a 5 m,
// pasillo para saltar de pared a pared, esferas de varios tamaños y una barra baja para la cabeza.
function testMap() {
  const g = new Gen(77);
  arena(g, { ground: 0x7d8799, wall: 0xa9b4c9, wallOpacity: 0.3 });
  g.keepOut(SPAWN_KEEP);
  // Escalera de 10 peldaños de 0,5 m (arriba, 5 m)
  for (let i = 0; i < 10; i++) {
    const h = (i + 1) * 0.5;
    g.box(-27 + i * 1.5 + 0.75, h / 2, -25, 1.5, h, 4, i % 2 ? 0xe8a33a : 0xd88a22);
  }
  // Pilares de 1 a 4 m en cuadrícula, a 4 m unos de otros
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const h = 1 + ((i * 2 + j) % 4);
    g.box(-4 + i * 4, h / 2, -22 + j * 4, 1, h, 1, 0x4a90d9);
  }
  // Huecos de 1, 2, 3, 4 y 5 m entre plataformas de 3x3 m a 1,5 m de altura
  let z = 24;
  for (const gapLen of [0, 1, 2, 3, 4, 5]) {
    z -= gapLen + 3;
    g.box(24, 0.75, z + 1.5, 3, 1.5, 3, 0x5cc27a);
    if (z < -16) break;
  }
  // Pasillo de 3 m entre dos paredes de 7 m (para saltar de pared a pared)
  g.box(-22, 3.5, 2, 1, 7, 18, 0xb86bd9);
  g.box(-17, 3.5, 2, 1, 7, 18, 0xb86bd9);
  // Esferas de radio 0,5 a 2,5 m
  let sx = 8, prevR = 0;
  for (const r of [0.5, 1, 1.5, 2, 2.5]) {
    sx += prevR + r + (prevR ? 0.5 : 0);
    g.sphere(sx, r, -4, r, 0xe8625a);
    prevR = r;
  }
  // Barra baja (cabeza): a 2 m de altura sobre dos postes
  g.box(6, 1, -10, 0.3, 2, 0.3, 0x555b66);
  g.box(12, 1, -10, 0.3, 2, 0.3, 0x555b66);
  g.box(9, 2.1, -10, 6.6, 0.25, 0.5, 0xffd23d);
  // Cubo y esfera clásicos, por si se quiere comparar con la Plaza
  g.box(-8, 2, 10, 4, 4, 4, 0xe8803a);
  g.sphere(-12, 2.5, -6, 2.5, 0x3a7be8);
  return g.out({
    id: 'test', name: 'MAPA DE PRUEBAS', sky: 0xd5deee, fog: { color: 0xd5deee, near: 40, far: 120 },
    light: { hemi: 1.1, sun: 1.0 }, spawn: { x: 0, z: 24, jitter: 4 }, portals: [RETURN_PORTAL],
  });
}

const BUILDERS = { lobby, forest, cave, canyon, city, test: testMap };

/** Genera un mapa (siempre igual para el mismo id). */
export function buildMap(id) {
  const make = BUILDERS[id];
  if (!make) throw new Error('Mapa desconocido: ' + id);
  return make();
}

/** Portal en el que está la cabeza, o null. Los portales son columnas de luz de 1,2 m de radio. */
export function portalAt(head, portals) {
  for (const p of portals || []) {
    if (Math.hypot(head.x - p.x, head.z - p.z) < 1.2 && head.y > 0 && head.y < 3.6) return p;
  }
  return null;
}
