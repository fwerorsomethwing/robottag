import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VRLocomotion, CFG } from '../public/locomotion.js';

const V3 = THREE.Vector3;
const box = (cx, cy, cz, sx, sy, sz) => ({
  min: new V3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
  max: new V3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
});
const world = () => ({
  boxes: [box(0, -0.5, 0, 60, 1, 60), box(-6, 2, -6, 4, 4, 4), box(0, 6, -30.5, 61, 12, 1)],
  spheres: [{ c: new V3(8, 2.5, 0), r: 2.5 }],
});
const newRig = () => ({ position: new V3(), quaternion: new THREE.Quaternion() });
const DT = 1 / 72;
let n = 0;
const ok = (name) => console.log('  ok', ++n, name);

// 1) Sin tocar nada, el jugador cae y descansa sobre el torso sin atravesar el suelo.
{
  const loco = new VRLocomotion(world());
  const rig = newRig();
  const headLocal = new V3(0, 1.6, 0);
  loco.placeHead(rig, headLocal, 0, 3, 0);
  const grips = { left: new V3(-0.25, 1.2, -0.3), right: new V3(0.25, 1.2, -0.3) };
  let minHead = Infinity;
  for (let i = 0; i < 400; i++) {
    const r = loco.update(DT, rig, headLocal, grips);
    minHead = Math.min(minHead, r.head.y);
  }
  const head = VRLocomotion.toWorld(rig, headLocal);
  assert.ok(minHead > CFG.TORSO_DROP + CFG.TORSO_R - 0.01, 'la cabeza no baja más que el torso: ' + minHead);
  assert.ok(Math.abs(head.y - (CFG.TORSO_DROP + CFG.TORSO_R)) < 0.02, 'reposa a ' + head.y);
  assert.ok(loco.vel.length() < 0.01, 'velocidad final ~0: ' + loco.vel.length());
  ok('cae y descansa sobre el torso');
}

// 2) Empujar el suelo con ambas manos eleva el cuerpo y lo lanza al soltar; las manos nunca atraviesan el suelo.
{
  const loco = new VRLocomotion(world());
  const rig = newRig();
  const headLocal = new V3(0, 1.6, 0);
  loco.placeHead(rig, headLocal, 0, 0.62, 0);
  // dejar que se asiente
  const rest = { left: new V3(-0.25, 1.4, -0.3), right: new V3(0.25, 1.4, -0.3) };
  for (let i = 0; i < 60; i++) loco.update(DT, rig, headLocal, rest);
  const startY = loco.head.y;

  let maxHead = startY, minFollowerY = Infinity, sawContact = false, flew = false;
  // las manos bajan 3 m/s hasta tocar el suelo (mundo y = 0) y siguen empujando
  const y0 = 0.45 - rig.position.y; // altura local para estar a 0.45 m del suelo
  let handLocalY = y0 + 0.2;
  for (let i = 0; i < 40; i++) {
    handLocalY -= 3 * DT;
    const g = { left: new V3(-0.25, handLocalY, -0.3), right: new V3(0.25, handLocalY, -0.3) };
    const r = loco.update(DT, rig, headLocal, g);
    minFollowerY = Math.min(minFollowerY, r.left.y, r.right.y);
    maxHead = Math.max(maxHead, r.head.y);
    if (r.contacts.length) sawContact = true;
  }
  // luego levantan las manos (se sueltan)
  for (let i = 0; i < 60; i++) {
    handLocalY += 4 * DT;
    const g = { left: new V3(-0.25, handLocalY, -0.3), right: new V3(0.25, handLocalY, -0.3) };
    const r = loco.update(DT, rig, headLocal, g);
    minFollowerY = Math.min(minFollowerY, r.left.y, r.right.y);
    maxHead = Math.max(maxHead, r.head.y);
    if (r.head.y > startY + 0.1 && loco.vel.y !== 0) flew = true;
  }
  assert.ok(sawContact, 'hubo contacto de mano');
  assert.ok(minFollowerY >= CFG.HAND_R - 0.002, 'la mano no atraviesa el suelo: ' + minFollowerY);
  assert.ok(maxHead > startY + 0.1, `el cuerpo sube (${startY.toFixed(2)} -> ${maxHead.toFixed(2)})`);
  assert.ok(flew, 'hay vuelo tras soltar');
  ok('empujar el suelo eleva y lanza al jugador');
}

// 3) Empujar una pared hacia atrás impulsa horizontalmente y la cabeza no atraviesa el cubo.
{
  const loco = new VRLocomotion(world());
  const rig = newRig();
  const headLocal = new V3(0, 1.6, 0);
  // junto a la cara +x del cubo (x = -4), a 1.5 m de altura
  loco.placeHead(rig, headLocal, -3.2, 1.5, -6);
  const rest = { left: new V3(-0.25, 1.2, -0.3), right: new V3(0.25, 1.2, -0.3) };
  loco.update(DT, rig, headLocal, rest);
  // mano izquierda se mueve hacia la pared (-x) y tira hacia el cuerpo (+x)
  let x = -0.25;
  const headStartX = loco.head.x;
  let maxX = headStartX;
  for (let i = 0; i < 25; i++) {
    x -= 2.5 * DT;
    const r = loco.update(DT, rig, headLocal, { left: new V3(x, 1.2, 0), right: rest.right });
    assert.ok(r.head.x > -4 + CFG.HEAD_R - 0.01, 'la cabeza no entra en el cubo: ' + r.head.x);
    maxX = Math.max(maxX, r.head.x);
  }
  for (let i = 0; i < 20; i++) {
    x += 2.5 * DT;
    const r = loco.update(DT, rig, headLocal, { left: new V3(x, 1.2, 0), right: rest.right });
    assert.ok(r.head.x > -4 + CFG.HEAD_R - 0.01, 'la cabeza no entra en el cubo (2): ' + r.head.x);
    maxX = Math.max(maxX, r.head.x);
  }
  assert.ok(maxX > headStartX + 0.05, `se aleja de la pared (${headStartX.toFixed(2)} -> ${maxX.toFixed(2)})`);
  ok('empujar la pared impulsa al jugador sin atravesarla');
}

// 4) La esfera también es sólida.
{
  const loco = new VRLocomotion(world());
  const rig = newRig();
  const headLocal = new V3(0, 1.6, 0);
  loco.placeHead(rig, headLocal, 4, 6, 0); // sobre la esfera (centro 8, 2.5, 0; r 2.5 -> tope en 5)
  const grips = { left: new V3(-0.25, 1.2, -0.3), right: new V3(0.25, 1.2, -0.3) };
  let minY = Infinity;
  for (let i = 0; i < 300; i++) {
    const r = loco.update(DT, rig, headLocal, grips);
    const d = r.head.distanceTo(new V3(8, 2.5, 0));
    minY = Math.min(minY, d - 2.5);
  }
  assert.ok(minY > CFG.HEAD_R - 0.02, 'la cabeza no entra en la esfera: ' + minY);
  ok('la esfera es sólida');
}

// 5) Un mando sin seguimiento no rompe nada y recupera la mano sin saltos.
{
  const loco = new VRLocomotion(world());
  const rig = newRig();
  const headLocal = new V3(0, 1.6, 0);
  loco.placeHead(rig, headLocal, 0, 0.7, 0);
  const g = { left: null, right: new V3(0.25, 1.4, -0.3) };
  for (let i = 0; i < 30; i++) loco.update(DT, rig, headLocal, g);
  const y1 = loco.head.y;
  loco.update(DT, rig, headLocal, { left: new V3(-0.25, 1.4, -0.3), right: g.right });
  assert.ok(Math.abs(loco.head.y - y1) < 0.05, 'sin salto al recuperar el mando');
  ok('mando perdido y recuperado');
}

// 6) Límite de velocidad de salto (el jugador LAVA es más rápido).
{
  const run = (lava) => {
    const loco = new VRLocomotion(world());
    const rig = newRig();
    const headLocal = new V3(0, 1.6, 0);
    loco.placeHead(rig, headLocal, 0, 0.62, 0);
    const rest = { left: new V3(-0.25, 1.4, -0.3), right: new V3(0.25, 1.4, -0.3) };
    for (let i = 0; i < 60; i++) loco.update(DT, rig, headLocal, rest, { lava });
    let hy = 0.45 - rig.position.y + 0.3, maxV = 0;
    for (let i = 0; i < 20; i++) {
      hy -= 12 * DT; // empuje muy fuerte
      const g = { left: new V3(-0.25, hy, -0.3), right: new V3(0.25, hy, -0.3) };
      loco.update(DT, rig, headLocal, g, { lava });
      maxV = Math.max(maxV, loco.vel.length());
    }
    return maxV;
  };
  const normal = run(false), lava = run(true);
  assert.ok(normal <= CFG.MAX_JUMP + 1e-6, 'tope de salto: ' + normal);
  assert.ok(lava > normal, `LAVA más rápido (${normal.toFixed(2)} vs ${lava.toFixed(2)})`);
  ok('tope de velocidad y bonus de LAVA');
}

console.log('\nTodos los tests pasaron (' + n + ')');
