// El servidor de producción de verdad, en otro proceso, contra un motor de mentira que apunta lo que
// le llega. Lo que importa es lo que NO deja pasar.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'obrador-dist-'));
fs.writeFileSync(path.join(dist, 'index.html'), '<title>web</title>');
fs.writeFileSync(path.join(dist, 'main-ABCDEFGH.js'), 'console.log(1)');
fs.writeFileSync(`${dist}-secreto.txt`, 'fuera de dist');

const seen = [];
let engine;
const servers = [];

async function start(port, env = {}) {
  const child = spawn(process.execPath, ['serve.mjs'], {
    cwd: here,
    env: { ...process.env, WEB_PORT: String(port), ENGINE_PORT: String(engine.address().port), WEB_DIST: dist, TRUST_PROXY: '0', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  servers.push(child);
  await new Promise((resolve) => { child.stdout.once('data', resolve); });
  return `http://127.0.0.1:${port}`;
}

const freePort = () => new Promise((resolve) => {
  const s = http.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

const raw = (base, target, method = 'GET') => new Promise((resolve, reject) => {
  // Sin normalizar la ruta, como la mandaría quien intenta salirse de la carpeta.
  const url = new URL(base);
  const req = http.request({ host: url.hostname, port: url.port, path: target, method }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end();
});

let base;

before(async () => {
  engine = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise((resolve) => { engine.listen(0, '127.0.0.1', resolve); });
  base = await start(await freePort());
});

after(async () => {
  for (const child of servers) child.kill();
  await new Promise((resolve) => { engine.close(resolve); });
  fs.rmSync(dist, { recursive: true, force: true });
  fs.rmSync(`${dist}-secreto.txt`, { force: true });
});

test('la API se traduce a las rutas del motor', async () => {
  seen.length = 0;
  assert.equal((await fetch(`${base}/api/pasteleria/slots?date=2026-10-17`)).status, 200);
  assert.equal(seen[0].url, '/biz/pasteleria/slots?date=2026-10-17');
  assert.equal((await fetch(`${base}/api/warm`, { method: 'POST' })).status, 200);
  assert.equal(seen[1].url, '/biz/warm');
});

test('fuera de la lista cerrada no se llega al motor', async () => {
  seen.length = 0;
  for (const [url, method] of [
    ['/api', 'GET'], ['/api/problems', 'GET'], ['/api/warm', 'GET'], ['/api/pasteleria/staff/act', 'GET'], ['/api/pasteleria/chat', 'GET'],
    ['/api/pasteleria', 'POST'], ['/api/pasteleria/slots', 'POST'], ['/api/pasteleria/otra', 'GET'], ['/api/PASTELERIA', 'GET'],
  ]) {
    assert.equal((await fetch(`${base}${url}`, { method })).status, 404, `${method} ${url}`);
  }
  assert.equal(await raw(base, '/api/../admin/ingest', 'POST'), 404);
  assert.equal(seen.length, 0);
});

test('al motor no le llegan cookies ni cabeceras del cliente', async () => {
  seen.length = 0;
  await fetch(`${base}/api/pasteleria`, { headers: { cookie: 'a=b', authorization: 'Bearer x', 'x-forwarded-for': '1.2.3.4' } });
  assert.equal(seen[0].headers.cookie, undefined);
  assert.equal(seen[0].headers.authorization, undefined);
  assert.equal(seen[0].headers['x-forwarded-for'], undefined);
});

test('un cuerpo demasiado grande se corta antes de llegar al motor', async () => {
  seen.length = 0;
  const res = await fetch(`${base}/api/pasteleria/chat`, { method: 'POST', body: 'x'.repeat(9000) });
  assert.equal(res.status, 413);
  assert.equal(seen.length, 0);
});

test('los ficheros: portada, con hash para siempre y sin salirse de la carpeta', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('cache-control'), 'no-store');
  const js = await fetch(`${base}/main-ABCDEFGH.js`);
  assert.match(js.headers.get('cache-control'), /immutable/);
  assert.equal(await raw(base, '/../serve.mjs'), 404);
  assert.equal(await raw(base, `/..%2f${path.basename(dist)}-secreto.txt`), 404);
  assert.equal(await raw(base, `/../${path.basename(dist)}-secreto.txt`), 404);
  assert.equal(await raw(base, '/%E0%A4%A'), 400);
});

test('un fichero que no existe es un 404 y una ruta de la aplicación abre la web', async () => {
  assert.equal((await fetch(`${base}/nada.js`)).status, 404);
  assert.equal((await fetch(`${base}/cualquier-ruta`)).status, 200);
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
});

test('todas las respuestas llevan las cabeceras de seguridad', async () => {
  for (const url of ['/', '/nada.js', '/api', '/api/pasteleria']) {
    const res = await fetch(`${base}${url}`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', url);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/, url);
  }
});

test('si el motor no responde, un 502 con un mensaje que se entiende', async () => {
  const lost = await start(await freePort(), { ENGINE_PORT: '9' });
  const res = await fetch(`${lost}/api/pasteleria`);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /no está disponible/);
});

test('el ritmo se limita por dirección y una cabecera inventada no se lo salta', async () => {
  const limited = await start(await freePort());
  const post = (ip) => fetch(`${limited}/api/pasteleria/chat`, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: '{}' });
  for (let i = 0; i < 40; i += 1) assert.equal((await post(`10.0.0.${i}`)).status, 200);
  const res = await post('10.9.9.9');
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '20');
});

test('detrás de un proxy de confianza, cada dirección tiene su límite', async () => {
  const proxied = await start(await freePort(), { TRUST_PROXY: '1' });
  const post = (ip) => fetch(`${proxied}/api/pasteleria/chat`, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: '{}' });
  for (let i = 0; i < 40; i += 1) assert.equal((await post('10.0.0.1')).status, 200);
  assert.equal((await post('10.0.0.1')).status, 429);
  assert.equal((await post('10.0.0.2')).status, 200);
});
