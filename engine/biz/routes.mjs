// Rutas HTTP de los negocios (/biz/...). El motor las expone sin autenticación porque solo escucha
// en esta máquina; la web pública las alcanza únicamente por la lista cerrada de web/serve.mjs
// (/api), con límites de ritmo y de tamaño.
import { chatTurn, checkSession, conversation, HttpError, latestConversation } from './flow.mjs';
import { warmModels } from '../llm.mjs';
import { ingestBusiness } from './kb.mjs';
import { agenda, slotsPreview, staffAct, staffList } from './staff.mjs';
import {
  allSlugs, datasetProblems, getBusiness, listBusinesses, publicProfile,
} from './store.mjs';

const MAX_BODY = 8 * 1024;
const MAX_CONCURRENT = 2;
const MAX_WAIT_MS = 9000;
const PER_SESSION_PER_MIN = 40;

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'mensaje demasiado grande');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

// Como mucho dos conversaciones a la vez con el modelo local; el resto espera unos segundos.
let active = 0;
const waiting = [];
async function gate(fn) {
  if (active >= MAX_CONCURRENT) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        reject(new HttpError(429, 'Hay mucha gente probando a la vez. Inténtalo de nuevo en unos segundos.'));
      }, MAX_WAIT_MS);
      const entry = () => { clearTimeout(timer); resolve(); };
      waiting.push(entry);
    });
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  }
}

let lastWarm = 0;
const hits = new Map();
function throttle(session) {
  const now = Date.now();
  const list = (hits.get(session) ?? []).filter((t) => now - t < 60000);
  if (list.length >= PER_SESSION_PER_MIN) throw new HttpError(429, 'Vas muy rápido. Espera un momento.');
  list.push(now);
  hits.set(session, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
}

// -> true si la ruta era de negocios.
export async function handleBiz({ req, url, path, send }) {
  const method = req.method;
  try {
    if (method === 'POST' && path === '/admin/ingest') {
      const out = [];
      for (const slug of allSlugs()) out.push(await ingestBusiness(slug));
      return send(200, { negocios: out, problemas: datasetProblems() }) ?? true;
    }
    if (path !== '/biz' && !path.startsWith('/biz/')) return false;
    const parts = path.split('/').filter(Boolean); // ['biz', slug?, ...]
    if (method === 'GET' && parts.length === 1) return send(200, listBusinesses()) ?? true;
    if (method === 'GET' && parts[1] === 'problems') return send(200, { problemas: datasetProblems() }) ?? true;
    if (method === 'POST' && parts[1] === 'warm' && parts.length === 2) {
      // Carga el modelo en memoria mientras la persona escribe: la primera respuesta no paga el arranque en frío.
      const now = Date.now();
      const fresh = now - lastWarm > 30000;
      if (fresh) {
        lastWarm = now;
        void warmModels();
      }
      return send(200, { warming: fresh }) ?? true;
    }
    const slug = parts[1];
    if (!getBusiness(slug)) return send(404, { error: 'negocio desconocido' }) ?? true;
    const sub = parts.slice(2).join('/');
    const q = url.searchParams;

    if (method === 'GET' && !sub) return send(200, publicProfile(slug)) ?? true;
    if (method === 'GET' && sub === 'slots') {
      const ymd = String(q.get('date') || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new HttpError(400, 'date=YYYY-MM-DD');
      const services = String(q.get('services') || '').split(',').filter(Boolean).slice(0, 5);
      return send(200, slotsPreview({ slug, ymd, party: q.get('party') || 2, services, resource: q.get('resource') })) ?? true;
    }
    if (method === 'POST' && sub === 'chat') {
      const body = await readBody(req);
      checkSession(body.session);
      throttle(body.session);
      const out = await gate(() => chatTurn({
        slug, session: body.session, caseId: body.case_id, text: body.text, action: body.action, label: body.label,
      }));
      return send(200, out) ?? true;
    }
    if (method === 'GET' && sub === 'conversation') {
      const session = checkSession(q.get('session'));
      const out = q.get('case')
        ? await conversation({ slug, session, caseId: q.get('case') })
        : await latestConversation({ slug, session });
      return send(200, out ?? { case_id: null, messages: [], request: null }) ?? true;
    }
    if (method === 'GET' && sub === 'staff') {
      return send(200, await staffList({ slug, session: checkSession(q.get('session')) })) ?? true;
    }
    if (method === 'GET' && sub === 'agenda') {
      return send(200, await agenda({ slug, session: checkSession(q.get('session')), ymd: q.get('date') })) ?? true;
    }
    if (method === 'POST' && sub === 'staff/act') {
      const body = await readBody(req);
      const session = checkSession(body.session);
      throttle(session);
      return send(200, await staffAct({
        slug, session, requestId: String(body.request_id || ''), action: String(body.action || ''), message: body.message, ymd: body.date, time: body.time,
      })) ?? true;
    }
    return send(404, { error: 'not found', path }) ?? true;
  } catch (err) {
    if (err instanceof HttpError) return send(err.status, { error: err.message }) ?? true;
    throw err;
  }
}
