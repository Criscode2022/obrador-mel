// Panel del local (demostración): lo que el visitante ve «desde dentro» del negocio. Aquí es donde
// una persona confirma, rechaza o propone otra hora. Solo entonces hay efecto externo: un evento de
// calendario (con approval_id) para reservas y citas, y el markdown de cierre del expediente.
import fs from 'node:fs';
import path from 'node:path';
import { createCalendarEvent } from '../calendar.mjs';
import { nid, outputDir, pool } from '../db.mjs';
import {
  agendaOf, isoAt, pickupAvailability, staffAvailability, tableAvailability, todayYmd,
} from './avail.mjs';
import { dayLong, dayRel, money } from './format.mjs';
import { HttpError, checkSession, loadCase, ownBlocks, publicRequest } from './flow.mjs';
import { addEvent, addMessage, setState } from './persist.mjs';
import { getBusiness } from './store.mjs';

const fail = (status, message) => new HttpError(status, message);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const L = (lang, es, gl) => (lang === 'gl' ? gl : es);
const ACTOR = 'local (demostración)';

// -------------------------------------------------------------------------------- lectura

export async function staffList({ slug, session }) {
  checkSession(session);
  const { rows } = await pool.query(
    `SELECT r.*, c.state AS case_state, c.lang AS case_lang, c.summary
       FROM biz_requests r JOIN cases c ON c.id = r.case_id
      WHERE r.business = $1 AND r.session_id = $2 AND r.status <> 'collecting'
      ORDER BY r.updated_at DESC, r.id DESC LIMIT 60`,
    [slug, session],
  );
  const ids = [...new Set(rows.map((r) => r.case_id))];
  const first = new Map();
  const evidence = new Map();
  const cites = new Map();
  const threads = new Map();
  if (ids.length) {
    const msgs = await pool.query(
      `SELECT case_id, role, content, created_at FROM messages WHERE case_id = ANY($1) AND role IN ('user','assistant','staff') ORDER BY created_at, id`,
      [ids],
    );
    for (const m of msgs.rows) {
      if (m.role === 'user' && !first.has(m.case_id)) first.set(m.case_id, m.content);
      const t = threads.get(m.case_id) ?? [];
      t.push({ role: m.role, text: m.content, at: iso(m.created_at) });
      threads.set(m.case_id, t);
    }
    const tools = await pool.query('SELECT case_id, tool, ok, result FROM tool_calls WHERE case_id = ANY($1) ORDER BY seq', [ids]);
    for (const t of tools.rows) {
      const list = evidence.get(t.case_id) ?? [];
      list.push({ step: t.tool, ok: t.ok, detail: t.result?.detalle ?? '' });
      evidence.set(t.case_id, list);
    }
    const cs = await pool.query('SELECT case_id, source, quote, score FROM citations WHERE case_id = ANY($1) ORDER BY id', [ids]);
    for (const c of cs.rows) {
      const list = cites.get(c.case_id) ?? [];
      list.push({ source: c.source, quote: c.quote, score: c.score });
      cites.set(c.case_id, list);
    }
  }
  const requests = rows.map((r) => ({
    ...publicRequest(r),
    case_state: r.case_state,
    lang: r.case_lang,
    customer_text: first.get(r.case_id) ?? '',
    thread: (threads.get(r.case_id) ?? []).slice(-8),
    evidence: (evidence.get(r.case_id) ?? []).slice(0, 12),
    citations: (cites.get(r.case_id) ?? []).slice(0, 4),
  }));
  const open = requests.filter((r) => ['pending', 'change_proposed'].includes(r.status) || (r.kind === 'info' && r.status === 'answered'));
  return {
    requests,
    counts: {
      pending: requests.filter((r) => ['pending', 'change_proposed'].includes(r.status)).length,
      review: requests.filter((r) => r.kind === 'info' && r.status === 'answered').length,
      done: requests.length - open.length,
    },
  };
}

export async function agenda({ slug, session, ymd }) {
  const found = getBusiness(slug);
  if (!found) throw fail(404, 'negocio desconocido');
  checkSession(session);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(ymd)) ? ymd : todayYmd();
  return agendaOf(found.business, { ymd: day, own: await ownBlocks(slug, session) });
}

// Huecos libres sin sesión: solo la ocupación de fondo. Sirven a la web y a las pruebas.
export function slotsPreview({ slug, ymd, party = 2, services = [], resource = null, now = new Date() }) {
  const found = getBusiness(slug);
  if (!found) throw fail(404, 'negocio desconocido');
  const { business, catalog } = found;
  const cfg = business.booking;
  if (cfg?.mode === 'tables') return tableAvailability(business, { ymd, party: Number(party) || 2, now });
  if (cfg?.mode === 'staff') {
    const ids = services.filter((s) => catalog.byId.has(s));
    const duration = ids.reduce((n, id) => n + (catalog.byId.get(id).duration ?? 30), 0) || 30;
    return staffAvailability(business, { ymd, duration, serviceIds: ids, resourceId: resource || null, now });
  }
  if (business.order) return pickupAvailability(business, { ymd, now });
  throw fail(400, 'este negocio no tiene reservas ni pedidos');
}

// ------------------------------------------------------------------------------- textos

function whenText(request, lang) {
  const d = request.data;
  return `${dayLong(d.ymd, lang)} a las ${d.time}`;
}

function confirmedText(business, request, lang, note, now = new Date()) {
  const d = request.data;
  const tail = note ? ` ${note}` : '';
  if (request.kind === 'order') {
    return L(
      lang,
      `Pedido confirmado: estará listo ${dayRel(d.ymd, 'es', now)} a las ${d.time}. Total ${money(request.total_cents, 'es')}; se paga al recoger.${tail}`,
      `Pedido confirmado: estará listo ${dayRel(d.ymd, 'gl', now)} ás ${d.time}. Total ${money(request.total_cents, 'gl')}; págase ao recoller.${tail}`,
    );
  }
  const who = d.resource?.name ? L(lang, ` con ${d.resource.name}`, ` con ${d.resource.name}`) : '';
  if (business.booking?.mode === 'staff') {
    return L(lang, `Cita confirmada${who}: ${whenText(request, 'es')}. Te esperamos en ${business.name}.${tail}`, `Cita confirmada${who}: ${whenText(request, 'gl')}. Esperámoste en ${business.name}.${tail}`);
  }
  return L(
    lang,
    `Reserva confirmada: ${whenText(request, 'es')}${d.party ? `, para ${d.party}` : ''}. Te esperamos en ${business.name}.${tail}`,
    `Reserva confirmada: ${whenText(request, 'gl')}${d.party ? `, para ${d.party}` : ''}. Esperámoste en ${business.name}.${tail}`,
  );
}

// ------------------------------------------------------------------------ cierre del expediente

async function renderBizMarkdown(kase, request, business, approvalId) {
  const tokens = await pool.query(
    `SELECT COALESCE(SUM(tokens_in),0)::int AS tin, COALESCE(SUM(tokens_out),0)::int AS tout FROM router_decisions WHERE case_id = $1`,
    [kase.id],
  );
  const cites = await pool.query('SELECT source, quote, score FROM citations WHERE case_id = $1', [kase.id]);
  const tools = await pool.query('SELECT seq, tool, source, ok FROM tool_calls WHERE case_id = $1 ORDER BY seq', [kase.id]);
  const d = request.data ?? {};
  const detail = [];
  if (request.kind === 'order') {
    for (const l of d.lines ?? []) detail.push(`- ${l.qty} × ${l.name}${l.option_label ? ` (${l.option_label})` : ''}: ${money(l.total_cents)}`);
    detail.push(`- total: ${money(request.total_cents)}`);
    detail.push(`- recogida: ${d.ymd} ${d.time}`);
  } else if (request.kind === 'booking') {
    detail.push(`- fecha: ${d.ymd} ${d.time} (${d.duration} min)`);
    if (d.party) detail.push(`- personas: ${d.party}`);
    if ((d.services ?? []).length) detail.push(`- servicios: ${d.services.map((s) => s.name).join(' + ')}`);
    if (d.resource?.name) detail.push(`- profesional: ${d.resource.name}`);
  } else {
    detail.push(`- tipo: ${request.kind}`);
  }
  if (d.name) detail.push(`- a nombre de: ${d.name}`);
  return [
    `# Expediente ${kase.id}`,
    '',
    `- id: ${kase.id}`,
    `- lang: ${kase.lang}`,
    `- route: ${kase.route === 'refuse' ? 'refuse' : 'local'}`,
    `- tokens: in=${tokens.rows[0].tin} out=${tokens.rows[0].tout}`,
    `- negocio: ${business.name} (${business.slug})`,
    `- solicitud: ${request.kind} · ${request.status}`,
    approvalId ? `- aprobación: ${approvalId} (${ACTOR})` : '- aprobación: (sin solicitud)',
    '',
    '## Detalle',
    '',
    ...detail,
    '',
    '## Citations',
    '',
    cites.rows.length
      ? cites.rows.map((r) => `- ${r.source} (${Number(r.score).toFixed(3)}): "${String(r.quote).replace(/\s+/g, ' ').slice(0, 160)}"`).join('\n')
      : '- (ningunha)',
    '',
    '## Ferramentas',
    '',
    tools.rows.length ? tools.rows.map((t) => `- ${t.seq}. ${t.tool} (${t.source})${t.ok ? '' : ' — erro'}`).join('\n') : '- (ningunha)',
    '',
    'Son un asistente; unha persoa confirmou. Demostración con un negocio ficticio: non hai datos reais.',
    '',
  ].join('\n');
}

async function emit(kase, request, business, approvalId) {
  const markdown = await renderBizMarkdown(kase, request, business, approvalId);
  const file = path.join(outputDir(), `${kase.id}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, markdown);
  await pool.query(
    `INSERT INTO artifacts (id, case_id, kind, path, transcript) VALUES ($1,$2,'emit',$3,$4)`,
    [nid('art'), kase.id, `${kase.id}.md`, markdown],
  );
  await setState(kase.id, 'emit', { payload: { approval_id: approvalId, path: `${kase.id}.md` } });
  return markdown;
}

// Reserva o pedido aprobado: evento de calendario (solo reservas y citas), cierre y aviso al cliente.
export async function finishConfirmed({ kase, request, business, approvalId, lang, note, now = new Date() }) {
  if (!approvalId) throw new Error('confirmar exige una aprobación (approval_id)');
  let calendar = null;
  if (request.kind === 'booking' && request.slot_start) {
    calendar = createCalendarEvent({ approvalId });
    if (!calendar.created) throw new Error(calendar.error || 'el calendario rechazó el evento');
    await addEvent(kase.id, 'calendar.create', {
      approval_id: approvalId, event_id: calendar.event_id, start: iso(request.slot_start), end: iso(request.slot_end), business: business.slug,
    });
  }
  await emit(kase, request, business, approvalId);
  await pool.query(`UPDATE biz_requests SET status = 'confirmed', updated_at = now() WHERE id = $1`, [request.id]);
  const text = confirmedText(business, request, lang, note, now);
  const card = request.data?.card ? { ...request.data.card, status: 'confirmed' } : null;
  await addMessage(kase.id, 'staff', text, card ? { cards: [card] } : null);
  return { calendar, text };
}

// ------------------------------------------------------------------------------- acciones

async function approvalRow(kase, request, decision, note) {
  const id = nid('apr');
  const prop = await pool.query('SELECT id FROM proposals WHERE case_id = $1 ORDER BY id DESC LIMIT 1', [kase.id]);
  await pool.query(
    `INSERT INTO approvals (id, case_id, proposal_id, actor, decision, note) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, kase.id, prop.rows[0]?.id ?? null, ACTOR, decision, note ?? ''],
  );
  await addEvent(kase.id, 'approval', { approval_id: id, decision, actor: ACTOR, request_id: request.id });
  return id;
}

// ¿Sigue libre ese hueco para esta solicitud (ignorando ella misma)?
async function slotFree({ business, catalog, request, ymd, min, session, now = new Date() }) {
  const own = await ownBlocks(business.slug, session, request.id);
  const d = request.data;
  let av;
  if (request.kind === 'order') {
    av = pickupAvailability(business, { ymd, now, leadMinutes: Math.max(business.order.prep_minutes ?? 10, ...(d.lines ?? []).map((l) => (l.lead_hours ?? 0) * 60)), own });
  } else if (business.booking?.mode === 'tables') {
    av = tableAvailability(business, { ymd, party: d.party ?? 2, now, own });
  } else {
    const ids = (d.services ?? []).map((s) => s.id);
    const duration = ids.reduce((n, id) => n + (catalog.byId.get(id)?.duration ?? 30), 0) || 30;
    av = staffAvailability(business, { ymd, duration, serviceIds: ids, resourceId: d.resource?.id ?? null, now, own });
  }
  return av.slots.find((s) => s.min === min) ?? null;
}

export async function staffAct({
  slug, session, requestId, action, message, ymd, time, now = new Date(),
}) {
  const found = getBusiness(slug);
  if (!found) throw fail(404, 'negocio desconocido');
  checkSession(session);
  const { business, catalog } = found;
  const { rows } = await pool.query('SELECT * FROM biz_requests WHERE id = $1 AND business = $2 AND session_id = $3', [requestId, slug, session]);
  const request = rows[0];
  if (!request) throw fail(404, 'solicitud no encontrada');
  const kase = await loadCase(slug, session, request.case_id);
  const lang = request.data?.lang === 'gl' ? 'gl' : (kase.lang === 'gl' ? 'gl' : 'es');
  const note = String(message ?? '').trim().slice(0, 500);
  const transactional = ['booking', 'order'].includes(request.kind);

  if (action === 'accept') {
    if (!transactional || !['pending'].includes(request.status)) throw fail(409, 'Esta solicitud no se puede confirmar ahora.');
    const approvalId = await approvalRow(kase, request, 'approve', note);
    const out = await finishConfirmed({ kase, request, business, approvalId, lang, note, now });
    return { ok: true, status: 'confirmed', approval_id: approvalId, calendar: out.calendar, message: out.text };
  }

  if (action === 'deny') {
    if (!['pending', 'change_proposed'].includes(request.status) || !transactional) throw fail(409, 'Esta solicitud no se puede rechazar ahora.');
    const approvalId = await approvalRow(kase, request, 'deny', note);
    await pool.query(`UPDATE biz_requests SET status = 'denied', updated_at = now() WHERE id = $1`, [request.id]);
    await setState(kase.id, 'refused', { route: 'local', payload: { decision: 'deny', approval_id: approvalId } });
    const text = request.kind === 'order'
      ? L(lang, `No hemos podido confirmar el pedido.${note ? ` ${note}` : ''}`, `Non puidemos confirmar o pedido.${note ? ` ${note}` : ''}`)
      : L(lang, `No hemos podido confirmar la solicitud.${note ? ` ${note}` : ''}`, `Non puidemos confirmar a solicitude.${note ? ` ${note}` : ''}`);
    const card = request.data?.card ? { ...request.data.card, status: 'denied' } : null;
    await addMessage(kase.id, 'staff', text, card ? { cards: [card] } : null);
    return { ok: true, status: 'denied', approval_id: approvalId, message: text };
  }

  if (action === 'change') {
    if (!transactional || request.status !== 'pending') throw fail(409, 'Solo se puede proponer otra hora en una solicitud pendiente.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd)) || !/^\d{2}:\d{2}$/.test(String(time))) throw fail(400, 'indica día y hora');
    const min = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const slot = await slotFree({ business, catalog, request, ymd, min, session, now });
    if (!slot) throw fail(409, 'Ese hueco no está libre. Elige uno de los disponibles.');
    const approvalId = await approvalRow(kase, request, 'propose_change', note);
    const duration = request.kind === 'order' ? 10 : (request.data.duration ?? 60);
    const proposed = { ymd, time, min, start: isoAt(ymd, min), end: isoAt(ymd, min + duration), approval_id: approvalId };
    await pool.query(
      `UPDATE biz_requests SET status = 'change_proposed', data = $2::jsonb, updated_at = now() WHERE id = $1`,
      [request.id, JSON.stringify({ ...request.data, proposed })],
    );
    const when = `${dayLong(ymd, lang)} a las ${time}`;
    const text = request.kind === 'order'
      ? L(lang, `El local no llega a la hora pedida. Propone dejártelo listo ${when}. ¿Te viene bien?${note ? ` ${note}` : ''}`, `O local non chega á hora pedida. Propón deixartelo listo ${when}. ¿Vénche ben?${note ? ` ${note}` : ''}`)
      : L(lang, `El local te propone otra hora: ${when}. ¿Te viene bien?${note ? ` ${note}` : ''}`, `O local próponche outra hora: ${when}. ¿Vénche ben?${note ? ` ${note}` : ''}`);
    await addMessage(kase.id, 'staff', text, {
      chips: [
        { label: L(lang, 'Aceptar la nueva hora', 'Aceptar a nova hora'), action: { type: 'change_accept' } },
        { label: L(lang, 'No me viene bien', 'Non me vén ben'), action: { type: 'change_reject' } },
      ],
    });
    return { ok: true, status: 'change_proposed', approval_id: approvalId, message: text };
  }

  if (action === 'message') {
    if (!note) throw fail(400, 'escribe el mensaje');
    await addMessage(kase.id, 'staff', note, null);
    if (['handoff', 'question'].includes(request.kind) && request.status === 'pending') {
      const approvalId = await approvalRow(kase, request, 'answer', note);
      await pool.query(`UPDATE biz_requests SET status = 'answered', updated_at = now() WHERE id = $1`, [request.id]);
      await emit(kase, { ...request, status: 'answered' }, business, approvalId);
      return { ok: true, status: 'answered', approval_id: approvalId };
    }
    await addEvent(kase.id, 'staff.message', { request_id: request.id });
    return { ok: true, status: request.status };
  }

  if (action === 'review') {
    if (!(request.kind === 'info' && request.status === 'answered')) throw fail(409, 'Esta consulta ya está revisada.');
    const approvalId = await approvalRow(kase, request, 'review', note);
    await pool.query(`UPDATE biz_requests SET status = 'reviewed', updated_at = now() WHERE id = $1`, [request.id]);
    await emit(kase, { ...request, status: 'reviewed' }, business, approvalId);
    return { ok: true, status: 'reviewed', approval_id: approvalId };
  }
  throw fail(400, 'acción desconocida');
}

