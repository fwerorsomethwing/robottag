// Servidores ICE para el chat de voz, que el servidor manda a los clientes al conectar.
// STUN (gratis, de Google) basta para la mayoría de redes. Algunas (datos móviles, wifis de empresa)
// necesitan además un servidor TURN que retransmita el audio: se configura con variables de entorno:
//   TURN_URL   direcciones separadas por comas, p. ej. turn:turn.ejemplo.com:3478,turns:turn.ejemplo.com:5349
//   TURN_USER  usuario
//   TURN_PASS  contraseña
const DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

function buildIce(env = {}) {
  const list = [{ urls: DEFAULT_STUN }];
  const urls = String(env.TURN_URL || '').split(',').map((s) => s.trim()).filter((s) => /^turns?:[^\s]+$/i.test(s));
  if (urls.length && env.TURN_USER && env.TURN_PASS) {
    list.push({ urls, username: String(env.TURN_USER), credential: String(env.TURN_PASS) });
  }
  return list;
}

module.exports = { buildIce, DEFAULT_STUN };
