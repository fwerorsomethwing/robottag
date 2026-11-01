import assert from 'node:assert/strict';
import * as THREE from 'three';
import { textureKind, scaleBoxUV, scaleSphereUV, drawTexture, TILE, KINDS, coverCrop, PHOTO_KINDS, photoKey } from '../public/textures.js';
import { MAP_IDS, buildMap } from '../public/maps.js';

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);

// 1) Clasificación por color.
{
  assert.equal(textureKind(0x2f8f3a), 'grass');
  assert.equal(textureKind(0x7a5230), 'wood');
  assert.equal(textureKind(0xc4673d), 'rock');
  assert.equal(textureKind(0xd64545), 'brick');
  assert.equal(textureKind(0x6a625a), 'stone');
  assert.equal(textureKind(0xc9ccd4), 'metal');
  assert.equal(textureKind(0xffffff), null);
  assert.ok(KINDS.every((k) => TILE[k] > 0));
  ok('cada color recibe su textura');
}

// 2) Los UV de una caja miden `tile` metros por repetición.
{
  const g = new THREE.BoxGeometry(4, 2, 8);
  scaleBoxUV(g, 4, 2, 8, 2);
  const uv = g.attributes.uv;
  let maxU = 0, maxV = 0;
  for (let i = 0; i < 4; i++) { maxU = Math.max(maxU, uv.getX(i)); maxV = Math.max(maxV, uv.getY(i)); } // cara +x: u=z(8), v=y(2)
  assert.equal(maxU, 4); assert.equal(maxV, 1);
  const s = new THREE.SphereGeometry(1, 8, 6); scaleSphereUV(s, 1, 2);
  assert.ok(s.attributes.uv.getX(s.attributes.uv.count - 1) > 1);
  ok('UV escalados al tamaño real');
}

// 3) Las texturas se dibujan sin errores (canvas falso) y todos los mapas usan solo tipos conocidos.
{
  const calls = { n: 0 };
  const fake = () => ({ getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.n++; }), set: (t, k, v) => { t[k] = v; return true; } }) });
  for (const k of KINDS) drawTexture(k, fake, 64);
  assert.ok(calls.n > 100);
  const kinds = new Set();
  for (const id of MAP_IDS) for (const b of buildMap(id).boxes) kinds.add(textureKind(b.color));
  for (const k of kinds) assert.ok(k === null || KINDS.includes(k));
  assert.ok(kinds.size >= 4, 'los mapas usan varias texturas distintas: ' + [...kinds].join());
  ok('texturas dibujadas; ' + kinds.size + ' tipos en los mapas');
}

// 4) Fotos: recorte cuadrado centrado y tipos válidos.
{
  assert.deepEqual(coverCrop(1000, 600), { sx: 200, sy: 0, s: 600 });
  assert.deepEqual(coverCrop(400, 900), { sx: 0, sy: 250, s: 400 });
  assert.deepEqual(coverCrop(256, 256), { sx: 0, sy: 0, s: 256 });
  assert.ok(PHOTO_KINDS.every(([k]) => KINDS.includes(k)));
  assert.equal(photoKey('grass'), 'robottag.photo.grass');
  ok('recorte de fotos y tipos');
}

console.log('\nPruebas de texturas: ' + n + ' correctas');
