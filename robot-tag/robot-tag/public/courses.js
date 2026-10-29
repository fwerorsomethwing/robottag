// Cursos de obstáculos: NOOB (fácil) y PRO (difícil).
// Datos de los cursos + seguimiento del cronómetro. Sin DOM, se prueba en Node (test/courses.test.mjs).
//
// Cada plataforma es una caja (x, z = centro; sx, sz = tamaño; top = altura de la cara superior)
// o una esfera ({ sphere: true, r }). La lista va en orden: de la salida a la meta.

const box = (x, z, sx, sz, top) => ({ x, z, sx, sz, top });
const ball = (x, z, r, top) => ({ x, z, sx: r * 2, sz: r * 2, r, top, sphere: true });

export const COURSES = {
  noob: {
    id: 'noob',
    name: 'CURSO NOOB',
    color: 0x4cd964,
    reward: { first: 20, repeat: 5 },
    // plataformas grandes (3x3), saltos de 2 m y escalones de 0,4 m
    start: box(-12, 14, 4, 4, 0.05),
    path: [
      box(-17.5, 14, 3, 3, 0.4),
      box(-22.5, 14, 3, 3, 0.8),
      box(-26, 9, 3, 3, 1.2),
      box(-26, 4, 3, 3, 1.6),
      box(-26, -1, 3, 3, 2.0),
      box(-26, -6, 3, 3, 2.4),
      box(-26, -11, 3, 3, 2.8),
    ],
    finish: box(-26, -16.5, 4, 4, 3.2),
  },
  pro: {
    id: 'pro',
    name: 'CURSO PRO',
    color: 0xe0405a,
    reward: { first: 60, repeat: 15 },
    // plataformas pequeñas (1,5x1,5), vigas estrechas, una esfera y saltos de casi 3 m
    start: box(14, 14, 4, 4, 0.05),
    path: [
      box(19.8, 14, 2, 2, 0.45),
      box(24.6, 14, 2, 2, 0.85),
      box(24.6, 9.2, 2, 2, 1.25),
      box(24.6, 4, 1.2, 3, 1.65), // viga
      box(24.6, -1, 1.5, 1.5, 2.05),
      box(21.2, -4.5, 1.5, 1.5, 2.45),
      box(18.5, -7.5, 1.5, 1.5, 2.85),
      ball(14.5, -10.5, 1, 3.25), // esfera: solo se puede pisar su punta
      box(11, -14, 1.5, 1.5, 3.65),
      box(11, -18.5, 1.2, 3, 4.05), // viga
    ],
    finish: box(11, -24.5, 4, 4, 4.45),
  },
};

export const COURSE_LIST = Object.values(COURSES);

/** Todas las plataformas de un curso en orden: salida, recorrido y meta. */
export const courseSteps = (c) => [c.start, ...c.path, c.finish];

/** Zonas de salida y meta: la cabeza debe estar sobre la plataforma (hasta 2,8 m por encima). */
function inRect(p, r) {
  return Math.abs(p.x - r.x) <= r.sx / 2 && Math.abs(p.z - r.z) <= r.sz / 2 && p.y >= r.top - 0.3 && p.y <= r.top + 2.8;
}

/**
 * Cronómetro de los cursos.
 * - Estar sobre la salida deja el curso "armado"; el tiempo empieza al salir de ella.
 * - Tocar la meta con el cronómetro en marcha termina el curso.
 * - Volver a la salida reinicia.
 */
export class CourseTracker {
  constructor(courses = COURSES) {
    this.courses = courses;
    this.reset();
  }

  reset() {
    this.armed = null;
    this.running = null;
    this.t0 = 0;
  }

  /** Segundos transcurridos del curso en marcha, o null. */
  elapsed(now) {
    return this.running ? now - this.t0 : null;
  }

  /** @returns {{type: 'start'|'reset'|'finish', course: string, time?: number}[]} */
  update(head, now) {
    const events = [];
    for (const c of Object.values(this.courses)) {
      const onStart = inRect(head, c.start);
      const onFinish = inRect(head, c.finish);
      if (onStart) {
        if (this.running === c.id) events.push({ type: 'reset', course: c.id });
        this.armed = c.id;
        this.running = null;
      } else if (this.armed === c.id && this.running === null) {
        this.running = c.id;
        this.t0 = now;
        this.armed = null;
        events.push({ type: 'start', course: c.id });
      }
      if (onFinish && this.running === c.id) {
        events.push({ type: 'finish', course: c.id, time: now - this.t0 });
        this.running = null;
      }
    }
    return events;
  }
}
