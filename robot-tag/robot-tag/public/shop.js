// Tienda física de la Plaza: un local con pedestales donde se exhiben los cosméticos.
// Los tocas (mira + clic, botón de mano en el móvil o la mano en VR) para comprarlos, ponértelos o quitártelos.
// Sin DOM, se prueba en Node (test/shop.test.mjs).
import * as THREE from 'three';
import { raySphere } from './locomotion.js';
import { CATALOG } from './cosmetics.js';

const V3 = THREE.Vector3;

/** Local abierto por delante (hacia +Z, donde aparecen los jugadores). */
export const SHOP = { x: -1, z: -18.5, w: 10, d: 9, wallH: 3.2, roofTop: 4.4 };
export const SHOP_RECT = { x0: SHOP.x - SHOP.w / 2, x1: SHOP.x + SHOP.w / 2, z0: SHOP.z - SHOP.d / 2, z1: SHOP.z + SHOP.d / 2 };

const ITEM_Y = 1.6;      // altura a la que flota cada cosmético
const PICK_R = 0.8;      // radio de "tocar" con mira (generoso)
const TOUCH_R = 0.6;     // radio de "tocar" con la mano en VR
const ITEM_Z = SHOP.z - 1;

/** Posición de cada cosmético del catálogo, repartidos por el local. */
export function shopItems() {
  const n = CATALOG.length, spacing = Math.min(3.2, 8 / n);
  return CATALOG.map((it, i) => ({
    id: it.id, name: it.name, price: it.price, slot: it.slot,
    x: SHOP.x + (i - (n - 1) / 2) * spacing, y: ITEM_Y, z: ITEM_Z,
  }));
}

/** Cosmético al que apunta un rayo (el más cercano), o null. */
export function pickShopItem(origin, dir, maxT = 6) {
  let best = null;
  for (const it of shopItems()) {
    const h = raySphere(origin, dir, { c: new V3(it.x, it.y, it.z), r: PICK_R }, maxT);
    if (h && (!best || h.t < best.t)) best = { id: it.id, t: h.t };
  }
  return best;
}

/** Cosmético que toca una mano (VR), o null. */
export function touchShopItem(p) {
  for (const it of shopItems()) {
    if (Math.hypot(p.x - it.x, p.y - it.y, p.z - it.z) < TOUCH_R) return it.id;
  }
  return null;
}

/** Texto del cartel de cada pedestal según el estado del perfil. */
export function shopLabel(profile, item) {
  const owned = profile.owned.has(item.id);
  if (!owned) {
    const can = profile.coins >= item.price;
    return { title: item.name, line: item.price + ' monedas' + (can ? '' : ' (faltan ' + (item.price - profile.coins) + ')'), color: can ? '#ffd23d' : '#ff8a7a' };
  }
  if (profile.isEquipped(item.id)) return { title: item.name, line: 'PUESTO · toca para quitar', color: '#7dffb0' };
  return { title: item.name, line: 'TUYO · toca para ponerte', color: '#9fd0ff' };
}

/** ¿Comprar este objeto gasta monedas? (la tienda pide tocarlo dos veces para evitar compras sin querer) */
export function needsConfirm(profile, id) {
  const it = CATALOG.find((c) => c.id === id);
  return !!it && !profile.owned.has(id) && it.price > 0 && profile.coins >= it.price;
}

export const coinsLabel = (profile) => 'Tus monedas: ' + profile.coins;

/** Tocar un cosmético: comprar, ponerlo o quitarlo. @returns {{text, color, changed}|null} */
export function shopPurchase(profile, id) {
  const it = CATALOG.find((c) => c.id === id);
  if (!it) return null;
  const wasOwned = profile.owned.has(id);
  const r = profile.toggle(id);
  if (!r.ok) {
    if (r.reason === 'coins') return { text: 'Te faltan ' + r.missing + ' monedas para ' + it.name, color: '#ff8a7a', changed: false };
    return null;
  }
  if (!wasOwned) return { text: 'Comprado: ' + it.name, color: '#ffd23d', changed: true };
  return { text: (r.equipped ? 'Puesto: ' : 'Quitado: ') + it.name, color: r.equipped ? '#7dffb0' : '#ffffff', changed: true };
}
