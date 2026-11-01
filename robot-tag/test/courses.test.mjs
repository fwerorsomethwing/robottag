import assert from 'node:assert/strict';
import { COURSES, CourseTracker, courseSteps } from '../public/courses.js';

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);

const gap1 = (aMin, aMax, bMin, bMax) => Math.max(0, aMin - bMax, bMin - aMax);
const rect = (p) => ({ x0: p.x - p.sx / 2, x1: p.x + p.sx / 2, z0: p.z - p.sz / 2, z1: p.z + p.sz / 2 });
const gap = (a, b) => {
  const A = rect(a), B = rect(b);
  return Math.hypot(gap1(A.x0, A.x1, B.x0, B.x1), gap1(A.z0, A.z1, B.z0, B.z1));
};

// Alcance horizontal máximo al aterrizar a +rise m con rapidez v (mejor ángulo), rama descendente.
function range(rise, v) {
  let best = 0;
  for (let deg = 20; deg <= 70; deg += 1) {
    const a = (deg * Math.PI) / 180, vy = v * Math.sin(a), vx = v * Math.cos(a);
    const disc = vy * vy - 2 * 9.8 * rise;
    if (disc < 0) continue;
    best = Math.max(best, vx * ((vy + Math.sqrt(disc)) / 9.8));
  }
  return best;
}

const stops = (c) => courseSteps(c);

// 1) Cada salto cabe en el alcance de un jugador de VR (tope de salto 6,5 m/s) con margen de 0,6 m.
{
  const VR_MAX = 6.5;
  for (const c of Object.values(COURSES)) {
    const s = stops(c);
    for (let i = 1; i < s.length; i++) {
      const g = gap(s[i - 1], s[i]);
      const rise = s[i].top - s[i - 1].top;
      assert.ok(rise <= 0.5, `${c.id} salto ${i}: escalón de ${rise.toFixed(2)} m`);
      const reach = range(rise, VR_MAX);
      assert.ok(g + 0.6 <= reach, `${c.id} salto ${i}: hueco ${g.toFixed(2)} m, alcance ${reach.toFixed(2)} m`);
    }
  }
  ok('todos los saltos son alcanzables (VR, 6,5 m/s)');
}

// 2) PRO es más difícil que NOOB: huecos mayores y plataformas más pequeñas.
{
  const stat = (c) => {
    const s = stops(c).slice(1, -1);
    const gaps = stops(c).slice(1).map((p, i) => gap(stops(c)[i], p));
    return {
      maxGap: Math.max(...gaps),
      area: s.reduce((a, p) => a + p.sx * p.sz, 0) / s.length,
    };
  };
  const noob = stat(COURSES.noob), pro = stat(COURSES.pro);
  assert.ok(pro.maxGap > noob.maxGap, `huecos pro ${pro.maxGap.toFixed(2)} > noob ${noob.maxGap.toFixed(2)}`);
  assert.ok(pro.area < noob.area / 2, `plataformas pro ${pro.area.toFixed(1)} m² < mitad de noob ${noob.area.toFixed(1)} m²`);
  assert.ok(COURSES.pro.reward.first > COURSES.noob.reward.first, 'PRO paga más');
  ok('PRO es más difícil y paga más que NOOB');
}

// 3) Nada se sale de la arena ni choca con el homenaje, la computadora o entre cursos.
{
  const reserved = {
    homenaje: { x0: -8, x1: -4, z0: -8, z1: -4 },
    computadora: { x0: -4.5, x1: 1.8, z0: 1.5, z1: 4.5 }, // kiosco y maniquí
    aparicion: { x0: -3, x1: 3, z0: 7, z1: 11 },
  };
  const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
  const all = [];
  for (const c of Object.values(COURSES)) for (const p of stops(c)) all.push([c.id, p]);
  for (const [id, p] of all) {
    const r = rect(p);
    assert.ok(r.x0 > -29.5 && r.x1 < 29.5 && r.z0 > -29.5 && r.z1 < 29.5, `${id}: fuera de la arena`);
    for (const [name, rs] of Object.entries(reserved)) assert.ok(!overlap(r, rs), `${id}: choca con ${name}`);
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i][1], b = all[j][1];
      if (a === b) continue;
      assert.ok(!overlap(rect(a), rect(b)), `plataformas solapadas: ${all[i][0]}#${i} y ${all[j][0]}#${j}`);
    }
  }
  ok('los cursos caben en la arena sin chocar con nada');
}

// 4) El cronómetro: armar, empezar, terminar, reiniciar y cambiar de curso.
{
  const c = COURSES.noob;
  const t = new CourseTracker(COURSES);
  const onStart = { x: c.start.x, z: c.start.z, y: c.start.top + 0.55 };
  const away = { x: 0, z: 0, y: 0.55 };
  const onFinish = { x: c.finish.x, z: c.finish.z, y: c.finish.top + 0.55 };

  assert.deepEqual(t.update(onStart, 0), []);
  assert.equal(t.armed, 'noob');
  assert.deepEqual(t.update(away, 1), [{ type: 'start', course: 'noob' }]);
  assert.equal(t.elapsed(4.5), 3.5);
  const fin = t.update(onFinish, 13.2);
  assert.equal(fin.length, 1);
  assert.equal(fin[0].type, 'finish');
  assert.ok(Math.abs(fin[0].time - 12.2) < 1e-9);
  assert.equal(t.running, null);
  // sin pasar por la salida no se puede acabar el curso
  assert.deepEqual(t.update(onFinish, 20), []);

  // volver a la salida reinicia
  t.update(onStart, 30); t.update(away, 31);
  assert.equal(t.running, 'noob');
  assert.deepEqual(t.update(onStart, 40), [{ type: 'reset', course: 'noob' }]);
  assert.equal(t.running, null);

  // desde el suelo no se puede "tocar" la meta (la cabeza está muy abajo)
  t.update(onStart, 50); t.update(away, 51);
  assert.deepEqual(t.update({ x: c.finish.x, z: c.finish.z, y: 0.6 }, 52), []);
  ok('cronómetro: empezar, terminar, reiniciar');

  // cambiar a otro curso cancela el anterior
  const p = COURSES.pro;
  t.update({ x: p.start.x, z: p.start.z, y: p.start.top + 0.55 }, 60);
  assert.equal(t.running, null);
  assert.equal(t.armed, 'pro');
  ok('cambiar de curso cancela el anterior');
}

console.log('\nPruebas de cursos: ' + n + ' correctas');
