// Conversaciones de extremo a extremo contra el motor en marcha, por HTTP, igual que la web.
// Cada línea de conversations.jsonl es una conversación con lo que se espera de cada turno.
// Las horas libres se piden al propio motor porque la ocupación depende del día.
//   node evals/run.mjs              todas
//   node evals/run.mjs tarta        solo las que llevan «tarta» en el id
// Con EVAL_NO_MODEL=1 se saltan las que marcan "model": true, las únicas que necesitan el modelo.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ENGINE_URL || `http://127.0.0.1:${process.env.ENGINE_PORT || 8790}`;
const SLUG = 'pasteleria';
const only = process.argv[2] || '';
const NO_MODEL = process.env.EVAL_NO_MODEL === '1';
const JSON_HEADERS = { 'content-type': 'application/json' };

const get = async (url) => (await fetch(`${BASE}${url}`)).json();
const post = async (url, body) => {
  const res = await fetch(`${BASE}${url}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${url} ${res.status}: ${data.error}`);
  return data;
};

const ymdPlus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() + n * 86400000));
const spoken = (ymd) => new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(`${ymd}T12:00:00Z`));

// {{pickup}}: un día abierto con plazo de sobra y las 11:00 libres.
async function pickupPhrase() {
  for (let d = 3; d < 30; d += 1) {
    const date = ymdPlus(d);
    const av = await get(`/biz/${SLUG}/slots?date=${date}`);
    if (av.slots?.some((s) => s.time === '11:00')) return `para el ${spoken(date)} a las 11:00`;
  }
  throw new Error('sin día de recogida');
}

async function fill(text) {
  return text.includes('{{pickup}}') ? text.replace('{{pickup}}', await pickupPhrase()) : text;
}

async function staffStep(step, session, caseId, expect, problems, tag) {
  const list = await get(`/biz/${SLUG}/staff?session=${session}`);
  const target = list.requests.find((r) => r.case_id === caseId && ['pending', 'change_proposed'].includes(r.status)) ?? list.requests[0];
  const body = { session, request_id: target.id, action: step.staff };
  if (step.staff === 'change') {
    const pick = (await get(`/biz/${SLUG}/slots?date=${target.data.ymd}`)).slots.find((s) => s.time !== target.data.time);
    body.date = target.data.ymd;
    body.time = pick.time;
  }
  const res = await post(`/biz/${SLUG}/staff/act`, body);
  if (expect.status && res.status !== expect.status) problems.push(`${tag}: estado ${res.status} ≠ ${expect.status}`);
}

function checkTurn(out, expect, problems, tag) {
  const text = out.replies.map((r) => r.text).join(' ');
  const cards = out.replies.flatMap((r) => r.meta?.cards ?? []);
  const chips = out.replies.flatMap((r) => r.meta?.chips ?? []);
  const kind = out.request?.kind;
  const open = !out.request || ['inquiry', 'info'].includes(kind) || out.request.status === 'collecting';
  if (expect.reply && !new RegExp(expect.reply, 'i').test(text)) problems.push(`${tag}: «${text.slice(0, 160)}» no encaja con /${expect.reply}/`);
  if (expect.card && !cards.some((c) => c.type === expect.card)) problems.push(`${tag}: falta una tarjeta ${expect.card}`);
  if (expect.chips_min && chips.length < expect.chips_min) problems.push(`${tag}: ${chips.length} botones < ${expect.chips_min}`);
  if (expect.no_request && !open) problems.push(`${tag}: creó una solicitud ${kind}/${out.request?.status}`);
  if (expect.no_order && kind === 'order') problems.push(`${tag}: abrió un pedido`);
  for (const [k, v] of Object.entries(expect.request ?? {})) {
    if (out.request?.[k] !== v) problems.push(`${tag}: request.${k} = ${out.request?.[k]} ≠ ${v}`);
  }
  if (expect.refused !== undefined && (out.state === 'refused') !== expect.refused) problems.push(`${tag}: estado ${out.state}`);
}

async function run(fixture) {
  const session = randomBytes(16).toString('hex');
  const problems = [];
  let caseId = null;
  for (const [i, step] of fixture.steps.entries()) {
    const tag = `${fixture.id}#${i + 1}`;
    const expect = step.expect ?? {};
    if (step.staff) {
      await staffStep(step, session, caseId, expect, problems, tag);
      continue;
    }
    const body = { session, case_id: caseId ?? undefined };
    if (step.say) body.text = await fill(step.say);
    if (step.action) body.action = step.action;
    const out = await post(`/biz/${SLUG}/chat`, body);
    caseId = out.case_id;
    checkTurn(out, expect, problems, tag);
  }
  // Quien confirma tiene que dejar el expediente cerrado y al cliente avisado.
  const closed = fixture.steps.some((s) => s.staff === 'accept' || s.expect?.request?.status === 'confirmed');
  if (closed) {
    const conv = await get(`/biz/${SLUG}/conversation?session=${session}&case=${caseId}`);
    if (conv.state !== 'emit') problems.push(`${fixture.id}: el expediente no se cerró (estado ${conv.state})`);
    if (!conv.messages.some((m) => m.role === 'staff')) problems.push(`${fixture.id}: el cliente no recibió el aviso del local`);
  }
  return problems;
}

const fixtures = fs.readFileSync(path.join(HERE, 'conversations.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
let pass = 0;
let fail = 0;
let skipped = 0;
for (const fixture of fixtures) {
  if (only && !fixture.id.includes(only)) continue;
  if (NO_MODEL && fixture.model) {
    skipped += 1;
    continue;
  }
  const t0 = Date.now();
  let problems;
  try {
    problems = await run(fixture);
  } catch (err) {
    problems = [`excepción: ${err.message}`];
  }
  if (problems.length) {
    fail += 1;
    console.log(`FAIL ${fixture.id} (${Date.now() - t0} ms)\n  - ${problems.join('\n  - ')}`);
  } else {
    pass += 1;
    console.log(`PASS ${fixture.id} (${Date.now() - t0} ms)`);
  }
}
console.log(`scored ${pass + fail} pass ${pass} fail ${fail}${skipped ? ` skipped ${skipped}` : ''}`);
process.exit(fail ? 1 : 0);
