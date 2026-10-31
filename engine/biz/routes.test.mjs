import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { pool } from '../db.mjs';
import { handleBiz } from './routes.mjs';

process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9'; // calentar el modelo no tiene que tocar uno de verdad

const SESSION = 'a'.repeat(32);
let server;
let base;

before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (code, payload) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (!(await handleBiz({ req, url, path: url.pathname, send }))) send(404, { error: 'no es de negocios' });
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => { server.close(resolve); });
  await pool.end();
});

const get = (path) => fetch(`${base}${path}`);
const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('lista y perfil público', async () => {
  const list = await (await get('/biz')).json();
  assert.equal(list[0].slug, 'pasteleria');
  const profile = await (await get('/biz/pasteleria')).json();
  assert.equal(profile.name, 'Obrador Mel');
});

test('un negocio desconocido es un 404', async () => {
  assert.equal((await get('/biz/nope')).status, 404);
  assert.equal((await post('/biz/nope/chat', { session: SESSION, text: 'hola' })).status, 404);
});

test('una ruta que no es de negocios sigue su camino', async () => {
  const res = await get('/otra');
  assert.equal((await res.json()).error, 'no es de negocios');
});

test('huecos: fecha obligatoria y bien escrita', async () => {
  assert.equal((await get('/biz/pasteleria/slots')).status, 400);
  assert.equal((await get('/biz/pasteleria/slots?date=mañana')).status, 400);
  const res = await get('/biz/pasteleria/slots?date=2020-01-01');
  assert.deepEqual(await res.json(), { ok: false, reason: 'past', slots: [] });
});

test('chat: una sesión mal formada no pasa', async () => {
  assert.equal((await post('/biz/pasteleria/chat', { session: 'x', text: 'hola' })).status, 400);
  assert.equal((await post('/biz/pasteleria/chat', { text: 'hola' })).status, 400);
});

test('chat: JSON roto y cuerpos enormes se rechazan sin tocar nada', async () => {
  assert.equal((await post('/biz/pasteleria/chat', '{roto')).status, 400);
  assert.equal((await post('/biz/pasteleria/chat', { session: SESSION, text: 'x'.repeat(9000) })).status, 413);
});

test('panel: exige una sesión válida', async () => {
  assert.equal((await get('/biz/pasteleria/staff')).status, 400);
  assert.equal((await get('/biz/pasteleria/agenda?session=corta')).status, 400);
  assert.equal((await post('/biz/pasteleria/staff/act', { session: 'corta' })).status, 400);
});

test('calentar el modelo se pide una vez cada 30 segundos', async () => {
  const first = await (await post('/biz/warm', {})).json();
  const second = await (await post('/biz/warm', {})).json();
  assert.equal(first.warming, true);
  assert.equal(second.warming, false);
});

test('los datos no tienen problemas', async () => {
  assert.deepEqual(await (await get('/biz/problems')).json(), { problemas: [] });
});
