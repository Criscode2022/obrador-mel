// El recorrido entero contra un Postgres de verdad: conversación, panel del local y cierre.
// Sin modelo ni Qdrant a propósito: el motor tiene que funcionar igual sin ellos.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chatTurn, conversation, latestConversation } from '../biz/flow.mjs';
import {
  agenda, slotsPreview, staffAct, staffList,
} from '../biz/staff.mjs';
import { pool } from '../db.mjs';

process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:9';
process.env.QDRANT_URL = 'http://127.0.0.1:9';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'obrador-'));
process.env.OUTPUT_DIR = OUT;

const slug = 'pasteleria';
const NOW = new Date('2026-10-15T08:00:00Z'); // jueves, 10:00 en Madrid
const CARD = '4111 1111 1111 1111';
const newSession = () => randomBytes(16).toString('hex');
const say = (session, caseId, text) => chatTurn({ slug, session, caseId, text, now: NOW });
const press = (session, caseId, action, label) => chatTurn({ slug, session, caseId, action, label, now: NOW });
const act = (session, requestId, action, extra = {}) => staffAct({ slug, session, requestId, action, now: NOW, ...extra });
const rows = async (sql, id) => (await pool.query(sql, [id])).rows;

async function placeOrder(session) {
  let r = await say(session, undefined, 'dos palmeras para el sábado a las 11 a nombre de Iria, teléfono 655444333');
  r = await say(session, r.case_id, 'no');
  return press(session, r.case_id, { type: 'confirm' }, 'Enviar pedido');
}

after(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await pool.end();
});

test('un encargo solo se cierra cuando una persona lo confirma', async () => {
  const session = newSession();
  const sent = await placeOrder(session);
  assert.equal(sent.state, 'await_approval');
  assert.equal(sent.request.kind, 'order');
  assert.equal(sent.request.status, 'pending');
  assert.equal(sent.request.total_cents, 440);
  assert.equal((await rows('SELECT count(*)::int AS n FROM approvals WHERE case_id = $1', sent.case_id))[0].n, 0);

  const out = await act(session, sent.request.id, 'accept');
  assert.equal(out.status, 'confirmed');
  assert.ok(out.approval_id);
  assert.equal(out.calendar, null, 'un pedido no crea evento de calendario');

  const conv = await conversation({ slug, session, caseId: sent.case_id });
  assert.equal(conv.state, 'emit');
  assert.equal(conv.request.status, 'confirmed');
  const notice = conv.messages.at(-1);
  assert.equal(notice.role, 'staff');
  assert.match(notice.text, /Pedido confirmado/);
  assert.equal(notice.meta.cards[0].status, 'confirmed');
});

test('el expediente deja rastro de cada paso, en orden', async () => {
  const session = newSession();
  const sent = await placeOrder(session);
  await act(session, sent.request.id, 'accept');
  const types = (await rows('SELECT type FROM events WHERE case_id = $1 ORDER BY at, id', sent.case_id)).map((e) => e.type);
  for (const step of ['intake', 'enrich', 'route', 'propose', 'await_approval', 'approval', 'emit']) assert.ok(types.includes(step), step);
  assert.ok(types.indexOf('approval') < types.lastIndexOf('emit'), 'primero se aprueba y después se cierra');
  const decisions = await rows('SELECT DISTINCT step FROM router_decisions WHERE case_id = $1', sent.case_id);
  assert.deepEqual(decisions.map((d) => d.step).sort(), ['enrich', 'propose', 'route']);
  const [proposal] = await rows('SELECT checklist, status FROM proposals WHERE case_id = $1', sent.case_id);
  assert.equal(proposal.status, 'proposed');
  assert.ok(proposal.checklist.some((c) => c.item === 'confirmacion_humana'));
});

test('el cierre escribe un markdown con identidad, tokens, fuentes y aprobación', async () => {
  const session = newSession();
  const sent = await placeOrder(session);
  const { approval_id: approval } = await act(session, sent.request.id, 'accept');
  const file = path.join(OUT, `${sent.case_id}.md`);
  const md = fs.readFileSync(file, 'utf8');
  assert.match(md, new RegExp(`^# Expediente ${sent.case_id}`));
  for (const line of [`- id: ${sent.case_id}`, '- lang: es', '- route: local', '- tokens: in=0 out=0', '- negocio: Obrador Mel (pasteleria)', `- aprobación: ${approval}`, '## Citations', '## Ferramentas']) {
    assert.ok(md.includes(line), line);
  }
  assert.match(md, /- solicitud: order · confirmed/);
  assert.match(md, /2 × Palmera de hojaldre: 4,40/);
  assert.match(md, /Son un asistente; unha persoa confirmou/);
  const [artifact] = await rows('SELECT kind, path, transcript FROM artifacts WHERE case_id = $1', sent.case_id);
  assert.equal(artifact.kind, 'emit');
  assert.equal(artifact.transcript, md);
});

test('rechazar avisa al cliente y no emite nada', async () => {
  const session = newSession();
  const sent = await placeOrder(session);
  const out = await act(session, sent.request.id, 'deny', { message: 'Ese día no tenemos hojaldre.' });
  assert.equal(out.status, 'denied');
  const conv = await conversation({ slug, session, caseId: sent.case_id });
  assert.equal(conv.state, 'refused');
  assert.match(conv.messages.at(-1).text, /No hemos podido confirmar el pedido. Ese día no tenemos hojaldre\./);
  assert.equal(conv.messages.at(-1).meta.cards[0].status, 'denied');
  assert.equal(fs.existsSync(path.join(OUT, `${sent.case_id}.md`)), false);
});

test('una solicitud ya resuelta no se decide dos veces', async () => {
  const session = newSession();
  const sent = await placeOrder(session);
  await act(session, sent.request.id, 'accept');
  await assert.rejects(act(session, sent.request.id, 'accept'), { status: 409 });
  await assert.rejects(act(session, sent.request.id, 'deny'), { status: 409 });
});

test('proponer otra hora y aceptarla mueve el pedido y su tarjeta', async () => {
  const session = newSession();
  const sent = await placeOrder(session);
  const other = slotsPreview({ slug, ymd: '2026-10-17', now: NOW }).slots.find((s) => s.time !== '11:00');
  const out = await act(session, sent.request.id, 'change', { ymd: '2026-10-17', time: other.time });
  assert.equal(out.status, 'change_proposed');
  assert.ok(out.message.includes(`el sábado 17 de octubre a las ${other.time}`), out.message);
  const waiting = await conversation({ slug, session, caseId: sent.case_id });
  assert.equal(waiting.request.status, 'change_proposed');
  assert.equal(waiting.messages.at(-1).meta.chips[0].action.type, 'change_accept');

  const done = await press(session, sent.case_id, { type: 'change_accept' }, 'Aceptar la nueva hora');
  assert.equal(done.state, 'emit');
  assert.equal(done.request.status, 'confirmed');
  assert.equal(done.request.data.time, other.time);
  assert.equal('proposed' in done.request.data, false);
  const conv = await conversation({ slug, session, caseId: sent.case_id });
  const card = conv.messages.at(-1).meta.cards[0];
  assert.match(conv.messages.at(-1).text, new RegExp(other.time));
  assert.ok(card.rows.find((r) => r.label === 'Recogida').value.includes(other.time), JSON.stringify(card.rows));
  const md = fs.readFileSync(path.join(OUT, `${sent.case_id}.md`), 'utf8');
  assert.match(md, /- solicitud: order · confirmed/);
  assert.ok(md.includes(`- recogida: 2026-10-17 ${other.time}`), md);
});

test('la hora propuesta se le dice a cada cliente en su idioma', async () => {
  const session = newSession();
  let r = await say(session, undefined, 'Ola, quero dúas palmeras para o sábado ás 11 a nome de Iria, teléfono 655444333');
  r = await say(session, r.case_id, 'non');
  r = await press(session, r.case_id, { type: 'confirm' }, 'Enviar pedido');
  const other = slotsPreview({ slug, ymd: '2026-10-17', now: NOW }).slots.find((s) => s.time !== '11:00');
  const out = await act(session, r.request.id, 'change', { ymd: '2026-10-17', time: other.time });
  assert.ok(out.message.startsWith('O local non chega'), out.message);
  assert.ok(out.message.includes(`o sábado 17 de outubro ás ${other.time}`), out.message);
});

test('si la hora propuesta no le viene bien, la solicitud vuelve al local', async () => {
  const session = newSession();
  const sent = await placeOrder(session);
  const other = slotsPreview({ slug, ymd: '2026-10-17', now: NOW }).slots.find((s) => s.time !== '11:00');
  await act(session, sent.request.id, 'change', { ymd: '2026-10-17', time: other.time });
  const back = await press(session, sent.case_id, { type: 'change_reject' }, 'No me viene bien');
  assert.equal(back.request.status, 'pending');
  assert.equal('proposed' in back.request.data, false);
  assert.match(back.replies[0].text, /He avisado al local|he avisado al local/);
});

test('no se puede proponer un hueco que no existe', async () => {
  const session = newSession();
  const sent = await placeOrder(session);
  await assert.rejects(act(session, sent.request.id, 'change', { ymd: '2026-10-17', time: '03:00' }), { status: 409 });
  await assert.rejects(act(session, sent.request.id, 'change', { ymd: 'sábado', time: '11:00' }), { status: 400 });
});

test('una pregunta sin respuesta pasa al local y su respuesta la cierra', async () => {
  const session = newSession();
  const asked = await say(session, undefined, '¿el perro de mi cuñado puede tomar xilitol?');
  assert.equal(asked.state, 'handoff');
  assert.equal(asked.request.kind, 'question');
  const waiting = await say(session, asked.case_id, '¿sigues ahí?');
  assert.equal(waiting.mode, 'human');
  const list = await staffList({ slug, session });
  assert.equal(list.counts.pending, 1);
  const out = await act(session, asked.request.id, 'message', { message: 'Mejor pregúntale al veterinario.' });
  assert.equal(out.status, 'answered');
  const conv = await conversation({ slug, session, caseId: asked.case_id });
  assert.equal(conv.state, 'emit');
  assert.equal(conv.messages.at(-1).text, 'Mejor pregúntale al veterinario.');
});

test('una respuesta del asistente queda abierta hasta que el local la revisa', async () => {
  const session = newSession();
  const asked = await say(session, undefined, '¿a qué hora abrís el sábado?');
  assert.equal(asked.request.kind, 'info');
  assert.equal(asked.request.status, 'answered');
  assert.equal((await staffList({ slug, session })).counts.review, 1);
  const out = await act(session, asked.request.id, 'review');
  assert.equal(out.status, 'reviewed');
  assert.equal((await staffList({ slug, session })).counts.review, 0);
  await assert.rejects(act(session, asked.request.id, 'review'), { status: 409 });
});

test('con el modelo y Qdrant caídos, el conocimiento contesta con el texto de la fuente', async () => {
  const session = newSession();
  const out = await say(session, undefined, '¿se pueden congelar las tartas?');
  assert.match(out.replies[0].text, /congelar enteras hasta un mes/);
  const [citation] = await rows('SELECT source FROM citations WHERE case_id = $1 ORDER BY score DESC', out.case_id);
  assert.match(citation.source, /^pasteleria\/conservacion-y-transporte\.md#Congelar/);
});

test('preguntar mientras se espera al local no toca el pedido', async () => {
  const session = newSession();
  const sent = await placeOrder(session);
  const aside = await say(session, sent.case_id, '¿dónde estáis?');
  assert.equal(aside.mode, 'aside');
  assert.equal(aside.state, 'await_approval');
  assert.match(aside.replies[0].text, /Rúa do Franco 27/);
  const conv = await conversation({ slug, session, caseId: sent.case_id });
  assert.equal(conv.request.status, 'pending');
  assert.equal(conv.request.kind, 'order');
});

test('otro pedido mientras se espera abre su propio expediente', async () => {
  const session = newSession();
  const sent = await placeOrder(session);
  const next = await say(session, sent.case_id, 'quiero también un brownie');
  assert.equal(next.mode, 'new');
  assert.notEqual(next.case_id, sent.case_id);
});

test('tras cerrar, un mensaje nuevo abre otro expediente', async () => {
  const session = newSession();
  const sent = await placeOrder(session);
  await act(session, sent.request.id, 'accept');
  const next = await say(session, sent.case_id, '¿a qué hora cerráis?');
  assert.notEqual(next.case_id, sent.case_id);
  assert.equal((await latestConversation({ slug, session })).case_id, next.case_id);
});

test('lo que pide el visitante aparece en su agenda y resta huecos', async () => {
  const session = newSession();
  await placeOrder(session);
  const day = await agenda({ slug, session, ymd: '2026-10-17' });
  assert.equal(day.rows.find((r) => r.time === '11:00').mine, 1);
  const other = await agenda({ slug, session: newSession(), ymd: '2026-10-17' });
  assert.equal(other.rows.find((r) => r.time === '11:00').mine, 0);
});

test('cada visitante solo ve lo suyo', async () => {
  const owner = newSession();
  const stranger = newSession();
  const sent = await placeOrder(owner);
  assert.equal(await conversation({ slug, session: stranger, caseId: sent.case_id }), null);
  assert.equal((await staffList({ slug, session: stranger })).requests.length, 0);
  await assert.rejects(act(stranger, sent.request.id, 'accept'), { status: 404 });
  const hijack = await say(stranger, sent.case_id, 'hola');
  assert.notEqual(hijack.case_id, sent.case_id, 'un expediente ajeno no se reanuda');
});

test('una acción desconocida o un mensaje vacío se rechazan', async () => {
  const session = newSession();
  await assert.rejects(press(session, undefined, { type: 'borrar_todo' }), { status: 400 });
  await assert.rejects(say(session, undefined, '   '), { status: 400 });
  await assert.rejects(say('corta', undefined, 'hola'), { status: 400 });
  await assert.rejects(chatTurn({ slug: 'nope', session, text: 'hola' }), { status: 404 });
});

// ----------------------------------------------------------------- datos que no se guardan

async function everything(caseId) {
  const q = async (sql) => JSON.stringify(await rows(sql, caseId));
  return (await Promise.all([
    q('SELECT summary FROM cases WHERE id = $1'),
    q('SELECT content, meta FROM messages WHERE case_id = $1'),
    q('SELECT data, dialog FROM biz_requests WHERE case_id = $1'),
    q('SELECT payload FROM events WHERE case_id = $1'),
    q('SELECT draft FROM proposals WHERE case_id = $1'),
  ])).join('\n');
}

test('una tarjeta en el primer mensaje no llega a la base de datos', async () => {
  const out = await say(newSession(), undefined, `hola, mi tarjeta es ${CARD}`);
  assert.equal(out.state, 'refused');
  const stored = await everything(out.case_id);
  assert.ok(!stored.includes('4111'), stored);
  assert.match(stored, /\[TARJETA\]/);
});

test('un DNI, con guion o sin él, no llega a la base de datos', async () => {
  for (const dni of ['12345678Z', '12345678-Z', 'X1234567L']) {
    const out = await say(newSession(), undefined, `hola, mi dni es ${dni}, ¿abrís mañana?`);
    const stored = await everything(out.case_id);
    assert.ok(!stored.includes(dni.slice(1, 8)), `${dni}: ${stored}`);
  }
});

test('un DNI escrito en las notas no llega a la base de datos', async () => {
  const session = newSession();
  let r = await say(session, undefined, 'dos palmeras para el sábado a las 11 a nombre de Iria, teléfono 655444333');
  r = await say(session, r.case_id, 'mi dni es 12345678Z por si hace falta');
  assert.ok(!(await everything(r.case_id)).includes('12345678'));
});

test('un botón manipulado no cuela una tarjeta', async () => {
  const session = newSession();
  let r = await say(session, undefined, 'dos palmeras para el sábado a las 11 a nombre de Iria, teléfono 655444333');
  r = await press(session, r.case_id, { type: 'notes', value: `tarjeta ${CARD}` }, `tarjeta ${CARD}`);
  assert.ok(!(await everything(r.case_id)).includes('4111'));
});

test('el nivel de datos personales del expediente sale del mensaje original', async () => {
  const out = await say(newSession(), undefined, 'mi dni es 12345678Z, ¿abrís mañana?');
  const [row] = await rows('SELECT pii_level, summary FROM cases WHERE id = $1', out.case_id);
  assert.equal(row.pii_level, 'dni');
  assert.ok(row.summary.includes('[DNI]'));
});

test('el resumen del expediente tapa también el teléfono y el correo', async () => {
  const out = await say(newSession(), undefined, 'hola, soy Iria, mi móvil es 655444333 y mi correo iria@example.com');
  const [row] = await rows('SELECT summary FROM cases WHERE id = $1', out.case_id);
  assert.ok(!row.summary.includes('655444333') && !row.summary.includes('iria@example.com'), row.summary);
});

// ------------------------------------------------------------------------------ límites

test('los eventos solo se añaden: no se pueden cambiar ni borrar', async () => {
  const out = await say(newSession(), undefined, 'hola');
  await assert.rejects(pool.query(`UPDATE events SET type = 'x' WHERE case_id = $1`, [out.case_id]), /append-only/);
  await assert.rejects(pool.query('DELETE FROM events WHERE case_id = $1', [out.case_id]), /append-only/);
});

test('un visitante no puede abrir expedientes sin límite', async () => {
  const session = newSession();
  for (let i = 0; i < 60; i += 1) await say(session, undefined, 'hola');
  await assert.rejects(say(session, undefined, 'hola'), { status: 429 });
});
