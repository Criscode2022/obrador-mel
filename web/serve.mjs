// Servidor de producción de la web: los ficheros de dist/ y una API cerrada hacia el motor.
// El navegador solo puede pedir las rutas de ALLOWED, con límites de ritmo y de tamaño antes de
// llegar al motor. /admin y el resto de rutas del motor no existen desde fuera.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dotenv = readDotEnv(path.join(here, '../.env'));
const setting = (key, fallback = '') => process.env[key] ?? dotenv[key] ?? fallback;
const dist = path.resolve(setting('WEB_DIST', path.join(here, 'dist/obrador-mel-web/browser')));
const port = Number(setting('WEB_PORT', '4310'));
const ENGINE = { host: '127.0.0.1', port: Number(setting('ENGINE_PORT', '8790')) };
const TRUST_PROXY = setting('TRUST_PROXY') === '1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff',
};
const HASHED = /-[A-Z0-9]{8}\.(?:js|css)$/;
const SECURITY = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'",
};

// Lo único que el navegador puede pedir al motor (se traduce a /biz/...).
const SLUG = '(?!problems$|warm$)[a-z0-9-]{2,40}';
const ALLOWED = [
  ['GET', new RegExp(`^/api/${SLUG}$`)],
  ['GET', new RegExp('^/api/[a-z0-9-]{2,40}/(?:conversation|staff|agenda|slots)$')],
  ['POST', new RegExp('^/api/[a-z0-9-]{2,40}/(?:chat|staff/act)$')],
  ['POST', /^\/api\/warm$/],
];
const MAX_BODY = 8 * 1024;
const PER_IP_PER_MIN = 40;
const GLOBAL_PER_MIN = 150;
const buckets = new Map();

function readDotEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

// X-Forwarded-For lo escribe el cliente: solo vale si hay un proxy de confianza delante.
function clientIp(req) {
  const forwarded = TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return forwarded || req.socket.remoteAddress || 'local';
}

// Ventana deslizante de un minuto por clave. -> true si se puede.
function allow(key, limit) {
  const now = Date.now();
  const list = (buckets.get(key) ?? []).filter((t) => now - t < 60000);
  if (list.length >= limit) {
    buckets.set(key, list);
    return false;
  }
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 20000) for (const [k, v] of buckets) if (!v.some((t) => now - t < 60000)) buckets.delete(k);
  return true;
}

function json(res, status, body, extra = {}) {
  res.writeHead(status, { ...SECURITY, 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

// Al motor solo llega lo que necesita: ni cookies ni cabeceras del cliente.
function proxy(req, res, url) {
  const headers = { host: `${ENGINE.host}:${ENGINE.port}` };
  for (const name of ['content-type', 'content-length', 'accept']) if (req.headers[name]) headers[name] = req.headers[name];
  const up = http.request({ ...ENGINE, path: url, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode || 502, { ...r.headers, ...SECURITY, 'cache-control': 'no-store' });
    r.pipe(res);
  });
  up.on('error', () => json(res, 502, { error: 'El asistente no está disponible ahora mismo.' }));
  req.pipe(up);
}

function api(req, res, url, pathname) {
  if (!ALLOWED.some(([method, re]) => method === req.method && re.test(pathname))) return json(res, 404, { error: 'not found' });
  // Límites antes de tocar el motor: 40 mensajes por minuto y dirección, 150 en total, cuerpos pequeños.
  if (req.method === 'POST' && pathname !== '/api/warm') {
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) return json(res, 413, { error: 'mensaje demasiado grande' });
    if (!allow(`ip:${clientIp(req)}`, PER_IP_PER_MIN) || !allow('global', GLOBAL_PER_MIN)) {
      return json(res, 429, { error: 'Demasiados mensajes seguidos. Espera unos segundos.' }, { 'retry-after': '20' });
    }
  }
  return proxy(req, res, `/biz${url.slice('/api'.length)}`);
}

function serveFile(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...SECURITY, allow: 'GET, HEAD' });
    return res.end();
  }
  let clean;
  try {
    clean = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, SECURITY);
    return res.end();
  }
  let file = path.join(dist, clean === '/' ? 'index.html' : clean);
  const inside = file.startsWith(`${dist}${path.sep}`);
  const exists = inside && fs.existsSync(file) && fs.statSync(file).isFile();
  if (!exists) {
    // Una ruta de la aplicación abre la web; un fichero que no existe es un 404, no el HTML.
    if (path.extname(clean)) {
      res.writeHead(404, { ...SECURITY, 'cache-control': 'no-store' });
      return res.end();
    }
    file = path.join(dist, 'index.html');
  }
  const name = path.basename(file);
  res.writeHead(200, {
    ...SECURITY,
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': name === 'index.html' ? 'no-store' : HASHED.test(name) ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
  });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  const url = req.url || '/';
  const pathname = url.split('?')[0];
  const t0 = Date.now();
  res.on('finish', () => {
    if (pathname !== '/healthz') process.stdout.write(`${new Date().toISOString()} ${req.method} ${pathname} ${res.statusCode} ${Date.now() - t0}ms\n`);
  });
  if (pathname === '/healthz') return json(res, 200, { ok: true });
  if (pathname === '/api' || pathname.startsWith('/api/')) return api(req, res, url, pathname);
  return serveFile(req, res, pathname);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`obrador-mel-web listening on 127.0.0.1:${port}\n`);
});
