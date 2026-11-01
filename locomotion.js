// Locomoción VR estilo Gorilla Tag: el cuerpo se mueve al empujar superficies con las manos.
// Módulo independiente del DOM para poder probarlo en Node (test/locomotion.test.mjs).
import * as THREE from 'three';

const V3 = THREE.Vector3;

export const CFG = {
  HAND_R: 0.06,        // radio de la esfera de cada mano
  HEAD_R: 0.17,        // radio del colisionador de la cabeza
  TORSO_R: 0.22,       // radio del colisionador del torso
  TORSO_DROP: 0.38,    // distancia del torso bajo la cabeza
  MAX_ARM: 1.5,        // distancia máxima mano-cabeza
  SLIDE_DOWN: 0.0006,  // empujoncito hacia abajo para mantener el contacto
  CONTACT_GAP: 0.0001, // separación mínima entre la mano y la superficie
  VEL_HIST: 4,         // frames usados para promediar la velocidad de salto
  VEL_LIMIT: 0.1,      // velocidad mínima para contar como salto
  JUMP_MULT: 1.1,
  MAX_JUMP: 6.5,
  LAVA_BOOST: 1.12,    // el jugador LAVA es un poco más rápido
  MAX_SPEED: 14,
  GRAVITY: -9.8,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Rayos contra cajas y esferas ----------
export function rayBox(o, d, b, maxT) {
  let tmin = 0, tmax = maxT, nAxis = null, nSign = 0;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / (Math.abs(d[ax]) < 1e-9 ? 1e-9 : d[ax]);
    let ta = (b.min[ax] - o[ax]) * inv, tb = (b.max[ax] - o[ax]) * inv, sign = -1;
    if (ta > tb) { [ta, tb] = [tb, ta]; sign = 1; }
    if (ta > tmin) { tmin = ta; nAxis = ax; nSign = sign; }
    if (tb < tmax) tmax = tb;
    if (tmin > tmax) return null;
  }
  if (!nAxis) return null;
  const n = new V3(); n[nAxis] = nSign;
  return { t: tmin, n, p: o.clone().addScaledVector(d, tmin) };
}

export function raySphere(o, d, s, maxT) {
  const oc = o.clone().sub(s.c);
  const b = oc.dot(d), c = oc.dot(oc) - s.r * s.r, disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxT) return null;
  const p = o.clone().addScaledVector(d, t);
  return { t, n: p.clone().sub(s.c).normalize(), p };
}

export class VRLocomotion {
  /** @param {{boxes: {min: V3, max: V3}[], spheres: {c: V3, r: number}[]}} world */
  constructor(world) {
    this.world = world;
    this.vel = new V3();
    this.hist = [];
    this.hands = {
      left: this._newHand(),
      right: this._newHand(),
    };
    this.head = new V3();
  }

  _newHand() {
    return { live: false, follower: new V3(), cur: new V3(), first: new V3(), colliding: false, was: false };
  }

  /** Mundo -> local del rig (sin escala). */
  static toWorld(rig, local) {
    return local.clone().applyQuaternion(rig.quaternion).add(rig.position);
  }

  /** Barrido de una esfera de radio r desde o a lo largo de travel. Devuelve {p, n, t} o null. */
  sweepSphere(o, travel, r) {
    const len = travel.length();
    if (len < 1e-9) return null;
    const dir = travel.clone().divideScalar(len);
    let best = null;
    for (const b of this.world.boxes) {
      const eb = { min: b.min.clone().subScalar(r), max: b.max.clone().addScalar(r) };
      const h = rayBox(o, dir, eb, len);
      if (h && (!best || h.t < best.t)) best = h;
    }
    for (const s of this.world.spheres) {
      const h = raySphere(o, dir, { c: s.c, r: s.r + r }, len);
      if (h && (!best || h.t < best.t)) best = h;
    }
    return best;
  }

  /** Saca la esfera (c, r) de cualquier colisionador. Modifica c y añade las normales usadas. */
  depenetrate(c, r, normals = []) {
    for (const b of this.world.boxes) {
      const cp = new V3(clamp(c.x, b.min.x, b.max.x), clamp(c.y, b.min.y, b.max.y), clamp(c.z, b.min.z, b.max.z));
      const d = c.clone().sub(cp), dist = d.length();
      if (dist >= r) continue;
      if (dist > 1e-6) {
        const n = d.divideScalar(dist);
        c.addScaledVector(n, r - dist + CFG.CONTACT_GAP);
        normals.push(n);
      } else {
        // el centro está dentro de la caja: salir por la cara más cercana
        const faces = [
          [c.x - b.min.x, new V3(-1, 0, 0)], [b.max.x - c.x, new V3(1, 0, 0)],
          [c.y - b.min.y, new V3(0, -1, 0)], [b.max.y - c.y, new V3(0, 1, 0)],
          [c.z - b.min.z, new V3(0, 0, -1)], [b.max.z - c.z, new V3(0, 0, 1)],
        ];
        faces.sort((a, z) => a[0] - z[0]);
        const [depth, n] = faces[0];
        c.addScaledVector(n, depth + r + CFG.CONTACT_GAP);
        normals.push(n);
      }
    }
    for (const s of this.world.spheres) {
      const d = c.clone().sub(s.c), dist = d.length(), minD = r + s.r;
      if (dist >= minD) continue;
      const n = dist > 1e-6 ? d.divideScalar(dist) : new V3(0, 1, 0);
      c.addScaledVector(n, minD - dist + CFG.CONTACT_GAP);
      normals.push(n);
    }
    return normals;
  }

  /** Cabeza y torso no pueden atravesar la geometría. Devuelve true si tocó algo. */
  _resolveBody(rig, headLocal) {
    const normals = [];
    for (let i = 0; i < 2; i++) {
      let head = VRLocomotion.toWorld(rig, headLocal);
      let c = head.clone();
      this.depenetrate(c, CFG.HEAD_R, normals);
      rig.position.add(c.sub(head));
      head = VRLocomotion.toWorld(rig, headLocal);
      const torso = head.clone(); torso.y -= CFG.TORSO_DROP;
      c = torso.clone();
      this.depenetrate(c, CFG.TORSO_R, normals);
      rig.position.add(c.sub(torso));
    }
    for (const n of normals) {
      const vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -vn);
    }
    return normals.length > 0;
  }

  _clampArm(p, head) {
    const d = p.clone().sub(head);
    if (d.length() > CFG.MAX_ARM) p.copy(head).add(d.setLength(CFG.MAX_ARM));
    return p;
  }

  /** Vuelve a pegar las manos a sus controles (tras girar o teletransportar). */
  resyncHands(rig, grips) {
    for (const name of ['left', 'right']) {
      const h = this.hands[name];
      h.was = false; h.colliding = false;
      if (grips[name]) { h.follower.copy(VRLocomotion.toWorld(rig, grips[name])); h.live = true; }
    }
  }

  /** Coloca la cabeza en una posición del mundo y detiene al jugador. */
  placeHead(rig, headLocal, x, y, z) {
    const hl = headLocal.clone().applyQuaternion(rig.quaternion);
    rig.position.set(x - hl.x, y - hl.y, z - hl.z);
    this.vel.set(0, 0, 0);
    this.hist.length = 0;
  }

  /**
   * Un paso de simulación.
   * @param {number} dt segundos
   * @param {{position: V3, quaternion: THREE.Quaternion}} rig se modifica su position
   * @param {V3} headLocal posición de la cabeza en el espacio del rig
   * @param {{left: V3|null, right: V3|null}} grips posición de cada mano en el espacio del rig (null si no hay seguimiento)
   * @param {{lava?: boolean}} opts
   * @returns {{head: V3, left: V3, right: V3, contacts: string[], speed: number}}
   */
  update(dt, rig, headLocal, grips, opts = {}) {
    const L = this.hands.left, R = this.hands.right;
    const handsArr = [['left', L], ['right', R]];
    const lastRig = rig.position.clone();
    const head0 = VRLocomotion.toWorld(rig, headLocal);

    for (const [name, h] of handsArr) {
      h.first.set(0, 0, 0);
      h.colliding = false;
      if (!grips[name]) { h.live = false; continue; }
      h.cur = this._clampArm(VRLocomotion.toWorld(rig, grips[name]), head0);
      if (!h.live) { h.follower.copy(h.cur); h.was = false; h.live = true; }
    }

    // 1) cada mano que choca fija el cuerpo en su sitio
    for (const [, h] of handsArr) {
      if (!h.live) continue;
      const travel = h.cur.clone().sub(h.follower);
      travel.y -= CFG.SLIDE_DOWN;
      const hit = this.sweepSphere(h.follower, travel, CFG.HAND_R);
      if (hit) {
        h.colliding = true;
        h.first.copy(h.was ? h.follower : hit.p).sub(h.cur);
      }
    }
    const lT = L.colliding || L.was, rT = R.colliding || R.was;
    const move = new V3();
    if (lT && rT) move.copy(L.first).add(R.first).multiplyScalar(0.5);
    else move.copy(L.first).add(R.first);

    const anyHit = L.colliding || R.colliding;
    if (anyHit) this.vel.set(0, 0, 0);

    if (move.lengthSq() > 1e-12) {
      const hh = this.sweepSphere(head0, move, CFG.HEAD_R);
      if (hh) move.copy(hh.p).sub(head0);
    }
    rig.position.add(move);

    // 2) vuelo libre
    if (!anyHit) {
      this.vel.y += CFG.GRAVITY * dt;
      if (this.vel.length() > CFG.MAX_SPEED) this.vel.setLength(CFG.MAX_SPEED);
      rig.position.addScaledVector(this.vel, dt);
    }
    this._resolveBody(rig, headLocal);

    // 3) posición final de las manos visibles
    const head1 = VRLocomotion.toWorld(rig, headLocal);
    for (const [name, h] of handsArr) {
      if (!h.live) continue;
      const cur2 = this._clampArm(VRLocomotion.toWorld(rig, grips[name]), head1);
      const hit2 = this.sweepSphere(h.follower, cur2.clone().sub(h.follower), CFG.HAND_R);
      if (hit2) {
        h.follower.copy(hit2.p).addScaledVector(hit2.n, CFG.CONTACT_GAP);
        h.colliding = true;
      } else {
        h.follower.copy(cur2);
        this.depenetrate(h.follower, CFG.HAND_R);
      }
    }

    // 4) velocidad de salto: promedio de los últimos frames mientras hay contacto
    this.hist.push(rig.position.clone().sub(lastRig).divideScalar(dt));
    if (this.hist.length > CFG.VEL_HIST) this.hist.shift();
    if (L.colliding || R.colliding) {
      const avg = new V3();
      for (const v of this.hist) avg.add(v);
      avg.divideScalar(this.hist.length);
      const sp = avg.length();
      if (sp > CFG.VEL_LIMIT) {
        const boost = opts.lava ? CFG.LAVA_BOOST : 1;
        const jm = CFG.JUMP_MULT * boost, mj = CFG.MAX_JUMP * boost;
        if (sp * jm > mj) this.vel.copy(avg).setLength(mj);
        else this.vel.copy(avg).multiplyScalar(jm);
      }
    }

    const contacts = [];
    for (const [name, h] of handsArr) {
      if (h.colliding && !h.was) contacts.push(name);
      h.was = h.colliding;
    }
    this.head.copy(head1);
    return { head: head1, left: L.follower, right: R.follower, contacts, speed: this.vel.length() };
  }
}
