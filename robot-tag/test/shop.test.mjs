import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SHOP, SHOP_RECT, shopItems, pickShopItem, touchShopItem, shopLabel, shopPurchase, coinsLabel } from '../public/shop.js';
import { CATALOG, Profile } from '../public/cosmetics.js';

const V3 = THREE.Vector3;
let n = 0;
const ok = (name) => console.log('  ok', ++n, name);
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

// 1) Un pedestal por cosmético, dentro del local y sin amontonarse.
{
  const items = shopItems();
  assert.deepEqual(items.map((i) => i.name), CATALOG.map((c) => c.name));
  assert.deepEqual(items.map((i) => i.name).sort(), ['Early Access Badge', 'Headphones']);
  for (const it of items) {
    assert.ok(it.x > SHOP_RECT.x0 + 1 && it.x < SHOP_RECT.x1 - 1 && it.z > SHOP_RECT.z0 + 1 && it.z < SHOP_RECT.z1 - 1, it.id + ' fuera del local');
    assert.ok(it.y > 1 && it.y < 2.2, 'a altura de manos');
  }
  assert.ok(Math.hypot(items[0].x - items[1].x, items[0].z - items[1].z) > 2, 'pedestales muy juntos');
  ok('un pedestal por cosmético, dentro del local');
}

// 2) Apuntar a un cosmético (mira desde la entrada) lo elige; apuntar a otro lado no.
{
  const [a, b] = shopItems();
  const eye = new V3(SHOP.x, 1.6, SHOP.z + 4.5);
  const at = (it) => new V3(it.x - eye.x, it.y - eye.y, it.z - eye.z).normalize();
  assert.equal(pickShopItem(eye, at(a)).id, a.id);
  assert.equal(pickShopItem(eye, at(b)).id, b.id);
  assert.equal(pickShopItem(eye, new V3(0, 0, 1)), null);
  assert.equal(pickShopItem(new V3(SHOP.x, 1.6, SHOP.z + 12), at(a), 6), null, 'demasiado lejos');
  ok('apuntar elige el cosmético correcto y respeta la distancia');
}

// 3) Tocar con la mano (VR).
{
  const [a, b] = shopItems();
  assert.equal(touchShopItem(new V3(a.x + 0.2, a.y, a.z)), a.id);
  assert.equal(touchShopItem(new V3(b.x, b.y - 0.3, b.z + 0.2)), b.id);
  assert.equal(touchShopItem(new V3(a.x, a.y + 1.2, a.z)), null);
  assert.equal(touchShopItem(new V3(0, 1, 0)), null);
  ok('tocar con la mano');
}

// 4) Comprar, ponerse y quitarse; sin monedas no se compra.
{
  const p = new Profile(memory());
  assert.equal(shopPurchase(p, 'nada'), null);
  const sin = shopPurchase(p, 'headphones');
  assert.equal(sin.changed, false);
  assert.match(sin.text, /Te faltan 50 monedas/);
  assert.equal(p.coins, 0);
  p.addCoins(60);
  const buy = shopPurchase(p, 'headphones');
  assert.equal(buy.changed, true);
  assert.match(buy.text, /Comprado: Headphones/);
  assert.equal(p.coins, 10);
  assert.ok(p.isEquipped('headphones'));
  const off = shopPurchase(p, 'headphones');
  assert.match(off.text, /Quitado: Headphones/);
  assert.ok(!p.isEquipped('headphones'));
  const on = shopPurchase(p, 'headphones');
  assert.match(on.text, /Puesto: Headphones/);
  assert.equal(p.coins, 10, 'ponerse y quitarse no cobra');
  assert.match(shopPurchase(p, 'early_badge').text, /Quitado: Early Access Badge/);
  ok('comprar, ponerse y quitarse en la tienda');
}

// 5) Los carteles muestran el estado real.
{
  const p = new Profile(memory());
  const [badge, phones] = [CATALOG[0], CATALOG[1]].map((c) => shopItems().find((i) => i.id === c.id));
  assert.match(shopLabel(p, phones).line, /50 monedas \(faltan 50\)/);
  assert.equal(shopLabel(p, phones).color, '#ff8a7a');
  assert.match(shopLabel(p, badge).line, /PUESTO/);
  p.addCoins(50);
  assert.equal(shopLabel(p, phones).line, '50 monedas');
  assert.equal(shopLabel(p, phones).color, '#ffd23d');
  shopPurchase(p, 'headphones'); shopPurchase(p, 'headphones');
  assert.match(shopLabel(p, phones).line, /TUYO/);
  assert.equal(coinsLabel(p), 'Tus monedas: 0');
  ok('carteles: precio, puesto, tuyo y monedas');
}

console.log('\nPruebas de la tienda: ' + n + ' correctas');
