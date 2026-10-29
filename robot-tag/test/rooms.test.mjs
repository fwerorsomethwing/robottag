import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { MAP_IDS } from '../public/maps.js';
const { Rooms } = createRequire(import.meta.url)('../rooms.js');

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);

function setup(opts = {}) {
  const inbox = new Map(); // id -> mensajes
  const rooms = new Rooms({ mapIds: MAP_IDS, defaultMap: 'lobby', send: (p, s) => { (inbox.get(p.id) || inbox.set(p.id, []).get(p.id)).push(JSON.parse(s)); }, ...opts });
  const add = (name, map, code, cos) => {
    const p = rooms.newPlayer({});
    rooms.join(p, undefined, ''); // como hace el servidor al conectar
    rooms.handle(p, { t: 'join', name, color: 0xff7fb0, cos, map, code });
    return p;
  };
  const snaps = (p) => inbox.get(p.id).filter((m) => m.t === 'snap');
  const last = (p) => snaps(p).at(-1);
  const at = (p, x, z, y = 1) => rooms.handle(p, { t: 's', p: [x, y, z], yaw: 0, l: [x, y, z], r: [x, y, z] });
  return { rooms, add, snaps, last, at, inbox };
}

// 1) Cada mapa es una sala distinta: no se ven entre sí.
{
  const { rooms, add, at, last } = setup();
  const a = add('Ana', 'forest'), b = add('Beto', 'forest'), c = add('Cris', 'cave'), d = add('Dani');
  [a, b, c, d].forEach((p, i) => at(p, i, 0));
  rooms.tick();
  assert.deepEqual(last(a).players.map((p) => p.name).sort(), ['Ana', 'Beto']);
  assert.deepEqual(last(c).players.map((p) => p.name), ['Cris']);
  assert.deepEqual(last(d).players.map((p) => p.name), ['Dani']);
  assert.equal(last(a).map, 'forest');
  ok('cada mapa es una sala; no se ven entre mapas');
}

// 2) Códigos privados: mismo código y mapa = misma sala; sin código = pública.
{
  const { rooms, add, at, last } = setup();
  const a = add('Ana', 'city', 'amigos'), b = add('Beto', 'city', 'AMIGOS'), c = add('Cris', 'city', 'otros'), d = add('Dani', 'city');
  [a, b, c, d].forEach((p, i) => at(p, i * 5, 0));
  rooms.tick();
  assert.deepEqual(last(a).players.map((p) => p.name).sort(), ['Ana', 'Beto']);
  assert.deepEqual(last(c).players.map((p) => p.name), ['Cris']);
  assert.deepEqual(last(d).players.map((p) => p.name), ['Dani']);
  assert.equal(add('Eva', 'cave', 'amigos').room.key, 'cave#AMIGOS', 'el mismo código en otro mapa es otra sala');
  assert.equal(add('Fer', 'city', '!!!').room.code, '', 'código inválido -> pública');
  ok('salas privadas por código');
}

// 3) Las salas públicas se llenan y se abre otra.
{
  const { rooms, add } = setup({ maxPublic: 3 });
  const ps = [1, 2, 3, 4, 5, 6, 7].map((i) => add('P' + i, 'canyon'));
  assert.deepEqual(ps.map((p) => p.room.n), [1, 1, 1, 2, 2, 2, 3]);
  rooms.leave(ps[0]); // queda un hueco en la sala 1
  assert.equal(add('Nuevo', 'canyon').room.n, 1, 'reusa el hueco');
  ok('salas públicas con tope y desbordamiento');
}

// 4) Sala privada llena: se avisa y se pasa a una pública.
{
  const { rooms, add, inbox } = setup({ maxPrivate: 2 });
  add('A', 'cave', 'x'); add('B', 'cave', 'x');
  const c = add('C', 'cave', 'x');
  assert.equal(c.room.code, '');
  assert.ok(inbox.get(c.id).some((m) => m.t === 'notice'));
  ok('sala privada llena -> pública con aviso');
}

// 5) Mapa y código inválidos no rompen nada; cambiar de sala limpia la posición.
{
  const { rooms, add, at, last } = setup();
  const a = add('Ana', '../../etc/passwd', 'x'.repeat(40));
  assert.equal(a.room.map, 'lobby');
  assert.equal(a.room.code, '');
  rooms.handle(a, { t: 'map', map: 'city' });
  assert.equal(a.room.map, 'city');
  assert.equal(a.p, null, 'la posición vieja no se arrastra');
  rooms.handle(a, { t: 'map', map: 'cave', code: 'zz' });
  assert.equal(a.room.key, 'cave#ZZ');
  assert.equal([...rooms.rooms.keys()].filter((k) => k.startsWith('city')).length, 0, 'las salas vacías se borran');
  rooms.handle(a, 'basura'); rooms.handle(a, null); rooms.handle(a, { t: 's', p: ['x'] });
  ok('mapas/códigos inválidos y cambio de sala');
}

// 6) LAVA: se elige en cada sala con 2+ jugadores, se contagia por contacto y pasa por sala.
{
  const { rooms, add, at, last } = setup({ immunityMs: 0 });
  const a = add('Ana', 'forest'), b = add('Beto', 'forest'), c = add('Cris', 'cave');
  assert.ok([a.id, b.id].includes(a.room.itId), 'hay LAVA en el bosque');
  assert.equal(c.room.itId, null, 'sola en la cueva: sin LAVA');
  const lava = a.room.itId === a.id ? a : b, other = lava === a ? b : a;
  at(lava, 0, 0); at(other, 5, 0);
  await new Promise((r) => setTimeout(r, 5));
  rooms.tick(Date.now());
  assert.equal(a.room.itId, lava.id, 'lejos: no se contagia');
  at(other, 0.5, 0);
  rooms.tick(Date.now());
  assert.equal(a.room.itId, other.id, 'cerca: se contagia');
  assert.equal(last(a).it, other.id);
  rooms.leave(other);
  assert.equal(lava.room.itId, null, 'si se va el único otro jugador, se acaba la LAVA');
  ok('LAVA por sala: elegir, contagiar, salirse');
}

// 7) Perfil validado: nombre, color y cosméticos.
{
  const { rooms, add } = setup();
  const a = add('<b>Ana</b>  larguísimo nombre', 'lobby', '', { head: 'headphones', badge: '../x', otro: 'y' });
  assert.ok(a.name.length <= 14 && !a.name.includes('<'));
  assert.deepEqual(a.cos, { head: 'headphones' });
  rooms.handle(a, { t: 'profile', color: -4 });
  assert.equal(a.c, 0xff7fb0, 'color inválido ignorado');
  rooms.handle(a, { t: 'profile', color: 0x45e08a, cos: { badge: 'early_badge' } });
  assert.equal(a.c, 0x45e08a);
  assert.deepEqual(a.cos, { badge: 'early_badge' });
  ok('perfil validado');
}

// 8) Los mapas del servidor son los del cliente.
{
  const { rooms } = setup();
  assert.deepEqual([...rooms.mapIds].sort(), [...MAP_IDS].sort());
  assert.deepEqual(rooms.stats(), { rooms: 0, players: 0 });
  ok('mapas del servidor = mapas del cliente');
}

console.log('\nPruebas de salas: ' + n + ' correctas');
