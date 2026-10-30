import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CATALOG, SHOP_CATALOG, SLOTS, PALETTE, Profile, buildCosmetic, itemById, visibleCatalog } from '../public/cosmetics.js';

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: m };
};

// 1) Catálogo: los dos cosméticos pedidos, con ids únicos, ranuras válidas y modelo 3D.
{
  assert.deepEqual(CATALOG.map((c) => c.name).sort(), ['Early Access Badge', 'Headphones', 'Owner Badge', 'Stick']);
  assert.deepEqual(SHOP_CATALOG.map((c) => c.id), ['early_badge', 'headphones', 'stick'], 'el Owner Badge no está en la tienda');
  assert.equal(new Set(CATALOG.map((c) => c.id)).size, CATALOG.length);
  for (const c of CATALOG) {
    assert.ok(SLOTS.includes(c.slot), c.id + ': ranura inválida');
    const m = buildCosmetic(c.id);
    assert.ok(m instanceof THREE.Group && m.children.length > 0, c.id + ': sin modelo');
    assert.equal(itemById(c.id), c);
  }
  assert.equal(buildCosmetic('no_existe'), null);
  ok('catálogo: Early Access Badge, Headphones, Stick y Owner Badge con su modelo 3D');
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

// 6) Owner Badge: no se compra, no se guarda, no se falsifica; lo desbloquea el servidor.
{
  const st = memory();
  const p = new Profile(st);
  assert.ok(!p.owned.has('owner_badge') && !p.isEquipped('owner_badge'));
  assert.deepEqual(p.buy('owner_badge'), { ok: false, reason: 'owner' });
  p.addCoins(999);
  assert.deepEqual(p.toggle('owner_badge'), { ok: false, reason: 'owner' });
  assert.ok(!visibleCatalog(p).some((c) => c.id === 'owner_badge'), 'no sale en la computadora si no eres dueño');

  // intento de falsificarlo en el almacenamiento
  st.raw.set('robottag.profile.v1', JSON.stringify({ owned: ['owner_badge', 'stick'], equipped: { badge: 'owner_badge', hand: 'stick' }, ownerSeen: true }));
  const f = new Profile(st);
  assert.ok(!f.owned.has('owner_badge') && !f.isEquipped('owner_badge'), 'sin confirmación del servidor no hay insignia');
  assert.ok(f.isEquipped('stick'), 'el palo es un objeto normal');
  ok('Owner Badge: no se compra ni se falsifica');
}

// 7) Dueño confirmado: la primera vez se pone sola, después se respeta tu elección y no se guarda como propio.
{
  const st = memory();
  const p = new Profile(st);
  assert.equal(p.setOwner(true), true);
  assert.ok(p.owned.has('owner_badge') && p.isEquipped('owner_badge'));
  assert.ok(!p.isEquipped('early_badge'), 'comparten ranura: la de dueño sustituye a la otra');
  assert.ok(visibleCatalog(p).some((c) => c.id === 'owner_badge'));
  assert.equal(p.setOwner(true), false, 'confirmar otra vez no repite el aviso');
  p.toggle('owner_badge'); // se la quita
  p.toggle('early_badge');
  assert.ok(p.isEquipped('early_badge'));
  assert.ok(!JSON.parse(st.raw.get('robottag.profile.v1')).owned.includes('owner_badge'), 'no se guarda en owned');

  // otra sesión: sin confirmación no hay insignia; al confirmar se respeta la elección (no la lleva)
  const q = new Profile(st);
  assert.ok(!q.owned.has('owner_badge'));
  assert.equal(q.setOwner(true), true);
  assert.ok(!q.isEquipped('owner_badge') && q.isEquipped('early_badge'), 'respeta que no la llevaras');
  q.toggle('owner_badge'); // la vuelve a poner
  const r = new Profile(st);
  r.setOwner(true);
  assert.ok(r.isEquipped('owner_badge'), 'recuerda que la llevabas');
  // si el servidor deja de confirmar, desaparece
  r.setOwner(false);
  assert.ok(!r.owned.has('owner_badge') && !r.isEquipped('owner_badge'));
  assert.ok(r.publicInfo().cos.badge === undefined);
  ok('dueño: se desbloquea, se recuerda la elección y se retira si el servidor no confirma');
}

// 8) Stick: se compra y se pone en la ranura de la mano; el modelo apunta hacia delante.
{
  const p = new Profile(memory());
  assert.deepEqual(p.buy('stick'), { ok: false, reason: 'coins', missing: 30 });
  p.addCoins(30);
  assert.deepEqual(p.buy('stick'), { ok: true });
  assert.equal(p.equipped.hand, 'stick');
  assert.ok(p.isEquipped('early_badge'), 'el palo no quita la insignia (ranuras distintas)');
  const m = buildCosmetic('stick');
  const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
  assert.ok(size.z > 0.6 && size.x < 0.1, 'largo en Z y delgado');
  assert.ok(box.min.z < -0.5, 'sale hacia delante (-Z)');
  ok('stick');
}

console.log('\nPruebas de cosméticos: ' + n + ' correctas');
