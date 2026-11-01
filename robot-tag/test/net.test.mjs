import assert from 'node:assert/strict';
import { resolveServerUrl, cleanRoomCode, backoff } from '../public/net.js';
import { VERSION } from '../public/version.js';
import { readFileSync } from 'node:fs';

let n = 0;
const ok = (name) => console.log('  ok', ++n, name);
const http = { protocol: 'http:', host: 'localhost:3000' };
const https = { protocol: 'https:', host: 'robot-tag.onrender.com' };

{
  assert.equal(resolveServerUrl('', http), 'ws://localhost:3000');
  assert.equal(resolveServerUrl('   ', https), 'wss://robot-tag.onrender.com');
  assert.equal(resolveServerUrl('https://mi-juego.onrender.com', http), 'wss://mi-juego.onrender.com');
  assert.equal(resolveServerUrl('https://mi-juego.onrender.com/', http), 'wss://mi-juego.onrender.com');
  assert.equal(resolveServerUrl('mi-juego.onrender.com', http), 'wss://mi-juego.onrender.com');
  assert.equal(resolveServerUrl('wss://x.com:8443', http), 'wss://x.com:8443');
  assert.equal(resolveServerUrl('http://192.168.1.20:3000', http), 'ws://192.168.1.20:3000');
  assert.equal(resolveServerUrl('192.168.1.20:3000', http), 'ws://192.168.1.20:3000');
  assert.equal(resolveServerUrl('localhost:3000', http), 'ws://localhost:3000');
  ok('direcciones de servidor: vacío, https, bare, LAN');
}
{
  // una página https no puede abrir ws:// (contenido mixto), salvo en localhost
  assert.equal(resolveServerUrl('ws://otro.com', https), 'wss://otro.com');
  assert.equal(resolveServerUrl('http://otro.com', https), 'wss://otro.com');
  assert.equal(resolveServerUrl('ws://localhost:3000', https), 'ws://localhost:3000');
  assert.equal(resolveServerUrl('hola mundo', http), null);
  assert.equal(resolveServerUrl('ftp://x', http), null);
  assert.equal(resolveServerUrl('https://', http), null);
  ok('https nunca usa ws://, y lo inválido da null');
}
{
  assert.equal(cleanRoomCode('abc-123 xyz!'), 'ABC123XY');
  assert.equal(cleanRoomCode(''), '');
  assert.equal(cleanRoomCode(null), '');
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(backoff), [800, 1600, 3200, 6400, 8000, 8000]);
  ok('código de sala y espera de reconexión');
}
{
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  // npm solo admite tres números (1.0.2); el parche 1.0.2.1 se muestra desde version.js.
  assert.ok(VERSION.startsWith(pkg.version), 'version.js debe empezar por la versión de package.json');
  assert.equal(VERSION, '1.0.3');
  ok('versión 1.0.3 en version.js y package.json');
}
console.log('\nPruebas de red: ' + n + ' correctas');
