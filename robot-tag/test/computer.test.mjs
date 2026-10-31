import assert from 'node:assert/strict';
import { Computer, SCREEN } from '../public/computer.js';
import { Profile, PALETTE } from '../public/cosmetics.js';
import { COURSES } from '../public/courses.js';

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
// Contexto 2D falso: acepta cualquier llamada y guarda lo que se dibuja.
const fakeCtx = () => {
  const drawn = [];
  return new Proxy({ drawn }, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s) => ({ width: String(s).length * 10 }) : (...a) => { if (k === 'fillText') drawn.push(String(a[0])); }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
};
const setup = () => {
  const profile = new Profile(memory());
  const calls = { teleport: [], changed: [] };
  const computer = new Computer({
    profile, courses: COURSES,
    actions: { teleport: (t) => calls.teleport.push(t), changed: (w) => calls.changed.push(w) },
  });
  return { profile, calls, computer };
};

// 1) Todas las páginas se dibujan sin errores y muestran lo esperado.
{
  const { computer } = setup();
  for (const page of ['home', 'name', 'color', 'model', 'cosmetics', 'courses']) {
    computer.go(page);
    const ctx = fakeCtx();
    assert.doesNotThrow(() => computer.draw(ctx), page);
    assert.equal(computer.dirty, false);
    assert.ok(ctx.drawn.length > 0, page + ': no dibuja texto');
    if (page === 'cosmetics') {
      assert.ok(ctx.drawn.includes('Early Access Badge') && ctx.drawn.includes('Headphones'));
    }
    if (page !== 'home') assert.ok(computer.buttons.some((b) => b.id === 'back'), page + ': falta VOLVER');
    for (const b of computer.buttons) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= SCREEN.W && b.y + b.h <= SCREEN.H, `${page}/${b.id} se sale de la pantalla`);
    }
  }
  ok('todas las páginas se dibujan y sus botones caben en la pantalla');
}

// 2) Ningún botón se solapa con otro dentro de la misma página.
{
  const { computer } = setup();
  for (const page of ['home', 'name', 'color', 'model', 'cosmetics', 'courses']) {
    computer.go(page);
    const bs = computer.buttons;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j];
        assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), `${page}: ${a.id} solapa con ${b.id}`);
      }
    }
  }
  ok('los botones no se solapan');
}

// 3) Nombre con el teclado en pantalla.
{
  const { computer, profile, calls } = setup();
  computer.press('go-name');
  assert.equal(computer.page, 'name');
  for (const ch of 'PED') computer.press('key-' + ch);
  computer.press('key-X'); computer.press('del');
  computer.press('key-R'); computer.press('key-O');
  assert.equal(computer.nameBuf, 'PEDRO');
  computer.press('ok');
  assert.equal(profile.name, 'PEDRO');
  assert.deepEqual(calls.changed, ['name']);
  assert.equal(computer.page, 'home');
  // límite de largo y nombre vacío
  computer.press('go-name');
  for (let i = 0; i < 20; i++) computer.press('key-A');
  assert.equal(computer.nameBuf.length, 12);
  while (computer.nameBuf) computer.press('del');
  computer.press('ok');
  assert.equal(computer.page, 'name', 'no acepta nombre vacío');
  ok('nombre: teclado, borrar, límite y vacío');
}

// 4) Color.
{
  const { computer, profile, calls } = setup();
  computer.press('go-color');
  const c = PALETTE[3];
  computer.press('color-#' + c.toString(16).padStart(6, '0'));
  assert.equal(profile.color, c);
  assert.deepEqual(calls.changed, ['color']);
  assert.ok(computer.buttons.find((b) => b.active), 'marca el color elegido');
  ok('color');
}

// 5) Cosméticos: sin monedas no compra; con monedas compra y equipa; alterna; quita todo.
{
  const { computer, profile, calls } = setup();
  computer.press('go-cosmetics');
  computer.press('item-headphones');
  assert.ok(!profile.owned.has('headphones'));
  assert.match(computer.footer(), /faltan 50 monedas/);
  assert.deepEqual(calls.changed, []);
  profile.addCoins(50);
  computer.press('item-headphones');
  assert.ok(profile.isEquipped('headphones'));
  assert.equal(profile.coins, 0);
  assert.deepEqual(calls.changed, ['cos']);
  computer.press('item-headphones');
  assert.ok(!profile.isEquipped('headphones') && profile.owned.has('headphones'));
  computer.press('item-early_badge');
  assert.ok(!profile.isEquipped('early_badge'));
  computer.press('item-early_badge');
  assert.ok(profile.isEquipped('early_badge'));
  computer.press('clear');
  assert.deepEqual(profile.equipped, {});
  ok('cosméticos: comprar, equipar, quitar y quitar todo');
}

// 6) Cursos: teletransporte y mejores tiempos.
{
  const { computer, profile, calls } = setup();
  profile.recordTime('noob', 12.34);
  computer.press('go-courses');
  const ctx = fakeCtx();
  computer.draw(ctx);
  assert.ok(ctx.drawn.some((t) => t.includes('12.3 s')), 'muestra el mejor tiempo');
  computer.press('tp-noob'); computer.press('tp-pro'); computer.press('tp-spawn');
  assert.deepEqual(calls.teleport, ['noob', 'pro', 'spawn']);
  ok('cursos: teletransporte y mejores tiempos');
}

// 7) Pulsar por coordenadas (lo que hacen el mouse, el dedo y las manos de VR) y resaltar.
{
  const { computer } = setup();
  const b = computer.buttons.find((x) => x.id === 'go-color');
  const u = (b.x + b.w / 2) / SCREEN.W, v = (b.y + b.h / 2) / SCREEN.H;
  assert.equal(computer.hoverAt(u, v), true);
  assert.equal(computer.buttons[computer.hover].id, 'go-color');
  assert.equal(computer.hoverAt(0.5, 0.995), false);
  assert.equal(computer.pressAt(0.001, 0.999), false, 'pulsar el vacío no hace nada');
  assert.equal(computer.pressAt(u, v), true);
  assert.equal(computer.page, 'color');
  ok('pulsar y resaltar por coordenadas');
}

console.log('\nPruebas de la computadora: ' + n + ' correctas');
