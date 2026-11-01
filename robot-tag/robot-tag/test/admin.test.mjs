import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TOOLS, makePlane, planeRay, planePoke, pickTarget, buildGun, AdminUI, PANEL } from '../public/admin.js';
import { MAP_IDS, buildMap } from '../public/maps.js';
const { Rooms, NAN_MS } = createRequire(import.meta.url)('../rooms.js');

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- Servidor ----------
function setup() {
  const inbox = new Map(), kicked = [];
  const rooms = new Rooms({ mapIds: MAP_IDS, defaultMap: 'lobby', ownerKey: 'clave', kick: (p) => kicked.push(p.name), send: (p, s) => { (inbox.get(p.id) || inbox.set(p.id, []).get(p.id)).push(JSON.parse(s)); } });
  const add = (name, extra = {}) => {
    const p = rooms.newPlayer({});
    rooms.join(p, undefined, '');
    rooms.handle(p, { t: 'join', name, map: 'lobby', ...extra });
    rooms.handle(p, { t: 's', p: [0, 1, 0], yaw: 0 });
    return p;
  };
  const got = (p, t) => (inbox.get(p.id) || []).filter((m) => m.t === t);
  const snap = (viewer, name) => { rooms.tick(); return inbox.get(viewer.id).filter((m) => m.t === 'snap').at(-1).players.find((p) => p.name === name); };
  return { rooms, add, got, snap, kicked };
}

// 1) Las armas solo las lleva el dueño y las ven los demás.
{
  const { rooms, add, snap } = setup();
  const dueno = add('Jefe', { key: 'clave', tool: 'kick' });
  const otro = add('Otro', { tool: 'kick' });
  assert.equal(snap(otro, 'Jefe').g, 'kick');
  assert.equal(snap(dueno, 'Otro').g, '', 'un jugador normal no puede llevar armas');
  rooms.handle(dueno, { t: 'profile', tool: 'nan' });
  assert.equal(snap(otro, 'Jefe').g, 'nan');
  rooms.handle(dueno, { t: 'profile', tool: 'bomba' }); // arma inventada
  assert.equal(snap(otro, 'Jefe').g, '');
  rooms.handle(dueno, { t: 'profile', tool: 'kick' });
  rooms.handle(dueno, { t: 'profile', key: '' }); // deja de ser dueño: pierde el arma
  assert.equal(snap(otro, 'Jefe').g, '');
  ok('armas: solo el dueño, solo las conocidas');
}

// 2) Kick: solo el dueño, solo en su sala, nunca a otro dueño ni a sí mismo; avisa y desconecta.
{
  const { rooms, add, got, kicked } = setup();
  const dueno = add('Jefe', { key: 'clave' }), otro = add('Otro'), lejos = add('Lejos', { map: 'forest' });
  rooms.handle(otro, { t: 'admin', act: 'kick', to: dueno.id }); // un jugador normal no puede
  assert.deepEqual(kicked, []);
  rooms.handle(dueno, { t: 'admin', act: 'kick', to: lejos.id }); // otra sala
  rooms.handle(dueno, { t: 'admin', act: 'kick', to: dueno.id }); // a sí mismo
  rooms.handle(dueno, { t: 'admin', act: 'kick', to: 'x' });
  rooms.handle(dueno, { t: 'admin', act: 'kick' });
  assert.deepEqual(kicked, []);
  rooms.handle(dueno, { t: 'admin', act: 'kick', to: otro.id });
  assert.deepEqual(kicked, ['Otro']);
  assert.equal(got(otro, 'kicked')[0].by, 'Jefe');
  assert.equal(otro.room, null, 'sale de la sala');
  assert.ok(got(dueno, 'zap').some((z) => z.tool === 'kick' && z.to === otro.id));
  ok('kick: solo dueño, misma sala, no a dueños');
}

// 3) NaN: congela 8 s (visible en la instantánea) y se puede quitar; no manda valores NaN.
{
  const { rooms, add, got, snap } = setup();
  const dueno = add('Jefe', { key: 'clave' }), otro = add('Otro'), otro2 = add('Otro2');
  const t0 = 1_000_000;
  rooms.admin(dueno, { act: 'nan', to: otro.id }, t0);
  assert.deepEqual(got(otro, 'nan'), [{ t: 'nan', ms: NAN_MS }]);
  assert.equal(snap(otro2, 'Otro').n, 1 && snap(otro2, 'Otro').n, 'todos ven que está afectado');
  rooms.tick(t0 + NAN_MS + 1);
  const later = rooms.rooms.values().next().value;
  assert.ok(otro.nanUntil <= t0 + NAN_MS + 1);
  rooms.admin(dueno, { act: 'nan', to: otro.id }, t0 + 10);
  rooms.admin(dueno, { act: 'nan', to: otro2.id }, t0 + 20);
  rooms.admin(dueno, { act: 'unnan' }, t0 + 30); // quita el efecto a todos
  assert.equal(otro.nanUntil, 0);
  assert.equal(otro2.nanUntil, 0);
  assert.equal(got(otro, 'nan').at(-1).ms, 0);
  // posiciones NaN que mande un cliente se descartan
  rooms.handle(otro, { t: 's', p: [NaN, 1, 0], yaw: 0 });
  rooms.handle(otro, { t: 's', p: [Infinity, 1, 0], yaw: 0 });
  rooms.handle(otro, { t: 's', p: [3, 1, 0], yaw: 'x' });
  assert.deepEqual(otro.p, [3, 1, 0], 'solo se aceptan números finitos');
  ok('NaN: congelación visible, se quita, y el servidor descarta posiciones NaN');
}

// 4) LAVA, ronda nueva, anuncio y límite de acciones.
{
  const { rooms, add, got } = setup();
  const dueno = add('Jefe', { key: 'clave' }), a = add('Ana'), b = add('Beto');
  const room = dueno.room;
  rooms.handle(dueno, { t: 'admin', act: 'lava', to: b.id });
  assert.equal(room.itId, b.id);
  rooms.handle(dueno, { t: 'admin', act: 'newround' });
  assert.ok(room.players.has(room.itId));
  rooms.handle(dueno, { t: 'admin', act: 'announce', text: '¡Ojo <b>con</b> la lava!' });
  assert.equal(got(a, 'notice').at(-1).text, '¡Ojo bconb la lava!', 'sin etiquetas ni símbolos raros');
  rooms.handle(a, { t: 'admin', act: 'lava', to: b.id }); // un jugador normal
  assert.notEqual(room.itId, undefined);
  const before = got(a, 'notice').length;
  rooms.handle(a, { t: 'admin', act: 'announce', text: 'hola' });
  assert.equal(got(a, 'notice').length, before, 'un jugador normal no puede dar anuncios');
  // límite: 10 acciones por segundo
  const t0 = Date.now() + 60_000; // ventana nueva
  let sent = 0;
  const spy = rooms.send;
  rooms.send = (p, s) => { if (JSON.parse(s).t === 'notice') sent++; spy(p, s); };
  for (let i = 0; i < 30; i++) rooms.admin(dueno, { act: 'announce', text: 'x' }, t0);
  assert.equal(sent, 10 * 3, '10 anuncios × 3 jugadores');
  ok('LAVA, ronda nueva, anuncios y límite');
}

// ---------- Cliente (lógica sin DOM) ----------
// 5) Puntería: acierta al más cercano, respeta paredes y distancia.
{
  const o = V(0, 1, 0), d = V(0, 0, -1);
  const targets = [{ id: 1, x: 0, y: 1, z: -10 }, { id: 2, x: 0.2, y: 1, z: -5 }, { id: 3, x: 6, y: 1, z: -5 }];
  assert.equal(pickTarget(o, d, targets).id, 2, 'el más cercano');
  assert.equal(pickTarget(o, V(0, 0, 1), targets), null, 'de espaldas');
  assert.equal(pickTarget(o, d, targets, 40, 4), null, 'una pared a 4 m tapa a los de detrás');
  assert.equal(pickTarget(o, d, targets, 3), null, 'fuera de alcance');
  assert.equal(pickTarget(o, V(0.3, 0, -1).normalize(), targets), null, 'fallar a un lado');
  ok('puntería');
}

// 6) Panel flotante: apuntar y tocar con la mano, en cualquier dirección.
{
  for (const yaw of [0, Math.PI / 2, Math.PI, -1]) {
    const f = V(-Math.sin(yaw), 0, -Math.cos(yaw)); // hacia donde miraba el jugador
    const eye = V(2, 1.6, 3);
    const c = eye.clone().addScaledVector(f, 1.15);
    const pl = makePlane(c, yaw, 1.5, 1.0);
    const mid = planeRay(pl, eye, new THREE.Vector3().subVectors(c, eye).normalize());
    assert.ok(mid && Math.abs(mid.u - 0.5) < 1e-6 && Math.abs(mid.v - 0.5) < 1e-6, 'el centro, yaw ' + yaw);
    const right = V(Math.cos(yaw), 0, -Math.sin(yaw));
    const aim = c.clone().addScaledVector(right, 0.3).add(V(0, 0.2, 0));
    const hit = planeRay(pl, eye, aim.sub(eye).normalize());
    assert.ok(Math.abs(hit.u - 0.7) < 1e-6 && Math.abs(hit.v - 0.3) < 1e-6, 'derecha y arriba, yaw ' + yaw);
    assert.equal(planeRay(pl, eye, V(0, 0, 0).sub(f).normalize()), null, 'mirando al otro lado');
    assert.equal(planeRay(pl, eye, aim.clone().sub(eye).add(right.clone().multiplyScalar(5)).normalize()), null, 'fuera del panel');
    // tocar con la mano: delante (z>0), atravesando (z<=0.09), por detrás sin tocar
    const hand = c.clone().addScaledVector(pl.N, 0.05).addScaledVector(right, -0.4);
    const poke = planePoke(pl, hand);
    assert.ok(poke && Math.abs(poke.u - (0.5 - 0.4 / 1.5)) < 1e-6 && Math.abs(poke.z - 0.05) < 1e-6);
    assert.equal(planePoke(pl, c.clone().addScaledVector(pl.N, 0.6)), null, 'demasiado lejos');
    assert.equal(planePoke(pl, c.clone().addScaledVector(pl.N, -0.5)), null, 'por detrás');
  }
  ok('panel: apuntar y tocar en cualquier orientación');
}

// 7) El panel (AdminUI): botones, armas, paginado, acciones.
{
  const calls = [];
  let players = [{ id: 7, name: 'Ana', nan: false }, { id: 9, name: 'Beto', nan: true }];
  let tool = '', map = 'lobby';
  const rec = (name) => (...a) => calls.push([name, ...a]);
  const ui = new AdminUI({
    getState: () => ({ players, tool, map }),
    actions: { tool: (t) => { tool = t; calls.push(['tool', t]); }, kick: rec('kick'), nan: rec('nan'), unnan: rec('unnan'), lava: rec('lava'), newRound: rec('newRound'), unnanAll: rec('unnanAll'), toggleTest: rec('toggleTest'), close: rec('close') },
  });
  const center = (id) => { const b = ui.buttons.find((x) => x.id === id); assert.ok(b, 'falta el botón ' + id); return [(b.x + b.w / 2) / PANEL.W, (b.y + b.h / 2) / PANEL.H]; };
  const press = (id) => ui.pressAt(...center(id));
  assert.equal(press('kick-7'), 'kick-7');
  assert.equal(press('nan-7'), 'nan-7');
  assert.equal(press('nan-9'), 'nan-9'); // Beto ya está en NaN: el botón lo quita
  assert.equal(press('lava-9'), 'lava-9');
  press('tool-kick'); press('tool-nan'); press('tool-none');
  press('newround'); press('unnanall'); press('testmap'); press('close');
  assert.deepEqual(calls.map((c) => c.join(':')), ['kick:7', 'nan:7', 'unnan:9', 'lava:9', 'tool:kick', 'tool:nan', 'tool:', 'newRound', 'unnanAll', 'toggleTest', 'close']);
  assert.equal(ui.pressAt(0.5, 0.5), null, 'pulsar en un hueco no hace nada');
  // botones sin solaparse y dentro del panel
  for (const b of ui.buttons) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= PANEL.W && b.y + b.h <= PANEL.H, b.id + ' fuera del panel');
  for (let i = 0; i < ui.buttons.length; i++) for (let j = i + 1; j < ui.buttons.length; j++) {
    const a = ui.buttons[i], b = ui.buttons[j];
    assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), a.id + ' se solapa con ' + b.id);
  }
  // muchos jugadores: páginas
  players = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: 'J' + (i + 1), nan: false }));
  ui.build();
  assert.equal(ui.buttons.filter((b) => b.id.startsWith('kick-')).length, PANEL.ROWS);
  assert.equal(ui.pages, 3);
  press('next');
  assert.ok(ui.buttons.some((b) => b.id === 'kick-5') && !ui.buttons.some((b) => b.id === 'kick-1'));
  // botón del mapa de pruebas según dónde estés
  map = 'test'; ui.build();
  assert.equal(ui.buttons.find((b) => b.id === 'testmap').label, 'VOLVER A LA PLAZA');
  ok('panel: botones, acciones y páginas');
}

// 8) Pistolas y mapa de pruebas.
{
  for (const t of Object.keys(TOOLS)) {
    const g = buildGun(t);
    const size = new THREE.Box3().setFromObject(g).getSize(V(0, 0, 0));
    assert.ok(size.z > 0.2 && size.x < 0.1, t + ': pistola larga y fina');
    assert.ok(new THREE.Box3().setFromObject(g).min.z < -0.25, t + ': apunta hacia delante');
  }
  assert.equal(buildGun('nada'), null);
  const m = buildMap('test');
  assert.ok(m.boxes.length > 30 && m.spheres.length >= 3, 'el mapa de pruebas tiene de todo');
  assert.ok(m.portals.some((p) => p.to === 'lobby'), 'con portal de vuelta');
  ok('pistolas y mapa de pruebas');
}

console.log('\nPruebas de admin: ' + n + ' correctas');
