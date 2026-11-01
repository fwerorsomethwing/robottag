// Texturas procedurales (1.0.2.9): se dibujan con un canvas 2D al cargar; no hay imágenes que descargar.
// Son casi blancas y se multiplican por el color del material, así cada mapa conserva su paleta.
// La clasificación (qué textura le toca a cada color) y el cálculo de UV son puros y se prueban en Node.

/** Tamaño en metros que cubre una repetición de cada textura. */
export const TILE = { grass: 4, brick: 1.6, wood: 1.2, rock: 3, stone: 2, metal: 1.5, plain: 2 };
export const KINDS = Object.keys(TILE);

/** Elige la textura según el color (0xRRGGBB): verde = césped, marrón oscuro = madera, naranja = roca, rojo = ladrillo, gris = piedra/metal. */
export function textureKind(color) {
  const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (mx > 0.97 && mn > 0.97) return null; // blanco puro: letreros y luces
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60;
  }
  if (s < 0.16) return l < 0.62 ? 'stone' : 'metal';
  if (h >= 85 && h <= 170 && s > 0.2) return 'grass';
  if (h >= 12 && h < 50) return l < 0.42 ? 'wood' : s > 0.35 ? 'rock' : 'plain';
  if (h < 12 || h > 345) return 'brick';
  if (h >= 190 && h <= 270 && s < 0.4) return 'metal';
  return 'plain';
}

/** Escala los UV de una BoxGeometry (24 vértices: +x -x +y -y +z -z) para que cada repetición mida `tile` metros. */
export function scaleBoxUV(geo, sx, sy, sz, tile) {
  const uv = geo.attributes.uv;
  if (!uv || uv.count !== 24) return;
  const du = [sz, sz, sx, sx, sx, sx], dv = [sy, sy, sz, sz, sy, sy];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * du[f] / tile, uv.getY(i) * dv[f] / tile);
  }
  uv.needsUpdate = true;
}
export function scaleSphereUV(geo, r, tile) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / tile, uv.getY(i) * (Math.PI * r) / tile);
  uv.needsUpdate = true;
}

/** Recorte cuadrado centrado de una foto w x h (para llenar la textura sin deformarla). */
export function coverCrop(w, h) {
  const s = Math.min(w, h);
  return { sx: Math.floor((w - s) / 2), sy: Math.floor((h - s) / 2), s };
}
export const PHOTO_KINDS = [['grass', 'Césped'], ['brick', 'Ladrillo'], ['wood', 'Madera'], ['rock', 'Roca'], ['stone', 'Piedra'], ['metal', 'Metal']];
export const PHOTO_SIZE = 256;
export const photoKey = (kind) => 'robottag.photo.' + kind;

function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const grey = (v) => { const n = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgb(${n},${n},${n})`; };

/** Dibuja la textura `kind` en un canvas de `size` px. `createCanvas(w,h)` devuelve un canvas (document.createElement o OffscreenCanvas). */
export function drawTexture(kind, createCanvas, size = 128) {
  const c = createCanvas(size, size), x = c.getContext('2d');
  const rnd = seeded(1000 + KINDS.indexOf(kind) * 77);
  const S = size;
  x.fillStyle = grey(0.88); x.fillRect(0, 0, S, S);
  const speckle = (n, lo, hi, w = 2) => { for (let i = 0; i < n; i++) { x.fillStyle = grey(lo + rnd() * (hi - lo)); x.fillRect(rnd() * S, rnd() * S, w, w); } };
  if (kind === 'grass') {
    speckle(500, 0.66, 1, 2);
    x.lineWidth = 1.4;
    for (let i = 0; i < 220; i++) { const px = rnd() * S, py = rnd() * S, h = 3 + rnd() * 6; x.strokeStyle = grey(0.62 + rnd() * 0.38); x.beginPath(); x.moveTo(px, py); x.lineTo(px + (rnd() - 0.5) * 3, py - h); x.stroke(); }
  } else if (kind === 'brick') {
    const rows = 8, bh = S / rows, bw = S / 4;
    x.fillStyle = grey(0.5); x.fillRect(0, 0, S, S); // mortero
    for (let r = 0; r < rows; r++) for (let k = -1; k < 4; k++) {
      const ox = (r % 2) * bw / 2, bx = k * bw + ox;
      x.fillStyle = grey(0.8 + rnd() * 0.2); x.fillRect(bx + 2, r * bh + 2, bw - 4, bh - 4);
    }
    speckle(260, 0.6, 0.95, 1);
  } else if (kind === 'wood') {
    const planks = 4, pw = S / planks;
    for (let p = 0; p < planks; p++) {
      x.fillStyle = grey(0.78 + rnd() * 0.2); x.fillRect(p * pw, 0, pw, S);
      for (let i = 0; i < 16; i++) { x.strokeStyle = grey(0.6 + rnd() * 0.25); x.lineWidth = 1; const gx = p * pw + 3 + rnd() * (pw - 6); x.beginPath(); x.moveTo(gx, 0); x.bezierCurveTo(gx + (rnd() - 0.5) * 5, S * 0.33, gx + (rnd() - 0.5) * 5, S * 0.66, gx + (rnd() - 0.5) * 3, S); x.stroke(); }
      x.fillStyle = grey(0.35); x.fillRect(p * pw, 0, 2, S); // juntas
    }
  } else if (kind === 'rock') {
    let y = 0;
    while (y < S) { const h = 6 + rnd() * 14; x.fillStyle = grey(0.72 + rnd() * 0.28); x.fillRect(0, y, S, h); x.fillStyle = grey(0.5); x.fillRect(0, y, S, 1.5); y += h; }
    speckle(300, 0.55, 1, 2);
  } else if (kind === 'stone') {
    x.fillStyle = grey(0.45); x.fillRect(0, 0, S, S);
    const n = 4, t = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = grey(0.72 + rnd() * 0.28); x.fillRect(i * t + 2, j * t + 2, t - 4, t - 4); }
    speckle(260, 0.55, 1, 1);
  } else if (kind === 'metal') {
    x.fillStyle = grey(0.55); x.fillRect(0, 0, S, S);
    const n = 2, t = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      x.fillStyle = grey(0.82 + rnd() * 0.16); x.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
      for (let k = 0; k < 14; k++) { x.fillStyle = grey(0.7 + rnd() * 0.3); x.fillRect(i * t + 4, j * t + 4 + rnd() * (t - 8), t - 8, 1); } // rayas de cepillado
      x.fillStyle = grey(0.4); for (const [dx, dy] of [[8, 8], [t - 8, 8], [8, t - 8], [t - 8, t - 8]]) { x.beginPath(); x.arc(i * t + dx, j * t + dy, 2, 0, 6.3); x.fill(); } // remaches
    }
  } else { // plain
    speckle(420, 0.78, 1, 2);
  }
  return c;
}
