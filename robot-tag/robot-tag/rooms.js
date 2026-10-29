// Salas del servidor. Cada sala = un mapa + (opcional) un código privado. Los jugadores de una sala
// solo se ven entre ellos y cada sala tiene su propio juego de LAVA.
// Sin red: recibe una función send(player, texto), así se prueba en Node (test/rooms.test.mjs).

const COLORS = [0x3da5ff, 0x45e08a, 0xffd23d, 0xc16bff, 0xff7fb0, 0x5ff0e0, 0xffffff, 0x9aa7ff];
const COS_SLOTS = ['head', 'badge'];
const COS_ID = /^[a-z0-9_]{1,20}$/;
const CODE_RE = /^[A-Z0-9]{1,8}$/;

const v3 = (a) => (Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) ? a : null);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Aplica nombre, color y cosméticos de un mensaje del cliente, validándolos. */
function applyProfile(player, m) {
  if (typeof m.name === 'string') {
    const n = m.name.replace(/[^\w \-áéíóúñÁÉÍÓÚÑ]/g, '').trim().slice(0, 14);
    if (n) player.name = n;
  }
  if (Number.isInteger(m.color) && m.color >= 0 && m.color <= 0xffffff) player.c = m.color;
  if (typeof m.voice === 'boolean') player.voice = m.voice; // ¿participa en el chat de voz?
  if (m.cos && typeof m.cos === 'object') {
    const cos = {};
    for (const slot of COS_SLOTS) if (typeof m.cos[slot] === 'string' && COS_ID.test(m.cos[slot])) cos[slot] = m.cos[slot];
    player.cos = cos;
  }
}

class Rooms {
  constructor({ mapIds, send, maxPublic = 10, maxPrivate = 16, tagDistance = 0.95, immunityMs = 3000, defaultMap = 'lobby' }) {
    this.mapIds = new Set(mapIds);
    this.send = send;
    this.maxPublic = maxPublic;
    this.maxPrivate = maxPrivate;
    this.tagDistance = tagDistance;
    this.immunityMs = immunityMs;
    this.defaultMap = defaultMap;
    this.rooms = new Map();
    this.nextId = 1;
  }

  newPlayer(ws) {
    const id = this.nextId++;
    return { id, ws, name: 'Robot' + id, c: COLORS[id % COLORS.length], cos: {}, voice: false, rtcWin: 0, rtcN: 0, p: null, yaw: 0, l: null, r: null, room: null };
  }

  /** Mete al jugador en una sala. map inválido -> mapa por defecto; código inválido -> sala pública. */
  join(player, map, code) {
    if (!this.mapIds.has(map)) map = this.defaultMap;
    code = typeof code === 'string' && CODE_RE.test(code.toUpperCase()) ? code.toUpperCase() : '';
    const cur = player.room;
    if (cur && cur.map === map && (cur.code || '') === code) return cur; // ya está ahí
    this.leave(player);

    let room = null;
    if (code) {
      room = this.rooms.get(map + '#' + code);
      if (room && room.players.size >= this.maxPrivate) { room = null; code = ''; this.send(player, JSON.stringify({ t: 'notice', text: 'Sala llena: te pusimos en una pública' })); }
      if (code && !room) room = this.make(map, code, 0);
    }
    if (!room) {
      for (let n = 1; !room; n++) {
        const r = this.rooms.get(map + '#pub' + n);
        if (!r) room = this.make(map, '', n);
        else if (r.players.size < this.maxPublic) room = r;
      }
    }
    room.players.set(player.id, player);
    player.room = room;
    player.p = null; player.l = null; player.r = null; // la posición del mapa anterior no vale aquí
    if (room.itId === null) this.pickIt(room);
    this.send(player, JSON.stringify({ t: 'room', map: room.map, code: room.code, n: room.n }));
    return room;
  }

  make(map, code, n) {
    const key = code ? map + '#' + code : map + '#pub' + n;
    const room = { key, map, code, n, players: new Map(), itId: null, cooldownUntil: 0 };
    this.rooms.set(key, room);
    return room;
  }

  leave(player) {
    const room = player.room;
    if (!room) return;
    room.players.delete(player.id);
    player.room = null;
    if (room.players.size === 0) { this.rooms.delete(room.key); return; }
    if (room.itId === player.id) this.pickIt(room);
    if (room.players.size < 2) room.itId = null;
  }

  pickIt(room) {
    const ids = [...room.players.keys()];
    if (ids.length < 2) { room.itId = null; return; }
    room.itId = ids[Math.floor(Math.random() * ids.length)];
    room.cooldownUntil = Date.now() + this.immunityMs;
  }

  /** Procesa un mensaje ya convertido a objeto. */
  handle(player, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      applyProfile(player, m);
      this.join(player, m.map, m.code);
    } else if (m.t === 'map') {
      this.join(player, m.map, m.code);
    } else if (m.t === 'profile') {
      applyProfile(player, m);
    } else if (m.t === 'rtc') {
      this.relay(player, m);
    } else if (m.t === 's') {
      const p = v3(m.p);
      if (p) player.p = p;
      if (Number.isFinite(m.yaw)) player.yaw = m.yaw;
      player.l = v3(m.l) || player.l;
      player.r = v3(m.r) || player.r;
    }
  }

  /**
   * Chat de voz: reenvía mensajes de señalización WebRTC (oferta, respuesta, candidatos ICE) entre dos jugadores
   * de la MISMA sala. El audio no pasa por aquí. Se reconstruye el mensaje campo a campo para no reenviar nada raro.
   */
  relay(player, m, now = Date.now()) {
    const room = player.room;
    if (!room || !Number.isInteger(m.to) || m.to === player.id) return;
    const target = room.players.get(m.to);
    if (!target) return;
    if (now - player.rtcWin > 10000) { player.rtcWin = now; player.rtcN = 0; }
    if (++player.rtcN > 300) return; // límite: 300 mensajes de voz cada 10 s por jugador
    const d = m.d;
    if (!d || typeof d !== 'object') return;
    let out = null;
    if (d.sdp && typeof d.sdp === 'object' && (d.sdp.type === 'offer' || d.sdp.type === 'answer')
        && typeof d.sdp.sdp === 'string' && d.sdp.sdp.length <= 6000) {
      out = { sdp: { type: d.sdp.type, sdp: d.sdp.sdp } };
    } else if (d.ice && typeof d.ice === 'object' && typeof d.ice.candidate === 'string' && d.ice.candidate.length <= 600) {
      const c = d.ice;
      out = {
        ice: {
          candidate: c.candidate,
          sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid.slice(0, 20) : null,
          sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : null,
        },
      };
    }
    if (out) this.send(target, JSON.stringify({ t: 'rtc', from: player.id, d: out }));
  }

  /** Un paso del servidor (cada 50 ms): contagio de LAVA y envío de "snap" a cada sala. */
  tick(now = Date.now()) {
    for (const room of this.rooms.values()) {
      const it = room.itId && room.players.get(room.itId);
      if (it && it.p && now > room.cooldownUntil) {
        for (const [id, p] of room.players) {
          if (id === room.itId || !p.p) continue;
          if (dist(it.p, p.p) < this.tagDistance) {
            room.itId = id;
            room.cooldownUntil = now + this.immunityMs;
            break;
          }
        }
      }
      const list = [...room.players.values()]
        .filter((p) => p.p)
        .map((p) => ({ id: p.id, name: p.name, p: p.p, yaw: p.yaw, l: p.l, r: p.r, c: p.c, cos: p.cos, v: p.voice ? 1 : 0 }));
      const msg = JSON.stringify({ t: 'snap', players: list, it: room.itId, map: room.map });
      for (const p of room.players.values()) this.send(p, msg);
    }
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.players.size;
    return { rooms: this.rooms.size, players };
  }
}

module.exports = { Rooms, applyProfile, COS_SLOTS };
