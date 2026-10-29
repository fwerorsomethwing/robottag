import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CATALOG, SLOTS, PALETTE, Profile, buildCosmetic, itemById } from '../public/cosmetics.js';

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: m };
};

// 1) Catálogo: los dos cosméticos pedidos, con ids únicos, ranuras válidas y modelo 3D.
{
  assert.deepEqual(CATALOG.map((c) => c.name).sort(), ['Early Access Badge', 'Headphones']);
  assert.equal(new Set(CATALOG.map((c) => c.id)).size, CATALOG.length);
  for (const c of CATALOG) {
    assert.ok(SLOTS.includes(c.slot), c.id + ': ranura inválida');
    const m = buildCosmetic(c.id);
    assert.ok(m instanceof THREE.Group && m.children.length > 0, c.id + ': sin modelo');
    assert.equal(itemById(c.id), c);
  }
  assert.equal(buildCosmetic('no_existe'), null);
  ok('catálogo: Early Access Badge y Headphones con su modelo 3D');
}

// 2) Perfil nuevo: el badge viene gratis y puesto; los auriculares hay que comprarlos.
{
  const p = new Profile(memory());
  assert.ok(p.owned.has('early_badge') && p.isEquipped('early_badge'));
  assert.ok(!p.owned.has('headphones'));
  assert.ok(PALETTE.includes(p.color));
  assert.equal(p.coins, 0);
  ok('perfil nuevo: badge gratis y equipado');
}

// 3) Compra: sin monedas falla; con monedas descuenta, guarda y equipa; luego alterna equipar/quitar.
{
  const p = new Profile(memory());
  assert.deepEqual(p.buy('headphones'), { ok: false, reason: 'coins', missing: 50 });
  p.addCoins(70);
  assert.deepEqual(p.buy('headphones'), { ok: true });
  assert.equal(p.coins, 20);
  assert.ok(p.isEquipped('headphones'));
  assert.deepEqual(p.buy('headphones'), { ok: false, reason: 'owned' });
  assert.equal(p.toggle('headphones').equipped, false);
  assert.equal(p.toggle('headphones').equipped, true);
  assert.deepEqual(p.buy('nada'), { ok: false, reason: 'unknown' });
  assert.equal(p.coins, 20, 'alternar no cobra');
  p.unequipAll();
  assert.deepEqual(p.equipped, {});
  ok('comprar, equipar y quitar');
}

// 4) Se guarda y se recupera; datos corruptos o manipulados no rompen nada ni dan cosas gratis.
{
  const st = memory();
  const a = new Profile(st);
  a.setName('Pedro_99');
  a.setColor(0xff7fb0);
  a.addCoins(100);
  a.buy('headphones');
  a.recordTime('noob', 12.3);
  const b = new Profile(st);
  assert.equal(b.name, 'Pedro_99');
  assert.equal(b.color, 0xff7fb0);
  assert.equal(b.coins, 50);
  assert.ok(b.isEquipped('headphones') && b.isEquipped('early_badge'));
  assert.equal(b.best.noob, 12.3);

  st.raw.set('robottag.profile.v1', '{{{no es json');
  assert.doesNotThrow(() => new Profile(st));

  st.raw.set('robottag.profile.v1', JSON.stringify({
    name: 'x'.repeat(100), color: -5, coins: -20, owned: ['headphones', 'fake'],
    equipped: { head: 'headphones', badge: 'headphones' }, best: { noob: -1, pro: 'rápido' },
  }));
  const c = new Profile(st);
  assert.equal(c.name.length, 12);
  assert.ok(PALETTE.includes(c.color), 'color inválido se reemplaza');
  assert.equal(c.coins, 0);
  assert.ok(!c.owned.has('fake'));
  assert.equal(c.equipped.badge, undefined, 'un objeto no puede ir en otra ranura');
  assert.deepEqual(c.best, {});

  assert.doesNotThrow(() => new Profile(null), 'sin almacenamiento funciona');
  ok('guardado, recuperación y datos manipulados');
}

// 4b) Lo que se manda al servidor: nombre, color y cosméticos puestos (ranuras que acepta server.js).
{
  const p = new Profile(memory());
  p.setName('Ana'); p.setColor(0x45e08a); p.addCoins(50); p.buy('headphones');
  assert.deepEqual(p.publicInfo(), { name: 'Ana', color: 0x45e08a, cos: { head: 'headphones', badge: 'early_badge' } });
  p.publicInfo().cos.head = 'x';
  assert.equal(p.equipped.head, 'headphones', 'publicInfo devuelve una copia');
  ok('publicInfo para el servidor');
}

// 5) Mejores tiempos.
{
  const p = new Profile(memory());
  assert.deepEqual(p.recordTime('pro', 40), { first: true, improved: true, best: 40 });
  assert.deepEqual(p.recordTime('pro', 45), { first: false, improved: false, best: 40 });
  assert.deepEqual(p.recordTime('pro', 38.5), { first: false, improved: true, best: 38.5 });
  ok('mejores tiempos');
}

console.log('\nPruebas de cosméticos: ' + n + ' correctas');
