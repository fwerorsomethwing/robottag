import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { VoiceMesh, shouldInitiate, DEFAULT_ICE } from '../public/voice.js';
const { buildIce, DEFAULT_STUN } = createRequire(import.meta.url)('../ice.js');

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

// RTCPeerConnection falso: lo justo para ver que la señalización se hace bien.
let pcCount = 0;
class FakePC {
  constructor(cfg) {
    this.cfg = cfg; this.id = ++pcCount; this.connectionState = 'new';
    this.tr = []; this.ice = []; this.localDescription = null; this.remoteDescription = null; this.closed = false;
  }
  mk(dir) {
    const t = { direction: dir, sent: undefined, receiver: { track: { kind: 'audio' } } };
    t.sender = { replaceTrack: async (tk) => { t.sent = tk; } };
    this.tr.push(t);
    return t;
  }
  addTransceiver(kind, o) { assert.equal(kind, 'audio'); return this.mk(o.direction); }
  getTransceivers() { return this.tr; }
  async createOffer() { return { type: 'offer', sdp: 'offer-' + this.id }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer-' + this.id }; }
  async setLocalDescription(d) {
    this.localDescription = d;
    if (this.onicecandidate) this.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'cand-' + this.id, sdpMid: '0', sdpMLineIndex: 0 }) } });
  }
  async setRemoteDescription(d) {
    this.remoteDescription = d;
    if (d.type === 'offer') this.mk('recvonly');
    else this.connectionState = 'connected';
  }
  async addIceCandidate(c) { if (!this.remoteDescription) throw new Error('sin descripción remota'); this.ice.push(c); }
  close() { this.closed = true; this.connectionState = 'closed'; }
}

/** Una "red" con varios jugadores que se pasan los mensajes de señalización. */
function net(ids) {
  const meshes = new Map(), pcs = new Map(), log = [];
  for (const id of ids) {
    const mesh = new VoiceMesh({
      signal: (to, d) => {
        log.push({ from: id, to, d });
        const copy = JSON.parse(JSON.stringify(d));
        Promise.resolve().then(() => meshes.get(to) && meshes.get(to).handle(id, copy, now));
      },
      createPC: (cfg) => { const pc = new FakePC(cfg); (pcs.get(id) || pcs.set(id, []).get(id)).push(pc); return pc; },
    });
    meshes.set(id, mesh);
  }
  let now = 1000;
  return { meshes, pcs, log, tick: (dt = 0) => { now += dt; return now; }, get now() { return now; } };
}

// 1) Quién llama.
{
  assert.ok(shouldInitiate(1, 2) && !shouldInitiate(2, 1));
  assert.deepEqual(DEFAULT_ICE[0].urls, DEFAULT_STUN);
  ok('solo llama el de id menor (no hay llamadas cruzadas)');
}

// 2) Dos jugadores: oferta, respuesta y candidatos; una sola oferta en total.
{
  const w = net([1, 2]);
  w.meshes.get(1).setPeers(1, [2], w.now);
  w.meshes.get(2).setPeers(2, [1], w.now);
  await settle();
  const offers = w.log.filter((m) => m.d.sdp && m.d.sdp.type === 'offer');
  const answers = w.log.filter((m) => m.d.sdp && m.d.sdp.type === 'answer');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].from, 1);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].from, 2);
  const a = w.pcs.get(1)[0], b = w.pcs.get(2)[0];
  assert.equal(a.connectionState, 'connected');
  assert.ok(a.ice.length >= 1 && b.ice.length >= 1, 'los candidatos ICE llegan a los dos lados');
  assert.equal(b.tr[0].direction, 'sendrecv', 'quien responde también puede hablar');
  assert.deepEqual(a.cfg.iceServers, DEFAULT_ICE);
  ok('llamada de dos jugadores');
}

// 3) El micrófono se pone en todas las conexiones, antes o después, sin renegociar.
{
  const w = net([1, 2]);
  const track = { kind: 'audio', id: 'mic' };
  w.meshes.get(1).setTrack(track);
  w.meshes.get(1).setPeers(1, [2], w.now);
  w.meshes.get(2).setPeers(2, [1], w.now);
  await settle();
  assert.equal(w.pcs.get(1)[0].tr[0].sent, track, 'micrófono puesto antes de conectar');
  const t2 = { kind: 'audio', id: 'mic2' };
  w.meshes.get(2).setTrack(t2); // enciende el micrófono después de conectar
  await settle();
  assert.equal(w.pcs.get(2)[0].tr[0].sent, t2);
  const offersBefore = w.log.filter((m) => m.d.sdp && m.d.sdp.type === 'offer').length;
  w.meshes.get(2).setTrack(null);
  await settle();
  assert.equal(w.pcs.get(2)[0].tr[0].sent, null);
  assert.equal(w.log.filter((m) => m.d.sdp && m.d.sdp.type === 'offer').length, offersBefore, 'sin renegociar');
  ok('micrófono: se pone y se quita sin renegociar');
}

// 4) Un candidato que llega antes que la oferta se guarda y se añade después.
{
  const w = net([2]);
  const m = w.meshes.get(2);
  m.setPeers(2, [1], w.now); // 1 < 2: espera la llamada de 1
  await m.handle(1, { ice: { candidate: 'temprano', sdpMid: '0', sdpMLineIndex: 0 } }); // antes de la oferta: se guarda
  assert.equal(w.pcs.get(2), undefined);
  await m.handle(7, { ice: { candidate: 'de-un-extraño', sdpMid: '0', sdpMLineIndex: 0 } }); // 7 > 2: no nos llamará, se ignora
  assert.equal(m.early.has(7), false);
  await m.handle(1, { sdp: { type: 'offer', sdp: 'o' } });
  const pc = w.pcs.get(2)[0];
  await m.handle(1, { ice: { candidate: 'tarde', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.deepEqual(pc.ice.map((c) => c.candidate), ['temprano', 'tarde']);
  // y si el candidato llega entre medias (conexión creada, aún sin descripción remota)
  m.closeAll();
  const p = m.makePeer(1, false, 0);
  await m.handle(1, { ice: { candidate: 'en-cola', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.equal(p.pending.length, 1);
  assert.equal(p.pc.ice.length, 0);
  await m.handle(1, { sdp: { type: 'offer', sdp: 'o2' } }); // reemplaza la conexión; la cola de la vieja se descarta
  assert.equal(m.peers.get(1).pending.length, 0);
  ok('candidatos ICE: llegan antes o después de la oferta');
}

// 5) Tres jugadores: tres parejas, cada una con una sola oferta.
{
  const w = net([1, 2, 3]);
  for (const id of [1, 2, 3]) w.meshes.get(id).setPeers(id, [1, 2, 3], w.now);
  await settle();
  const offers = w.log.filter((m) => m.d.sdp && m.d.sdp.type === 'offer').map((m) => m.from + '>' + m.to).sort();
  assert.deepEqual(offers, ['1>2', '1>3', '2>3']);
  for (const id of [1, 2, 3]) {
    assert.equal(w.meshes.get(id).peers.size, 2);
    assert.ok(w.meshes.get(id).debug().every((p) => p.state === 'connected' || p.state === 'new'));
  }
  ok('tres jugadores: malla completa sin duplicados');
}

// 6) Cuando un jugador se va, se cuelga (con 3 s de margen por si aún no llegó en la lista).
{
  const w = net([1, 2]);
  const gone = [];
  w.meshes.get(1).onGone = (id) => gone.push(id);
  w.meshes.get(1).setPeers(1, [2], 1000);
  w.meshes.get(2).setPeers(2, [1], 1000);
  await settle();
  const pc = w.pcs.get(1)[0];
  w.meshes.get(1).setPeers(1, [], 2000);
  assert.equal(w.meshes.get(1).peers.size, 1, 'aún dentro del margen');
  w.meshes.get(1).setPeers(1, [], 4500);
  assert.equal(w.meshes.get(1).peers.size, 0);
  assert.ok(pc.closed);
  assert.deepEqual(gone, [2]);
  ok('se cuelga a quien sale de la sala');
}

// 7) Una conexión fallida se cierra y se reintenta pasado un rato, no en bucle.
{
  const w = net([1, 2]);
  const m = w.meshes.get(1);
  m.setPeers(1, [2], 1000);
  await settle();
  const pc = w.pcs.get(1)[0];
  pc.connectionState = 'failed';
  pc.onconnectionstatechange();
  assert.equal(m.peers.size, 0);
  m.setPeers(1, [2], 1100);
  await settle();
  assert.equal(w.pcs.get(1).length, 1, 'no reintenta enseguida');
  m.setPeers(1, [2], 1000 + 9000);
  await settle();
  assert.equal(w.pcs.get(1).length, 2, 'reintenta después');
  ok('conexión fallida: pausa y reintento');
}

// 8) Una oferta nueva reemplaza la conexión anterior; basura y mensajes propios no rompen nada.
{
  const w = net([2]);
  const m = w.meshes.get(2);
  m.setPeers(2, [1], 0);
  await m.handle(1, { sdp: { type: 'offer', sdp: 'a' } });
  const first = w.pcs.get(2)[0];
  await m.handle(1, { sdp: { type: 'offer', sdp: 'b' } });
  assert.ok(first.closed);
  assert.equal(w.pcs.get(2).length, 2);
  await m.handle(1, null);
  await m.handle(1, 'hola');
  await m.handle(1, {});
  await m.handle(2, { sdp: { type: 'offer', sdp: 'yo' } }); // de sí mismo
  await m.handle(9, { sdp: { type: 'answer', sdp: 'no pedida' } }); // respuesta sin haber llamado
  assert.equal(m.peers.size, 1);
  m.closeAll();
  assert.equal(m.peers.size, 0);
  ok('ofertas repetidas y mensajes inválidos');
}

// 9) Servidores ICE: STUN siempre; TURN solo si está bien configurado.
{
  assert.deepEqual(buildIce({}), [{ urls: DEFAULT_STUN }]);
  assert.equal(buildIce({ TURN_URL: 'turn:x.com:3478' }).length, 1, 'sin usuario y clave no se añade');
  const r = buildIce({ TURN_URL: 'turn:x.com:3478, turns:x.com:5349, http://malo', TURN_USER: 'u', TURN_PASS: 'p' });
  assert.equal(r.length, 2);
  assert.deepEqual(r[1], { urls: ['turn:x.com:3478', 'turns:x.com:5349'], username: 'u', credential: 'p' });
  ok('servidores ICE (STUN/TURN)');
}

console.log('\nPruebas de voz: ' + n + ' correctas');
