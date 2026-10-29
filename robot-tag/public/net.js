// Utilidades de red del cliente (sin DOM, se prueban en Node: test/net.test.mjs).

/** Código de sala privada: letras y números, hasta 8, en mayúsculas. Vacío = sala pública. */
export function cleanRoomCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

const isLocalHost = (h) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|.*\.local$)/i.test(h);

/**
 * Dirección WebSocket del servidor.
 * - vacío -> el mismo servidor que sirvió la página
 * - "https://mi-juego.onrender.com", "wss://...", "mi-juego.onrender.com" -> ese servidor
 * - una página https nunca usa ws:// (el navegador lo bloquea), salvo en localhost
 * Devuelve null si el texto no es una dirección válida.
 */
export function resolveServerUrl(input, loc = { protocol: 'http:', host: 'localhost:3000' }) {
  const pageSecure = loc.protocol === 'https:';
  const same = (pageSecure ? 'wss://' : 'ws://') + loc.host;
  const text = String(input || '').trim();
  if (!text) return same;
  if (/\s/.test(text)) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : (isLocalHost(text) ? 'ws://' : 'wss://') + text);
  } catch { return null; }
  let scheme = { 'ws:': 'ws:', 'wss:': 'wss:', 'http:': 'ws:', 'https:': 'wss:' }[url.protocol];
  if (!scheme || !url.hostname) return null;
  if (scheme === 'ws:' && pageSecure && !isLocalHost(url.hostname)) scheme = 'wss:';
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return scheme + '//' + url.host + path;
}

/** Espera (ms) antes del intento n de reconexión: 0,8 s, 1,6 s, 3,2 s... hasta 8 s. */
export function backoff(n) {
  return Math.min(8000, 800 * 2 ** Math.max(0, n));
}
