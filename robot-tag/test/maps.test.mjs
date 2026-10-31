import assert from 'node:assert/strict';
import { MAP_INFO, MAP_IDS, LOBBY, HALF, SPAWN_KEEP, buildMap, portalAt } from '../public/maps.js';
import { COURSES, courseSteps } from '../public/courses.js';
import { SHOP_RECT } from '../public/shop.js';

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);

// 1) Los mapas existen y son siempre idénticos (todos los jugadores ven lo mismo).
{
  assert.deepEqual(MAP_IDS, ['lobby', 'forest', 'cave', 'canyon', 'city', 'test']);
  assert.deepEqual(MAP_INFO.filter((m) => m.hidden).map((m) => m.id), ['test'], 'el mapa de pruebas no sale en los portales');
  for (const id of MAP_IDS) {
    const a = buildMap(id), b = buildMap(id);
    assert.equal(JSON.stringify(a), JSON.stringify(b), id + ': el mapa cambia entre generaciones');
    assert.ok(a.boxes.length > 5, id + ': casi vacío');
    assert.equal(a.id, id);
  }
  assert.throws(() => buildMap('nada'));
  ok('6 mapas deterministas (Plaza, Bosque, Cueva, Cañón, Ciudad, Pruebas)');
}

// 2) Los mapas nuevos son de verdad distintos y tienen contenido propio.
{
  const count = (id) => { const m = buildMap(id); return m.boxes.length + m.spheres.length; };
  assert.ok(count('forest') > 100, 'bosque con árboles');
  assert.ok(count('cave') > 90, 'cueva con estalactitas y pilares');
  assert.ok(count('canyon') > 40, 'cañón con mesas');
  assert.ok(count('city') > 100, 'ciudad con edificios');
  assert.ok(buildMap('forest').spheres.length > 20, 'copas de árboles');
  assert.ok(buildMap('cave').lights.length >= 3, 'cueva iluminada con luces de colores');
  assert.ok(buildMap('cave').boxes.some((b) => b.y > 11.5), 'techo de la cueva');
  assert.ok(buildMap('cave').light.sun === 0, 'la cueva es oscura');
  const skies = new Set(MAP_IDS.map((id) => buildMap(id).sky));
  assert.equal(skies.size, MAP_IDS.length, 'cada mapa tiene su propio cielo');
  ok('cada mapa tiene su contenido y ambiente');
}

// 3) Todo está dentro de la arena y no se pasa de la altura de los muros.
{
  for (const id of MAP_IDS) {
    const m = buildMap(id);
    for (const b of m.boxes) {
      if (b.ground || b.sx > 55 || b.sz > 55) continue; // suelo, muros y techo
      assert.ok(Math.abs(b.x) + b.sx / 2 <= HALF + 0.01 && Math.abs(b.z) + b.sz / 2 <= HALF + 0.01, `${id}: caja fuera de la arena (${b.x},${b.z})`);
      assert.ok(b.y - b.sy / 2 >= -0.01, `${id}: caja bajo el suelo`);
      assert.ok(b.y + b.sy / 2 <= 12.01, `${id}: caja por encima de los muros (${(b.y + b.sy / 2).toFixed(1)} m)`);
    }
    for (const s of m.spheres) assert.ok(Math.abs(s.x) + s.r <= HALF + 0.01 && Math.abs(s.z) + s.r <= HALF + 0.01, `${id}: esfera fuera`);
  }
  ok('todo cabe dentro de la arena');
}

// 4) El punto de aparición y el portal de vuelta están libres en todos los mapas nuevos.
{
  const solid = (m) => [...m.boxes.filter((b) => !b.ground).map((b) => ({ x0: b.x - b.sx / 2, x1: b.x + b.sx / 2, z0: b.z - b.sz / 2, z1: b.z + b.sz / 2, y0: b.y - b.sy / 2, y1: b.y + b.sy / 2 })),
    ...m.spheres.map((s) => ({ x0: s.x - s.r, x1: s.x + s.r, z0: s.z - s.r, z1: s.z + s.r, y0: s.y - s.r, y1: s.y + s.r }))];
  const hits = (r, k) => r.x1 > k.x0 && r.x0 < k.x1 && r.z1 > k.z0 && r.z0 < k.z1;
  for (const id of MAP_IDS.filter((x) => x !== LOBBY)) {
    const m = buildMap(id);
    // zona de personas: de 0 a 3 m de altura (el techo de la cueva y estalactitas altas quedan fuera)
    for (const r of solid(m)) {
      if (r.y0 > 3.2) continue;
      if (r.x1 - r.x0 > 55) continue; // muros
      assert.ok(!hits(r, SPAWN_KEEP), `${id}: algo bloquea la aparición/portal en (${r.x0.toFixed(1)}, ${r.z0.toFixed(1)})`);
    }
    const sp = m.spawn;
    assert.ok(sp.x - sp.jitter / 2 >= SPAWN_KEEP.x0 && sp.x + sp.jitter / 2 <= SPAWN_KEEP.x1 && sp.z >= SPAWN_KEEP.z0 && sp.z <= SPAWN_KEEP.z1, id + ': aparición fuera de la zona libre');
    const back = m.portals.find((p) => p.to === LOBBY);
    assert.ok(back, id + ': sin portal de vuelta');
    assert.ok(back.x - 1.2 >= SPAWN_KEEP.x0 && back.x + 1.2 <= SPAWN_KEEP.x1 && back.z + 1.2 <= SPAWN_KEEP.z1, id + ': portal fuera de la zona libre');
    // el portal no puede dispararse en la propia aparición
    for (const dx of [-sp.jitter / 2, sp.jitter / 2]) assert.equal(portalAt({ x: sp.x + dx, y: 0.6, z: sp.z }, m.portals), null, id + ': aparece dentro del portal');
  }
  ok('aparición y portal de vuelta libres, sin portal en la aparición');
}

// 5) La Plaza: cubo, esfera, un portal por mapa y nada pisa los cursos, la computadora ni la tienda.
{
  const m = buildMap(LOBBY);
  assert.ok(m.boxes.some((b) => b.sx === 4 && b.sy === 4 && b.sz === 4), 'el cubo');
  assert.ok(m.spheres.some((s) => s.r === 2.5), 'la esfera');
  assert.deepEqual(m.portals.map((p) => p.to), ['forest', 'cave', 'canyon', 'city']);
  assert.equal(new Set(m.portals.map((p) => p.x)).size, 4);
  for (const p of m.portals) {
    assert.ok(Math.abs(p.x) + 1.2 < HALF && p.z + 1.2 < HALF);
    // lejos de la aparición, de los cursos, de la computadora y de la tienda
    assert.ok(p.z > 20, 'portal lejos de los cursos');
    assert.ok(Math.hypot(p.x - 0, p.z - 9) > 10, 'portal lejos de la aparición');
  }
  const rect = (s) => ({ x0: s.x - s.sx / 2, x1: s.x + s.sx / 2, z0: s.z - s.sz / 2, z1: s.z + s.sz / 2 });
  const over = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
  const shop = SHOP_RECT;
  for (const c of Object.values(COURSES)) for (const s of courseSteps(c)) {
    assert.ok(!over(rect(s), shop), c.id + ' choca con la tienda');
  }
  assert.ok(!over({ x0: -8, x1: -4, z0: -8, z1: -4 }, shop), 'el cubo choca con la tienda');
  assert.ok(!over({ x0: -4.5, x1: 1.8, z0: 1.5, z1: 4.5 }, shop), 'la computadora choca con la tienda');
  assert.ok(!over({ x0: 5.5, x1: 10.5, z0: -2.5, z1: 2.5 }, shop), 'la esfera choca con la tienda');
  assert.ok(shop.x0 > -29 && shop.x1 < 29 && shop.z0 > -29 && shop.z1 < 29, 'la tienda cabe en la arena');
  ok('Plaza: cubo, esfera, 4 portales y la tienda sin choques');
}

// 6) Los portales: entrar en la columna de luz te lleva al mapa destino.
{
  const portals = buildMap(LOBBY).portals;
  const p = portals[1];
  assert.equal(portalAt({ x: p.x + 0.5, y: 1, z: p.z }, portals).to, 'cave');
  assert.equal(portalAt({ x: p.x + 1.5, y: 1, z: p.z }, portals), null, 'fuera de la columna');
  assert.equal(portalAt({ x: p.x, y: 5, z: p.z }, portals), null, 'por encima de la columna');
  assert.equal(portalAt({ x: 0, y: 1, z: 0 }, portals), null);
  ok('portales: entrar y salir');
}

console.log('\nPruebas de mapas: ' + n + ' correctas');
