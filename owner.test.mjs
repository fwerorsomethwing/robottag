import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { MAP_IDS } from '../public/maps.js';
const { Rooms, OWNER_ONLY } = createRequire(import.meta.url)('../rooms.js');

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);

function setup(ownerKey) {
  const inbox = new Map();
  const rooms = new Rooms({ mapIds: MAP_IDS, defaultMap: 'lobby', ownerKey, send: (p, s) => { (inbox.get(p.id) || inbox.set(p.id, []).get(p.id)).push(JSON.parse(s)); } });
  const add = (name, extra = {}) => {
    const p = rooms.newPlayer({});
    rooms.join(p, undefined, '');
    rooms.handle(p, { t: 'join', name, color: 0xff7fb0, map: 'lobby', ...extra });
    rooms.handle(p, { t: 's', p: [0, 1, 0], yaw: 0 });
    return p;
  };
  const owner = (p) => (inbox.get(p.id) || []).filter((m) => m.t === 'owner').map((m) => m.ok);
  const seen = (viewer, name) => {
    rooms.tick();
    return inbox.get(viewer.id).filter((m) => m.t === 'snap').at(-1).players.find((p) => p.name === name);
  };
  return { rooms, add, owner, seen };
}

// 1) Con la clave correcta se es dueño y se puede llevar la insignia; los demás la ven.
{
  const { add, owner, seen, rooms } = setup('mi-clave-secreta');
  const dueno = add('Jefe', { key: 'mi-clave-secreta', cos: { badge: 'owner_badge', hand: 'stick' } });
  const otro = add('Otro');
  assert.deepEqual(owner(dueno), [true]);
  assert.equal(dueno.owner, true);
  assert.deepEqual(seen(otro, 'Jefe').cos, { badge: 'owner_badge', hand: 'stick' });
  assert.ok(OWNER_ONLY.has('owner_badge'));
  rooms.handle(dueno, { t: 'profile', cos: { badge: 'early_badge' } });
  assert.deepEqual(seen(otro, 'Jefe').cos, { badge: 'early_badge' });
  ok('el dueño lleva el Owner Badge y los demás lo ven');
}

// 2) Sin clave, con clave mala o sin OWNER_KEY configurada: no hay insignia aunque la pidan.
{
  const a = setup('mi-clave-secreta');
  const falso = a.add('Falso', { key: 'otra', cos: { badge: 'owner_badge', head: 'headphones' } });
  assert.deepEqual(a.owner(falso), [false]);
  assert.deepEqual(a.seen(falso, 'Falso').cos, { head: 'headphones' }, 'solo se descarta lo de dueño');
  const sinClave = a.add('Sin', { cos: { badge: 'owner_badge' } });
  assert.deepEqual(a.owner(sinClave), []);
  assert.deepEqual(a.seen(sinClave, 'Sin').cos, {});
  // intentar colarlo después con un perfil
  a.rooms.handle(sinClave, { t: 'profile', cos: { badge: 'owner_badge' } });
  assert.deepEqual(a.seen(sinClave, 'Sin').cos, {});

  const b = setup(''); // el servidor no tiene dueño
  const x = b.add('X', { key: '', cos: { badge: 'owner_badge' } });
  const y = b.add('Y', { key: 'cualquiera', cos: { badge: 'owner_badge' } });
  assert.deepEqual(b.seen(x, 'X').cos, {});
  assert.deepEqual(b.seen(y, 'Y').cos, {});
  assert.equal(y.owner, false);
  assert.equal(setup(undefined).add('Z', { key: 'a' }).owner, false);
  ok('sin la clave correcta no hay Owner Badge');
}

// 3) Fuerza bruta: tras 5 claves malas ya no se comprueban ni la buena.
{
  const { add, rooms, owner } = setup('clave');
  const p = add('Atacante', { key: 'mala0' });
  for (let i = 1; i < 8; i++) rooms.handle(p, { t: 'profile', key: 'mala' + i });
  rooms.handle(p, { t: 'profile', key: 'clave' });
  assert.equal(p.owner, false, 'bloqueado en esta conexión');
  assert.ok(owner(p).every((v) => v === false));
  ok('límite de intentos de clave');
}

// 4) Claves raras no rompen nada; quitar la clave quita la condición de dueño.
{
  const { add, rooms, seen } = setup('clave');
  const p = add('Jefe', { key: 'clave', cos: { badge: 'owner_badge' } });
  assert.equal(p.owner, true);
  rooms.handle(p, { t: 'profile', key: 'x'.repeat(5000) }); // demasiado larga: se rechaza
  rooms.handle(p, { t: 'profile', key: 42 });
  rooms.handle(p, { t: 'profile', key: null });
  assert.equal(p.owner, true, 'tipos inválidos se ignoran');
  rooms.handle(p, { t: 'profile', key: '' }); // sin clave: deja de ser dueño y pierde la insignia
  assert.equal(p.owner, false);
  assert.deepEqual(seen(p, 'Jefe').cos, {});
  ok('claves inválidas y retirada del dueño');
}

console.log('\nPruebas de dueño: ' + n + ' correctas');
