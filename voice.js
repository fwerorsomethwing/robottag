// Chat de voz con proximidad (1.0.2.1).
// WebRTC punto a punto entre los jugadores de una misma sala; el servidor solo reenvía los mensajes
// de señalización (ver "rtc" en rooms.js) y nunca ve el audio. Cada voz suena en 3D desde el robot que habla.
//
// VoiceMesh: la malla de conexiones. Sin DOM ni audio, se prueba en Node con un RTCPeerConnection falso
//            (test/voice.test.mjs).
// Voice:     micrófono, volumen por distancia, "quién habla" y silenciar. Solo navegador.

export const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/** De cada pareja de jugadores solo uno llama (el de id menor), así nunca se cruzan dos llamadas. */
export const shouldInitiate = (myId, peerId) => myId < peerId;

const RETRY_MS = 8000; // tras un fallo, no se reintenta con ese jugador hasta pasado este tiempo
const GONE_MS = 3000;  // un jugador que desaparece de la lista tanto tiempo se desconecta

export class VoiceMesh {
  /**
   * @param signal    (para, datos) => void   manda un mensaje de señalización al jugador `para`
   * @param createPC  (config) => RTCPeerConnection
   * @param onTrack   (id, evento) => void    llegó audio de ese jugador
   * @param onGone    (id) => void            se cerró la conexión con ese jugador
   */
  constructor({ signal, createPC, onTrack, onGone, ice = DEFAULT_ICE }) {
    this.signal = signal;
    this.createPC = createPC;
    this.onTrack = onTrack || (() => {});
    this.onGone = onGone || (() => {});
    this.ice = ice;
    this.myId = null;
    this.track = null;      // pista del micrófono (o null)
    this.peers = new Map(); // id -> { pc, initiator, tr, pending, remote, seen }
    this.cool = new Map();  // id -> hasta cuándo no reintentar
    this.clock = Date.now(); // última hora conocida (para los cierres que no traen hora propia)
    this.early = new Map(); // id -> candidatos ICE que llegaron antes que la oferta de ese jugador
  }

  setIce(ice) {
    if (Array.isArray(ice) && ice.length) this.ice = ice;
  }

  /** Pone o cambia la pista del micrófono en todas las conexiones, sin renegociar (replaceTrack). */
  setTrack(track) {
    this.track = track || null;
    for (const p of this.peers.values()) this.attachTrack(p);
  }

  attachTrack(p) {
    const sender = p.tr && p.tr.sender;
    if (sender && sender.replaceTrack) Promise.resolve(sender.replaceTrack(this.track)).catch(() => {});
  }

  makePeer(id, initiator, now) {
    const pc = this.createPC({ iceServers: this.ice });
    const p = { id, pc, initiator, tr: null, pending: [], remote: false, seen: now };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const c = typeof e.candidate.toJSON === 'function' ? e.candidate.toJSON() : e.candidate;
      this.signal(id, { ice: c });
    };
    pc.ontrack = (e) => this.onTrack(id, e);
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== p) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(id, true);
    };
    this.peers.set(id, p);
    return p;
  }

  drop(id, cooldown, now = this.clock) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    try { p.pc.close(); } catch { /* ya cerrada */ }
    if (cooldown) this.cool.set(id, now + RETRY_MS);
    this.onGone(id);
  }

  async connect(id, now) {
    const p = this.makePeer(id, true, now);
    try {
      // Siempre hay una pista de audio de ida y vuelta: encender el micrófono más tarde no necesita renegociar.
      p.tr = p.pc.addTransceiver('audio', { direction: 'sendrecv' });
      this.attachTrack(p);
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      this.signal(id, { sdp: { type: 'offer', sdp: p.pc.localDescription.sdp } });
    } catch {
      this.drop(id, true, now);
    }
  }

  /**
   * Llamar cada vez que cambia la lista de jugadores con voz de la sala.
   * Llama a los de id mayor, espera la llamada de los de id menor y cuelga a los que ya no están.
   */
  setPeers(myId, ids, now = Date.now()) {
    if (myId === null || myId === undefined) return;
    this.myId = myId;
    this.clock = now;
    const want = new Set(ids);
    for (const id of want) {
      const p = this.peers.get(id);
      if (p) { p.seen = now; continue; }
      if (id === myId || !shouldInitiate(myId, id)) continue;
      if ((this.cool.get(id) || 0) > now) continue;
      this.connect(id, now);
    }
    for (const [id, p] of [...this.peers]) {
      if (!want.has(id) && now - p.seen > GONE_MS) this.drop(id, false, now);
    }
  }

  async flush(p) {
    const list = p.pending.splice(0);
    for (const c of list) await p.pc.addIceCandidate(c);
  }

  /** Mensaje de señalización recibido de otro jugador. */
  async handle(from, d, now = Date.now()) {
    if (!d || typeof d !== 'object' || from === this.myId) return;
    this.clock = now;
    try {
      if (d.sdp && d.sdp.type === 'offer') {
        this.drop(from, false, now); // una oferta nueva reemplaza cualquier conexión anterior
        const p = this.makePeer(from, false, now);
        p.pending.push(...(this.early.get(from) || []));
        this.early.delete(from);
        await p.pc.setRemoteDescription(d.sdp);
        p.remote = true;
        const trs = p.pc.getTransceivers();
        p.tr = trs.find((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') || trs[0] || null;
        if (p.tr) { p.tr.direction = 'sendrecv'; this.attachTrack(p); }
        await this.flush(p);
        const answer = await p.pc.createAnswer();
        await p.pc.setLocalDescription(answer);
        this.signal(from, { sdp: { type: 'answer', sdp: p.pc.localDescription.sdp } });
      } else if (d.sdp && d.sdp.type === 'answer') {
        const p = this.peers.get(from);
        if (!p || !p.initiator || p.remote) return;
        await p.pc.setRemoteDescription(d.sdp);
        p.remote = true;
        await this.flush(p);
      } else if (d.ice) {
        const p = this.peers.get(from);
        if (!p) {
          // Los candidatos pueden adelantarse a la oferta: se guardan si ese jugador es quien nos va a llamar.
          if (this.myId !== null && shouldInitiate(from, this.myId)) {
            const list = this.early.get(from) || [];
            if (list.length < 40) { list.push(d.ice); this.early.set(from, list); }
          }
          return;
        }
        if (p.remote) await p.pc.addIceCandidate(d.ice);
        else p.pending.push(d.ice); // llegó antes que la oferta/respuesta: se guarda
      }
    } catch {
      this.drop(from, true, now);
    }
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.drop(id, false);
    this.cool.clear();
    this.early.clear();
  }

  debug() {
    return [...this.peers].map(([id, p]) => ({ id, state: p.pc.connectionState }));
  }
}

// ---------------------------------------------------------------------------------------------
// Parte de navegador
// ---------------------------------------------------------------------------------------------

const SPEAK_RMS = 0.02;  // volumen a partir del cual se considera que alguien habla
const SPEAK_HOLD = 400;  // ms que se mantiene el aviso tras dejar de hablar

function setPos(node, x, y, z) {
  if (node.positionX) { node.positionX.value = x; node.positionY.value = y; node.positionZ.value = z; }
  else node.setPosition(x, y, z);
}

function rms(an, buf) {
  an.getByteTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / buf.length);
}

export class Voice {
  /** @param send (para, datos) => void  manda señalización por el WebSocket del juego */
  constructor({ send }) {
    // off · asking (pidiendo permiso) · on (micrófono activo) · listen (solo escucha) · unsupported
    this.state = 'off';
    this.error = '';
    this.muted = false;
    this.ctx = null;
    this.stream = null;
    this.mix = null; // mezcla (micrófono + soundboard) que se manda a los demás
    this.remote = new Map(); // id -> { el, src, panner, an, buf, until }
    this.speaking = new Set();
    this.me = { an: null, buf: null, until: 0, speaking: false };
    this.lastCheck = 0;
    this.lastResume = 0;
    this.mesh = new VoiceMesh({
      signal: send,
      createPC: (cfg) => new RTCPeerConnection(cfg),
      onTrack: (id, e) => this.addRemote(id, e),
      onGone: (id) => this.removeRemote(id),
    });
  }

  /** ¿Participa en el chat de voz? (se avisa a los demás para que nos llamen) */
  get active() { return this.state === 'on' || this.state === 'listen'; }

  /** Debe llamarse desde un clic o toque: los navegadores solo permiten audio y micrófono así. */
  async enable() {
    if (this.active || this.state === 'asking') return this.state;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC || typeof RTCPeerConnection === 'undefined') { this.state = 'unsupported'; return this.state; }
    this.state = 'asking';
    try {
      this.ctx = new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {
      this.state = 'unsupported';
      return this.state;
    }
    let stream = null;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch (e) {
        this.error = (e && e.name) || 'error'; // NotAllowedError = permiso denegado, NotFoundError = sin micrófono
      }
    } else {
      this.error = 'NoMediaDevices'; // páginas sin HTTPS no tienen micrófono
    }
    // Lo que oyen los demás sale de una mezcla: micrófono + sonidos del soundboard.
    try {
      if (this.ctx.createMediaStreamDestination) {
        this.mix = this.ctx.createMediaStreamDestination();
        this.mesh.setTrack(this.mix.stream.getAudioTracks()[0]);
      }
    } catch { this.mix = null; }
    if (stream) {
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      track.enabled = !this.muted;
      if (!this.mix) this.mesh.setTrack(track);
      const src = this.ctx.createMediaStreamSource(stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 256;
      if (this.mix) src.connect(this.mix);
      src.connect(an); // para medir; el micrófono no se conecta a los altavoces (eco)
      this.me.an = an; this.me.buf = new Uint8Array(an.fftSize);
      this.state = 'on';
    } else {
      this.state = 'listen'; // sin micrófono se puede escuchar igualmente
    }
    return this.state;
  }

  disable() {
    this.mesh.closeAll();
    this.mesh.setTrack(null);
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null; this.mix = null;
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.remote.clear(); this.speaking.clear();
    this.me = { an: null, buf: null, until: 0, speaking: false };
    this.state = 'off';
  }

  /** Suena un AudioBuffer: lo oyes tú y, si hay mezcla de voz, también los demás. Devuelve la fuente (o null). */
  playBuffer(buf) {
    if (!this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    if (this.mix) src.connect(this.mix);
    const g = this.ctx.createGain(); g.gain.value = 0.9;
    src.connect(g); g.connect(this.ctx.destination);
    src.start();
    return src;
  }

  setIce(ice) { this.mesh.setIce(ice); }
  sync(myId, ids) { if (this.active) this.mesh.setPeers(myId, ids, Date.now()); }
  signal(from, d) { if (this.active) this.mesh.handle(from, d); }
  closeAll() { this.mesh.closeAll(); }

  setMuted(m) {
    this.muted = !!m;
    const t = this.stream && this.stream.getAudioTracks()[0];
    if (t) t.enabled = !this.muted;
  }

  /** Silencia o activa el micrófono. Devuelve el nuevo estado de "silenciado", o null si no hay micrófono. */
  toggleMute() {
    if (this.state !== 'on') return null;
    this.setMuted(!this.muted);
    return this.muted;
  }

  addRemote(id, e) {
    if (!this.ctx) return;
    this.removeRemote(id);
    const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
    // Chrome solo entrega el audio de WebRTC a Web Audio si la secuencia también está en un <audio> (silenciado).
    const el = new Audio();
    el.srcObject = stream; el.muted = true;
    const pl = el.play && el.play();
    if (pl && pl.catch) pl.catch(() => {});
    const src = this.ctx.createMediaStreamSource(stream);
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.refDistance = 1.5; panner.maxDistance = 35; panner.rolloffFactor = 1; // se oye hasta ~35 m, cada vez más bajo
    const an = this.ctx.createAnalyser();
    an.fftSize = 256;
    src.connect(panner); panner.connect(this.ctx.destination);
    src.connect(an);
    this.remote.set(id, { el, src, panner, an, buf: new Uint8Array(an.fftSize), until: 0 });
  }

  removeRemote(id) {
    const r = this.remote.get(id);
    if (!r) return;
    try { r.src.disconnect(); r.panner.disconnect(); } catch { /* ya desconectado */ }
    r.el.srcObject = null;
    this.remote.delete(id);
    this.speaking.delete(id);
  }

  /**
   * Cada fotograma. listener = { x,y,z, fx,fy,fz (hacia dónde mira), ux,uy,uz (arriba) }; heads = Map id -> {x,y,z}.
   */
  update(now, listener, heads) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended' && now - this.lastResume > 1000) { this.lastResume = now; ctx.resume().catch(() => {}); }
    const L = ctx.listener, q = listener;
    if (L.positionX) {
      L.positionX.value = q.x; L.positionY.value = q.y; L.positionZ.value = q.z;
      L.forwardX.value = q.fx; L.forwardY.value = q.fy; L.forwardZ.value = q.fz;
      L.upX.value = q.ux; L.upY.value = q.uy; L.upZ.value = q.uz;
    } else {
      L.setPosition(q.x, q.y, q.z);
      L.setOrientation(q.fx, q.fy, q.fz, q.ux, q.uy, q.uz);
    }
    for (const [id, r] of this.remote) {
      const h = heads.get(id);
      if (h) setPos(r.panner, h.x, h.y, h.z);
    }
    if (now - this.lastCheck < 100) return;
    this.lastCheck = now;
    for (const [id, r] of this.remote) {
      if (rms(r.an, r.buf) > SPEAK_RMS) r.until = now + SPEAK_HOLD;
      if (r.until > now) this.speaking.add(id); else this.speaking.delete(id);
    }
    if (this.me.an) {
      if (!this.muted && rms(this.me.an, this.me.buf) > SPEAK_RMS) this.me.until = now + SPEAK_HOLD;
      this.me.speaking = this.me.until > now;
    }
  }

  /** Texto para el HUD. */
  statusText() {
    switch (this.state) {
      case 'asking': return 'Micrófono: esperando permiso…';
      case 'on': return this.muted ? 'Micrófono SILENCIADO (tecla M)' : 'Micrófono activo (M = silenciar)';
      case 'listen':
        return this.error === 'NotAllowedError' ? 'Solo escuchas: permiso de micrófono denegado'
          : this.error === 'NotFoundError' ? 'Solo escuchas: no se encontró micrófono'
          : this.error === 'NoMediaDevices' ? 'Solo escuchas: el micrófono necesita HTTPS'
          : 'Solo escuchas: micrófono no disponible';
      case 'unsupported': return 'Voz no disponible en este navegador';
      default: return '';
    }
  }

  debug() {
    return { state: this.state, error: this.error, muted: this.muted, peers: this.mesh.debug(), speaking: [...this.speaking], me: this.me.speaking };
  }
}
