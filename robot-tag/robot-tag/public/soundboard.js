// Soundboard personalizado (1.0.2.8): hasta 8 sonidos propios que el jugador sube desde su dispositivo.
// Se guardan solo en ese navegador (IndexedDB); nunca se suben al servidor. Al sonar, se mezclan con el
// micrófono del chat de voz para que los demás jugadores los oigan (ver Voice.playBuffer en voice.js).
// La lógica de guardado se prueba en Node (test/soundboard.test.mjs); decodificar y sonar requieren el navegador.
export const SLOT_COUNT = 8;
export const MAX_BYTES = 3 * 1024 * 1024; // 3 MB por sonido
export const MAX_SECONDS = 20;
export const MAX_PLAYING = 4; // sonidos a la vez (evita saturar el audio)
export const NAME_LEN = 14;

const DB_NAME = 'robottag-sounds', STORE = 'slots';

/** Nombre corto y legible a partir del nombre del archivo. */
export function cleanName(file) {
  const base = String(file || 'sonido').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_\-]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  return (base || 'sonido').slice(0, NAME_LEN);
}

function openDb(idb) {
  return new Promise((resolve) => {
    if (!idb) return resolve(null);
    try {
      const rq = idb.open(DB_NAME, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class Soundboard {
  /** @param idb un IDBFactory (o null: los sonidos duran solo mientras la página esté abierta) */
  constructor({ idb = typeof indexedDB !== 'undefined' ? indexedDB : null } = {}) {
    this.idb = idb;
    this.db = null;
    this.slots = Array(SLOT_COUNT).fill(null); // { name, data: ArrayBuffer }
    this.cache = { ctx: null, buffers: new Map() };
    this.playing = new Set();
    this.onChange = () => {};
    this.ownCtx = null;
  }

  async load() {
    this.db = await openDb(this.idb);
    if (this.db) {
      try {
        const tx = this.db.transaction(STORE, 'readonly');
        const st = tx.objectStore(STORE);
        for (let i = 0; i < SLOT_COUNT; i++) {
          const v = await req(st.get(i));
          if (v && v.data && typeof v.name === 'string') this.slots[i] = { name: cleanName(v.name), data: v.data };
        }
      } catch { /* sin almacenamiento: se sigue en memoria */ }
    }
    this.onChange();
  }

  /** Nombres de los 8 espacios (null = vacío). */
  names() { return this.slots.map((s) => (s ? s.name : null)); }
  get count() { return this.slots.filter(Boolean).length; }

  /** Guarda un sonido en un espacio. Devuelve { ok } o { ok:false, reason: 'slot'|'type'|'size'|'empty' }. */
  async set(i, fileName, data) {
    if (!Number.isInteger(i) || i < 0 || i >= SLOT_COUNT) return { ok: false, reason: 'slot' };
    if (!(data instanceof ArrayBuffer)) return { ok: false, reason: 'type' };
    if (data.byteLength === 0) return { ok: false, reason: 'empty' };
    if (data.byteLength > MAX_BYTES) return { ok: false, reason: 'size' };
    const slot = { name: cleanName(fileName), data };
    this.slots[i] = slot;
    this.cache.buffers.delete(i);
    await this._persist(i, slot);
    this.onChange();
    return { ok: true, name: slot.name };
  }

  async clear(i) {
    if (!Number.isInteger(i) || i < 0 || i >= SLOT_COUNT) return false;
    this.slots[i] = null;
    this.cache.buffers.delete(i);
    await this._persist(i, null);
    this.onChange();
    return true;
  }

  async _persist(i, slot) {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(STORE, 'readwrite');
      if (slot) tx.objectStore(STORE).put(slot, i); else tx.objectStore(STORE).delete(i);
    } catch { /* se queda solo en memoria */ }
  }

  /** Contexto de audio: el del chat de voz si existe; si no, uno propio (el sonido se oye solo en local). */
  _ctx(voice) {
    if (voice && voice.ctx) return voice.ctx;
    if (!this.ownCtx) {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return null;
      this.ownCtx = new AC();
    }
    if (this.ownCtx.state === 'suspended') this.ownCtx.resume().catch(() => {});
    return this.ownCtx;
  }

  async _buffer(i, ctx) {
    if (this.cache.ctx !== ctx) this.cache = { ctx, buffers: new Map() };
    if (this.cache.buffers.has(i)) return this.cache.buffers.get(i);
    const slot = this.slots[i];
    if (!slot) return null;
    const buf = await ctx.decodeAudioData(slot.data.slice(0)); // slice: decodeAudioData consume el buffer
    this.cache.buffers.set(i, buf);
    return buf;
  }

  /** ¿El archivo se puede decodificar y dura poco? Se usa antes de guardarlo. */
  async check(data) {
    const ctx = this._ctx(null);
    if (!ctx) return { ok: false, reason: 'audio' };
    try {
      const b = await ctx.decodeAudioData(data.slice(0));
      if (b.duration > MAX_SECONDS) return { ok: false, reason: 'long', seconds: b.duration };
      return { ok: true, seconds: b.duration };
    } catch { return { ok: false, reason: 'decode' }; }
  }

  /** Reproduce un espacio. Si hay chat de voz con micrófono, los demás también lo oyen. */
  async play(i, voice) {
    if (!this.slots[i]) return { ok: false, reason: 'empty' };
    const ctx = this._ctx(voice);
    if (!ctx) return { ok: false, reason: 'audio' };
    if (this.playing.size >= MAX_PLAYING) return { ok: false, reason: 'busy' };
    let buf;
    try { buf = await this._buffer(i, ctx); } catch { return { ok: false, reason: 'decode' }; }
    if (!buf) return { ok: false, reason: 'empty' };
    const src = voice && voice.ctx === ctx ? voice.playBuffer(buf) : this._local(ctx, buf);
    if (!src) return { ok: false, reason: 'audio' };
    this.playing.add(src);
    src.onended = () => this.playing.delete(src);
    return { ok: true, shared: !!(voice && voice.ctx === ctx && voice.mix) };
  }

  _local(ctx, buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.9;
    src.connect(g); g.connect(ctx.destination);
    src.start();
    return src;
  }

  stopAll() {
    for (const s of this.playing) { try { s.stop(); } catch { /* ya terminó */ } }
    this.playing.clear();
  }
}
