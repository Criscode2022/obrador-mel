// Una conversación con un negocio. Cada conversación es un expediente (`cases`) del visitante
// (`session_id`): sus mensajes, lo que el motor comprobó, y una solicitud (reserva, pedido,
// pregunta sin respuesta o aviso a una persona) que solo una persona del local puede confirmar.
import { caseId as newCaseId, nid, pool } from '../db.mjs';
import { embedModel } from '../llm.mjs';
import { classify, scrub } from '../pii.mjs';
import { freshState } from './ctx.mjs';
import { turn } from './dialog.mjs';
import { answerFromKb, collectionOf, promptSha, retrieve } from './kb.mjs';
import { analyze } from './nlu.mjs';
import {
  addCitation, addEvent, addMessage, addToolCalls, logDecision, saveProposal, setState,
} from './persist.mjs';
import { getBusiness } from './store.mjs';

const SESSION_RE = /^[a-f0-9]{32}$/;
const CASE_RE = /^EXP-\d{8}-[a-z0-9]+$/i;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => new HttpError(status, message);

const MAX_TEXT = 500;
const MAX_CASES_PER_SESSION = 60;
const ACTIONS = {
  set: ['field', 'value', 'resource'],
  pick: ['item_id'],
  add: ['item_id'],
  option: ['item_id', 'group', 'choice'],
  confirm: [],
  edit: [],
  more: [],
  asap: [],
  notes: ['value'],
  reset: ['field'],
  start: ['intent'],
  menu: ['category'],
  handoff: [],
  qty: ['index', 'delta'],
};

export function cleanAction(raw) {
  if (!raw || typeof raw !== 'object' || !ACTIONS[raw.type]) throw fail(400, 'acción desconocida');
  const out = { type: raw.type };
  for (const key of ACTIONS[raw.type]) {
    const v = raw[key];
    if (v == null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'string') out[key] = v.slice(0, 120);
    else throw fail(400, `acción: «${key}» inválido`);
  }
  return out;
}

export const checkSession = (session) => {
  if (!SESSION_RE.test(String(session || ''))) throw fail(400, 'sesión inválida');
  return String(session);
};
export const validCase = (id) => CASE_RE.test(String(id || ''));

// ------------------------------------------------------------------------------ lectura

export async function loadCase(slug, session, id) {
  if (!validCase(id)) return null;
  const { rows } = await pool.query('SELECT * FROM cases WHERE id = $1 AND business = $2 AND session_id = $3', [id, slug, session]);
  return rows[0] ?? null;
}

export async function primaryRequest(caseId) {
  const { rows } = await pool.query(
    'SELECT * FROM biz_requests WHERE case_id = $1 AND parent_id IS NULL ORDER BY created_at, id LIMIT 1',
    [caseId],
  );
  return rows[0] ?? null;
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

export function publicRequest(row) {
  if (!row) return null;
  const { _private, ...data } = row.data ?? {};
  return {
    id: row.id,
    case_id: row.case_id,
    kind: row.kind,
    status: row.status,
    data,
    slot_start: iso(row.slot_start),
    slot_end: iso(row.slot_end),
    total_cents: row.total_cents,
    parent_id: row.parent_id,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export async function messagesOf(caseId, limit = 120) {
  const { rows } = await pool.query(
    `SELECT id, role, content, meta, created_at FROM messages
      WHERE case_id = $1 ORDER BY created_at, id LIMIT $2`,
    [caseId, limit],
  );
  return rows.map((m) => ({ id: m.id, role: m.role, text: m.content, meta: m.meta ?? null, at: iso(m.created_at) }));
}

// Lo que el visitante ya tiene reservado o pedido: se resta de la disponibilidad que ve.
export async function ownBlocks(slug, session, exceptRequestId = null) {
  const { rows } = await pool.query(
    `SELECT id, kind, status, data FROM biz_requests
      WHERE business = $1 AND session_id = $2 AND kind IN ('booking', 'order')
        AND status IN ('pending', 'confirmed', 'change_proposed')`,
    [slug, session],
  );
  return rows.filter((r) => r.id !== exceptRequestId && r.data?.ymd && r.data?.min != null).map((r) => {
    const d = r.data;
    const when = r.status === 'change_proposed' && d.proposed ? d.proposed : d;
    return {
      ymd: when.ymd,
      start: when.min,
      end: when.min + (when.duration ?? d.duration ?? 10),
      resource: d.resource?.id ?? null,
      seats: d.seats ?? null,
    };
  });
}

// ------------------------------------------------------------------------------ decisión

const isTerminal = (kase, req) => ['emit', 'refused'].includes(kase.state)
  || ['confirmed', 'denied', 'answered', 'reviewed', 'cancelled'].includes(req?.status);

// ------------------------------------------------------------------------------ turno

async function createCase({ slug, session, lang, text }) {
  const count = await pool.query(
    `SELECT count(*)::int AS n FROM cases WHERE business = $1 AND session_id = $2 AND created_at > now() - interval '1 day'`,
    [slug, session],
  );
  if (count.rows[0].n >= MAX_CASES_PER_SESSION) throw fail(429, 'Demasiadas conversaciones hoy desde este navegador. Vuelve mañana.');
  const id = newCaseId();
  const pol = classify(text);
  await pool.query(
    `INSERT INTO cases (id, channel, lang, state, pii_level, route, summary, business, session_id)
     VALUES ($1, 'web', $2, 'intake', 'none', 'local', $3, $4, $5)`,
    [id, lang, pol.redacted_text.slice(0, 280), slug, session],
  );
  await addEvent(id, 'intake', { channel: 'web', business: slug, chars: text.length });
  const reqId = nid('req');
  await pool.query(
    `INSERT INTO biz_requests (id, case_id, business, session_id, kind, status, data, dialog)
     VALUES ($1,$2,$3,$4,'inquiry','collecting','{}'::jsonb,$5::jsonb)`,
    [reqId, id, slug, session, JSON.stringify(freshState(lang))],
  );
  return id;
}

function replyMeta(r) {
  const meta = {};
  for (const k of ['chips', 'cards', 'cites', 'evidence']) if (r[k]?.length) meta[k] = r[k];
  return Object.keys(meta).length ? meta : null;
}

function actionLabel(a, label) {
  if (label) return String(label).slice(0, 80);
  return `[${a.type}${a.value != null ? `: ${a.value}` : ''}]`;
}

// Entrada principal: un mensaje (`text`) o un botón (`action`) del visitante.
export async function chatTurn({
  slug, session, caseId, text, action, label, now = new Date(),
}) {
  const found = getBusiness(slug);
  if (!found) throw fail(404, 'negocio desconocido');
  checkSession(session);
  const { business, catalog } = found;
  const act = action ? cleanAction(action) : null;
  const raw = act ? '' : String(text ?? '').trim().slice(0, MAX_TEXT);
  if (!act && !raw) throw fail(400, 'mensaje vacío');
  const scrubbed = scrub(raw);

  let kase = caseId ? await loadCase(slug, session, caseId) : null;
  let primary = kase ? await primaryRequest(kase.id) : null;

  let mode = 'continue';
  if (!kase || !primary || isTerminal(kase, primary)) mode = 'new';
  else if (kase.state === 'handoff' && primary.status === 'pending' && ['handoff', 'question'].includes(primary.kind)) mode = 'human';
  else if (kase.state === 'await_approval' && primary.status === 'pending') {
    const dialog = primary.dialog ?? freshState();
    const peek = act ? null : analyze(raw, { biz: business, catalog, state: { lang: dialog.lang }, now });
    mode = act ? 'aside' : (['booking', 'order'].includes(peek.primary) ? 'new' : 'aside');
  }
  if (mode === 'new') {
    const lang = primary?.dialog?.lang ?? 'es';
    const id = await createCase({ slug, session, lang, text: raw || ' ' });
    kase = (await loadCase(slug, session, id));
    primary = await primaryRequest(id);
  }
  const id = kase.id;

  // Mensaje del visitante.
  const shown = act ? actionLabel(act, label) : scrubbed.text;
  const userMsg = await addMessage(id, 'user', shown, act ? { action: act } : (scrubbed.flags.length ? { redacted: scrubbed.flags } : null));

  if (mode === 'human') {
    await addEvent(id, 'customer.message', { chars: raw.length });
    const reply = {
      text: kase.lang === 'gl'
        ? 'Anotado: fíxenllo chegar ao local. Responderache aquí mesmo.'
        : 'Anotado: se lo he hecho llegar al local. Te responderán aquí mismo.',
    };
    const m = await addMessage(id, 'assistant', reply.text, null);
    return { case_id: id, mode, state: kase.state, user: { id: userMsg.id, at: iso(userMsg.at) }, replies: [{ id: m.id, role: 'assistant', text: reply.text, meta: null, at: iso(m.at) }], request: publicRequest(primary), trace: [] };
  }

  // Historia reciente para las consultas de seguimiento («¿y el domingo?»).
  const hist = await pool.query(
    `SELECT role, content FROM messages WHERE case_id = $1 AND id <> $2 AND role IN ('user','assistant')
      ORDER BY created_at DESC LIMIT 4`,
    [id, userMsg.id],
  );
  const history = hist.rows.reverse().map((r) => ({ role: r.role, text: r.content }));

  const dialog = primary.dialog ?? freshState(kase.lang);
  const own = await ownBlocks(slug, session);
  const hasPending = mode === 'aside' || (await pool.query(
    `SELECT 1 FROM biz_requests WHERE business = $1 AND session_id = $2 AND status = 'pending' AND kind IN ('booking','order') LIMIT 1`,
    [slug, session],
  )).rowCount > 0;

  const t0 = Date.now();
  const kbAnswer = async (q, c) => {
    const r = await retrieve(slug, q);
    const a = await answerFromKb({ biz: business, slug, text: q, lang: c.lang, hits: r.hits, history, now });
    return { ...a, hits: r.hits, degraded: r.degraded, retrieve_ms: r.ms };
  };
  const out = await turn({
    biz: business, catalog, state: dialog, input: act ? { action: act } : { text: raw }, now, own, hasPending, kbAnswer, history,
  });

  // ---------------------------------------------------------------- persistencia
  const lang = out.state.lang ?? kase.lang ?? 'es';
  const pol = classify(raw || shown);
  const primaryIntent = out.signals?.primary ?? 'accion';
  await setState(id, 'enrich', { lang, pii: pol.pii_level, summary: pol.redacted_text.slice(0, 280), payload: { lang, intent: primaryIntent, topic: out.signals?.topic ?? null } });
  await logDecision({
    case_id: id, step: 'enrich', route: 'local', model: 'reglas (nlu determinista)',
    reason: `idioma ${lang}; intención ${primaryIntent}${act ? `; acción ${act.type}` : ''}`, redacted: scrubbed.flags.length > 0,
  });
  const refused = out.refused;
  await setState(id, 'route', {
    lang, pii: pol.pii_level, route: refused ? 'refuse' : 'local',
    payload: { pii_level: pol.pii_level, route: refused ? 'refuse' : 'local', business: slug },
  });
  await logDecision({
    case_id: id, step: 'route', route: refused ? 'refuse' : 'local', model: 'política',
    reason: `${pol.pii_level !== 'none' ? `pii ${pol.pii_level}; ` : ''}solo modelo local, sin nube`, redacted: scrubbed.flags.length > 0,
  });

  const kb = out.kb;
  if (kb) {
    await setState(id, 'retrieve', { payload: { sources: (kb.used ?? []).map((u) => u.heading), degraded: Boolean(kb.degraded) } });
    await logDecision({
      case_id: id, step: 'retrieve', route: 'local', model: embedModel(),
      reason: `híbrido palabras + embeddings sobre ${collectionOf(slug)}; ${(kb.hits ?? []).slice(0, 3).map((h) => `${h.heading} ${h.score}`).join(', ')}${kb.degraded ? '; búsqueda degradada' : ''}`,
    });
    if (kb.model) {
      await logDecision({
        case_id: id, step: 'generate', route: 'local', model: kb.model,
        reason: `respuesta con contexto; ${kb.fallback ? `texto de la fuente (${kb.reason})` : 'cifras comprobadas'} | negocio=${promptSha()}`,
        tokens_in: kb.tokens_in, tokens_out: kb.tokens_out,
      });
    }
    for (const u of (kb.used ?? []).slice(0, 3)) {
      await addCitation(id, { source: `${slug}/${u.source}#${u.heading}`, quote: u.text, score: u.score });
    }
  }
  for (const reply of out.replies) {
    for (const cite of reply.cites ?? []) {
      if (cite.source === 'catalog.json' || cite.source === 'business.json') {
        await addCitation(id, { source: `${slug}/${cite.source}`, quote: cite.title, score: 1 });
      }
    }
  }
  await addToolCalls(id, out.trace.filter((t) => !['understand', 'propose'].includes(t.step)));

  // Solicitud.
  const req = out.request;
  let requestRow = primary;
  let finalState = 'propose';
  const d = out.state;
  if (req) {
    const isAside = mode === 'aside';
    if (isAside) {
      const rid = nid('req');
      await pool.query(
        `INSERT INTO biz_requests (id, case_id, business, session_id, kind, status, data, parent_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [rid, id, slug, session, req.kind, req.status, JSON.stringify(req.data), primary.id],
      );
      requestRow = (await pool.query('SELECT * FROM biz_requests WHERE id = $1', [rid])).rows[0];
      finalState = kase.state;
    } else {
      await pool.query(
        `UPDATE biz_requests SET kind = $2, status = $3, data = $4::jsonb, slot_start = $5, slot_end = $6,
                total_cents = $7, dialog = $8::jsonb, updated_at = now() WHERE id = $1`,
        [primary.id, req.kind, req.status, JSON.stringify(req.data), req.slot_start, req.slot_end, req.total_cents, JSON.stringify(d)],
      );
      requestRow = (await pool.query('SELECT * FROM biz_requests WHERE id = $1', [primary.id])).rows[0];
      finalState = ['handoff', 'question'].includes(req.kind) ? 'handoff' : 'await_approval';
    }
  } else if (mode !== 'aside') {
    const answered = out.trace.some((t) => ['answer', 'retrieve'].includes(t.step) && t.ok);
    let kind = primary.kind;
    let status = primary.status;
    if (d.intent === 'booking' || d.intent === 'order') {
      kind = d.intent;
      status = 'collecting';
    } else if (answered && ['inquiry', 'info'].includes(kind)) {
      kind = 'info';
      status = 'answered';
    }
    await pool.query(
      'UPDATE biz_requests SET kind = $2, status = $3, dialog = $4::jsonb, updated_at = now() WHERE id = $1',
      [primary.id, kind, status, JSON.stringify(d)],
    );
    requestRow = (await pool.query('SELECT * FROM biz_requests WHERE id = $1', [primary.id])).rows[0];
    if (refused && kind === 'inquiry') finalState = 'refused';
  } else {
    finalState = kase.state;
  }
  if (refused && !req) finalState = mode === 'aside' ? kase.state : 'refused';

  // Mensajes del asistente.
  const stored = [];
  for (const r of out.replies) {
    const m = await addMessage(id, 'assistant', r.text, replyMeta(r));
    stored.push({ id: m.id, role: 'assistant', text: r.text, meta: replyMeta(r), at: iso(m.at) });
  }
  const summaryText = out.replies.map((r) => r.text).join(' ');
  await logDecision({
    case_id: id, step: 'propose', route: 'local', model: 'reglas + modelo local',
    reason: `${req ? `solicitud ${req.kind}/${req.status}` : refused ? 'rechazo' : 'respuesta'}; nada confirmado; ${Date.now() - t0} ms`,
  });
  if (req && !['handoff', 'question'].includes(req.kind) && mode !== 'aside') {
    const proposalId = await saveProposal(id, {
      checklist: [
        { item: 'idioma', value: lang }, { item: 'pii', value: pol.pii_level }, { item: 'ruta', value: 'local' },
        { item: 'solicitud', value: `${req.kind}: ${req.data.name ?? ''}`.trim() },
        { item: 'confirmacion_humana', done: false },
      ],
      start: req.slot_start, end: req.slot_end, draft: summaryText, status: 'proposed',
    });
    await setState(id, 'propose', { payload: { proposal_id: proposalId, request: req.kind } });
  } else {
    await setState(id, 'propose', { payload: { request: req?.kind ?? null, refused } });
  }
  if (finalState !== 'propose') {
    await setState(id, finalState, {
      lang, pii: pol.pii_level, route: refused ? 'refuse' : 'local',
      payload: { request_id: requestRow?.id ?? null, kind: requestRow?.kind ?? null },
    });
  } else {
    await pool.query('UPDATE cases SET lang = $2, pii_level = $3, updated_at = now() WHERE id = $1', [id, lang, pol.pii_level]);
  }
  const finalCase = (await pool.query('SELECT state, lang FROM cases WHERE id = $1', [id])).rows[0];
  return {
    case_id: id,
    mode,
    state: finalCase.state,
    lang: finalCase.lang,
    user: { id: userMsg.id, at: iso(userMsg.at) },
    replies: stored,
    request: publicRequest(requestRow),
    trace: out.trace,
  };
}

// ----------------------------------------------------------------------------- conversación

export async function conversation({ slug, session, caseId }) {
  checkSession(session);
  const kase = await loadCase(slug, session, caseId);
  if (!kase) return null;
  const primary = await primaryRequest(kase.id);
  const asides = (await pool.query('SELECT * FROM biz_requests WHERE case_id = $1 AND parent_id IS NOT NULL ORDER BY created_at', [kase.id])).rows;
  return {
    case_id: kase.id,
    state: kase.state,
    lang: kase.lang,
    messages: await messagesOf(kase.id),
    request: publicRequest(primary),
    asides: asides.map(publicRequest),
  };
}

// Última conversación abierta del visitante en un negocio (para reanudar tras recargar).
export async function latestConversation({ slug, session }) {
  checkSession(session);
  const { rows } = await pool.query(
    'SELECT id FROM cases WHERE business = $1 AND session_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1',
    [slug, session],
  );
  return rows[0] ? conversation({ slug, session, caseId: rows[0].id }) : null;
}
