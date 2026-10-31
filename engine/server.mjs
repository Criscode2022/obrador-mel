// Servidor HTTP del motor. Solo escucha en esta máquina: lo que llega de Internet pasa antes por
// web/serve.mjs, que deja entrar una lista cerrada de rutas y limita el ritmo.
import http from 'node:http';
import { readEnv } from './config.mjs';
import { healthDb } from './db.mjs';
import { handleBiz } from './biz/routes.mjs';

function send(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

const env = readEnv();
const port = Number(env.ENGINE_PORT || 8790);
const host = env.ENGINE_HOST || '127.0.0.1';

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  res.on('finish', () => {
    if (req.url === '/health') return;
    process.stdout.write(`${new Date().toISOString()} ${req.method} ${req.url.split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms\n`);
  });
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'GET' && path === '/health') {
      const db = await healthDb().catch(() => false);
      return send(res, db ? 200 : 503, { ok: db, db, service: 'obrador-mel-engine' });
    }
    if (await handleBiz({ req, url, path, send: (code, payload) => send(res, code, payload) })) return undefined;
    return send(res, 404, { error: 'not found', path });
  } catch (err) {
    process.stdout.write(`${new Date().toISOString()} ERROR ${req.method} ${req.url.split('?')[0]}: ${err instanceof Error ? err.stack : err}\n`);
    return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`obrador-mel-engine listening on ${host}:${port}\n`);
});
