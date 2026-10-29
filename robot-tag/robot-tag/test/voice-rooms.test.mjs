import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { MAP_IDS } from '../public/maps.js';
const { Rooms } = createRequire(import.meta.url)('../rooms.js');

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);

function setup() {
  const inbox = new Map();
  const rooms = new Rooms({ mapIds: MAP_IDS, defaultMap: 'lobby', send: (p, s) => { (inbox.get(p.id) || inbox.set(p.id, []).get(p.id)).push(JSON.parse(s)); } });
  const add = (name, map, code, voice) => {
    const p = rooms.newPlayer({});
    rooms.join(p, undefined, '');
    rooms.handle(p, { t: 'join', name, color: 0xff7fb0, map, code, voice });
    return p;
  };
  const rtc = (p) => (inbox.get(p.id) || []).filter((m) => m.t === 'rtc');
  return { rooms, add, rtc, inbox };
}
const SDP = { sdp: { type: 'offer', sdp: 'v=0\r\n...' } };
const ICE = { ice: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } };

// 1) Se reenvía solo dentro de la misma sala.
{
  const { rooms, add, rtc } = setup();
  const a = add('Ana', 'forest'), b = add('Beto', 'forest'), c = add('Cris', 'cave');
  rooms.handle(a, { t: 'rtc', to: b.id, d: SDP });
  assert.deepEqual(rtc(b), [{ t: 'rtc', from: a.id, d: SDP }]);
  rooms.handle(a, { t: 'rtc', to: c.id, d: SDP }); // otra sala
  assert.equal(rtc(c).length, 0);
  rooms.handle(a, { t: 'rtc', to: a.id, d: SDP }); // a sí mismo
  assert.equal(rtc(a).length, 0);
  rooms.handle(a, { t: 'rtc', to: 9999, d: SDP }); // no existe
  rooms.handle(a, { t: 'rtc', to: 'x', d: SDP });
  rooms.handle(a, { t: 'rtc', d: SDP });
  ok('la señalización solo llega a jugadores de la misma sala');
}

// 2) El remitente lo pone el servidor (no se puede suplantar) y solo pasan campos conocidos.
{
  const { rooms, add, rtc } = setup();
  const a = add('Ana', 'forest'), b = add('Beto', 'forest');
  rooms.handle(a, { t: 'rtc', to: b.id, from: 12345, d: { ...ICE, extra: 'x'.repeat(50), ice: { ...ICE.ice, evil: { a: 1 } } } });
  assert.deepEqual(rtc(b), [{ t: 'rtc', from: a.id, d: ICE }]);
  ok('remitente real y campos filtrados');
}

// 3) Mensajes inválidos o demasiado grandes se descartan.
{
  const { rooms, add, rtc } = setup();
  const a = add('Ana', 'forest'), b = add('Beto', 'forest');
  for (const d of [null, 'x', 5, {}, { sdp: 'texto' }, { sdp: { type: 'rollback', sdp: 'x' } }, { sdp: { type: 'offer', sdp: 7 } },
    { sdp: { type: 'offer', sdp: 'x'.repeat(6001) } }, { ice: { candidate: 5 } }, { ice: { candidate: 'x'.repeat(601) } }]) {
    rooms.handle(a, { t: 'rtc', to: b.id, d });
  }
  assert.equal(rtc(b).length, 0);
  rooms.handle(a, { t: 'rtc', to: b.id, d: { ice: { candidate: 'c', sdpMid: 5, sdpMLineIndex: 'a' } } });
  assert.deepEqual(rtc(b)[0].d, { ice: { candidate: 'c', sdpMid: null, sdpMLineIndex: null } });
  ok('mensajes inválidos descartados');
}

// 4) Límite: 300 mensajes cada 10 s por jugador.
{
  const { rooms, add, rtc } = setup();
  const a = add('Ana', 'forest'), b = add('Beto', 'forest');
  for (let i = 0; i < 350; i++) rooms.relay(a, { to: b.id, d: ICE }, 5000);
  assert.equal(rtc(b).length, 300);
  rooms.relay(a, { to: b.id, d: ICE }, 5000 + 10001); // ventana nueva
  assert.equal(rtc(b).length, 301);
  ok('límite de mensajes de voz por jugador');
}

// 5) La bandera de voz viaja en el perfil y en las instantáneas; cambiar de sala no mezcla a nadie.
{
  const { rooms, add, inbox } = setup();
  const a = add('Ana', 'forest', '', true), b = add('Beto', 'forest', '', false);
  for (const p of [a, b]) rooms.handle(p, { t: 's', p: [0, 1, 0], yaw: 0 });
  rooms.tick();
  const snap = inbox.get(a.id).filter((m) => m.t === 'snap').at(-1);
  assert.equal(snap.players.find((p) => p.name === 'Ana').v, 1);
  assert.equal(snap.players.find((p) => p.name === 'Beto').v, 0);
  rooms.handle(b, { t: 'profile', voice: true });
  rooms.tick();
  assert.equal(inbox.get(a.id).filter((m) => m.t === 'snap').at(-1).players.find((p) => p.name === 'Beto').v, 1);
  rooms.handle(b, { t: 'profile', voice: 'si' }); // tipo inválido: se ignora
  assert.equal(b.voice, true);
  ok('bandera de voz en perfil e instantáneas');
}

console.log('\nPruebas de voz en el servidor: ' + n + ' correctas');
