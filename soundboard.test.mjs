import assert from 'node:assert/strict';
import { Soundboard, SLOT_COUNT, MAX_BYTES, MAX_PLAYING, cleanName } from '../public/soundboard.js';
import { Computer } from '../public/computer.js';
import { Profile } from '../public/cosmetics.js';
import { COURSES } from '../public/courses.js';

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);
const buf = (len) => new Uint8Array(len).fill(7).buffer;

// 1) Nombres de archivo limpios y cortos.
{
  assert.equal(cleanName('mi_sonido-genial.mp3'), 'mi sonido genia'.slice(0, 14));
  assert.equal(cleanName('../../etc/passwd.wav'), 'etcpasswd');
  assert.equal(cleanName('<script>.ogg'), 'script');
  assert.equal(cleanName('.mp3'), 'mp3'.length ? cleanName('.mp3') : 'sonido');
  assert.equal(cleanName(''), 'sonido');
  assert.ok(cleanName('a'.repeat(80)).length <= 14);
  ok('nombres de archivo limpios');
}

// 2) Guardar, listar y borrar (sin IndexedDB: en memoria).
{
  const sb = new Soundboard({ idb: null });
  await sb.load();
  assert.deepEqual(sb.names(), Array(SLOT_COUNT).fill(null));
  let changes = 0; sb.onChange = () => changes++;
  assert.deepEqual(await sb.set(0, 'risa.mp3', buf(100)), { ok: true, name: 'risa' });
  assert.deepEqual(await sb.set(7, 'bocina.wav', buf(10)), { ok: true, name: 'bocina' });
  assert.equal(sb.count, 2);
  assert.equal(sb.names()[0], 'risa');
  assert.equal(await sb.clear(0), true);
  assert.equal(sb.names()[0], null);
  assert.equal(changes, 3);
  ok('guardar, listar y borrar sonidos');
}

// 3) Validación: espacio, tipo, vacío y tamaño máximo.
{
  const sb = new Soundboard({ idb: null });
  assert.equal((await sb.set(-1, 'a.mp3', buf(5))).reason, 'slot');
  assert.equal((await sb.set(8, 'a.mp3', buf(5))).reason, 'slot');
  assert.equal((await sb.set(1.5, 'a.mp3', buf(5))).reason, 'slot');
  assert.equal((await sb.set(0, 'a.mp3', 'texto')).reason, 'type');
  assert.equal((await sb.set(0, 'a.mp3', buf(0))).reason, 'empty');
  assert.equal((await sb.set(0, 'a.mp3', buf(MAX_BYTES + 1))).reason, 'size');
  assert.equal((await sb.set(0, 'a.mp3', buf(MAX_BYTES))).ok, true);
  assert.equal(await sb.clear(99), false);
  ok('validación de espacios, tipos y tamaño');
}

// 4) Reproducir: espacio vacío, sin audio y mezcla con la voz.
{
  const sb = new Soundboard({ idb: null });
  await sb.set(0, 'a.mp3', buf(20));
  assert.equal((await sb.play(3, null)).reason, 'empty');
  assert.equal((await sb.play(0, null)).reason, 'audio'); // en Node no hay AudioContext
  const started = [];
  const fakeBuf = { duration: 1 };
  const ctx = { decodeAudioData: async () => fakeBuf, state: 'running' };
  const voice = { ctx, mix: {}, playBuffer: (b) => { const s = { b, onended: null, stop() { this.onended && this.onended(); } }; started.push(s); return s; } };
  const r = await sb.play(0, voice);
  assert.deepEqual(r, { ok: true, shared: true });
  assert.equal(started.length, 1);
  assert.equal(started[0].b, fakeBuf);
  // el audio decodificado se reutiliza
  let decodes = 0; ctx.decodeAudioData = async () => { decodes++; return fakeBuf; };
  await sb.play(0, voice); assert.equal(decodes, 0);
  // límite de sonidos a la vez
  while (sb.playing.size < MAX_PLAYING) await sb.play(0, voice);
  assert.equal((await sb.play(0, voice)).reason, 'busy');
  sb.stopAll(); assert.equal(sb.playing.size, 0);
  // sin mezcla de voz el sonido no se comparte
  const solo = { ctx, mix: null, playBuffer: voice.playBuffer };
  assert.equal((await sb.play(0, solo)).shared, false);
  ok('reproducción: vacío, caché, límite y mezcla con la voz');
}

// 5) La computadora muestra los sonidos y los dispara.
{
  const sb = new Soundboard({ idb: null });
  await sb.set(2, 'aplauso.mp3', buf(9));
  const played = [], said = [];
  const mem = new Map();
  const computer = new Computer({
    profile: new Profile({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) }),
    courses: COURSES, soundboard: sb,
    actions: { teleport() {}, changed() {}, sound: (i) => played.push(i) },
  });
  computer.say = (t) => said.push(t);
  computer.press('go-sounds');
  assert.equal(computer.page, 'sounds');
  assert.equal(computer.buttons.filter((b) => b.id.startsWith('snd-')).length, 8);
  assert.ok(computer.buttons.find((b) => b.id === 'snd-2').label.includes('aplauso'));
  computer.press('snd-2'); assert.deepEqual(played, [2]);
  computer.press('snd-0'); assert.deepEqual(played, [2], 'un espacio vacío no suena');
  assert.ok(said.length >= 1);
  ok('computadora: página SONIDOS');
}

console.log('\nPruebas de soundboard: ' + n + ' correctas');
