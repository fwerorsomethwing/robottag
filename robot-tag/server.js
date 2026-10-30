const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Rooms } = require('./rooms');
const { buildIce } = require('./ice');
const pkg = require('./package.json');

const PORT = process.env.PORT || 3000;
const USE_HTTPS = process.argv.includes('--https');
const PUBLIC = path.join(__dirname, 'public');
// La versión que se muestra (p. ej. 1.0.2.1) vive en public/version.js: npm solo acepta tres números en package.json.
const VERSION = (fs.readFileSync(path.join(PUBLIC, 'version.js'), 'utf8').match(/'([\d.]+)'/) || [])[1] || pkg.version;
const CERT_DIR = path.join(__dirname, 'cert');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
// three.js se sirve desde node_modules para no depender de internet (útil en LAN)
const THREE_FILE = path.join(__dirname, 'node_modules', 'three', 'build', 'three.module.js');

// Mapas válidos: se leen de public/maps.js para que servidor y cliente nunca se desincronicen.
let rooms;
const ready = import('./public/maps.js').then((m) => {
  rooms = new Rooms({
    mapIds: m.MAP_IDS,
    ownerKey: process.env.OWNER_KEY || '',
    defaultMap: m.LOBBY,
    send: (p, s) => { if (p.ws.readyState === 1) p.ws.send(s); },
  });
});

function handler(req, res) {
  let p = req.url.split('?')[0];
  if (p === '/health') {
    // Render y otros alojamientos lo usan para saber que el servidor está vivo
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, version: VERSION, ...(rooms ? rooms.stats() : { rooms: 0, players: 0 }) }));
  }
  if (p === '/') p = '/index.html';
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const file = p === '/vendor/three.module.js' ? THREE_FILE : path.join(PUBLIC, path.normalize(p));
  if (file !== THREE_FILE && !file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

// Certificado autofirmado (WebXR exige contexto seguro: HTTPS o localhost).
async function loadOrCreateCert() {
  const keyFile = path.join(CERT_DIR, 'key.pem'), certFile = path.join(CERT_DIR, 'cert.pem');
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  }
  const selfsigned = require('selfsigned');
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...lanAddresses().map((ip) => ({ type: 7, ip }))];
  const pems = await Promise.resolve(selfsigned.generate([{ name: 'commonName', value: 'robot-tag.local' }], {
    days: 365, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  }));
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

function attachSockets(srv) {
  const wss = new WebSocketServer({ server: srv, maxPayload: 12288 });
  wss.on('connection', (ws) => {
    const player = rooms.newPlayer(ws);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.send(JSON.stringify({ t: 'welcome', id: player.id, v: VERSION, ice: buildIce(process.env) }));
    rooms.join(player, undefined, ''); // entra a la Plaza; el mensaje "join" lo cambia si hace falta

    let budget = 0, windowStart = Date.now(); // máximo ~100 mensajes por segundo y jugador
    ws.on('message', (raw) => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; budget = 0; }
      if (++budget > 100) return;
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      rooms.handle(player, m);
    });
    ws.on('close', () => rooms.leave(player));
    ws.on('error', () => {});
  });
  // Los proxys de los alojamientos cortan las conexiones quietas: un ping cada 25 s las mantiene vivas
  // y se cierran las que ya no responden.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* conexión caída */ }
    }
  }, 25000);
  setInterval(() => rooms.tick(), 50);
}

(async () => {
  await ready;
  const proto = USE_HTTPS ? 'https' : 'http';
  const srv = USE_HTTPS ? https.createServer(await loadOrCreateCert(), handler) : http.createServer(handler);
  attachSockets(srv);
  srv.listen(PORT, () => {
    console.log('Robot Tag ' + VERSION + ' listo:');
    console.log('  ' + proto + '://localhost:' + PORT);
    for (const ip of lanAddresses()) console.log('  ' + proto + '://' + ip + ':' + PORT + '   (otros dispositivos de tu wifi)');
    console.log('Para jugar con gente de otras redes hay que subirlo a internet: mira "Multijugador en línea" en el README.');
    if (!USE_HTTPS) console.log('Para VR en un visor por red local usa: npm run https  (WebXR exige HTTPS o localhost)');
  });
})().catch((e) => { console.error(e); process.exit(1); });
