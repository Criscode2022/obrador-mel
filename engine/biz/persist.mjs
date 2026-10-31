// Escritura de un expediente en la base de datos: estados, eventos, decisiones, mensajes, fuentes
// y comprobaciones. Es el rastro de por qué el asistente dijo lo que dijo.
import { nid, pool } from '../db.mjs';

export async function setState(id, state, extra = {}) {
  await pool.query(
    `UPDATE cases
        SET state = $2,
            lang = COALESCE($3, lang),
            pii_level = COALESCE($4, pii_level),
            route = COALESCE($5, route),
            summary = COALESCE($6, summary),
            updated_at = now()
      WHERE id = $1`,
    [id, state, extra.lang ?? null, extra.pii ?? null, extra.route ?? null, extra.summary ?? null],
  );
  await pool.query(
    'INSERT INTO events (id, case_id, type, payload) VALUES ($1,$2,$3,$4::jsonb)',
    [nid('evt'), id, state, JSON.stringify(extra.payload ?? { state })],
  );
}

export async function addEvent(caseId, type, payload) {
  await pool.query(
    'INSERT INTO events (id, case_id, type, payload) VALUES ($1,$2,$3,$4::jsonb)',
    [nid('evt'), caseId, type, JSON.stringify(payload ?? {})],
  );
}

export async function logDecision(row) {
  await pool.query(
    `INSERT INTO router_decisions
      (id, case_id, step, route, model, reason, tokens_in, tokens_out, cost_est, redacted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [nid('rd'), row.case_id, row.step, row.route ?? 'local', row.model ?? null, row.reason ?? '',
      row.tokens_in ?? 0, row.tokens_out ?? 0, row.cost_est ?? 0, Boolean(row.redacted)],
  );
}

export async function addMessage(caseId, role, content, meta = null) {
  const id = nid('msg');
  const { rows } = await pool.query(
    `INSERT INTO messages (id, case_id, role, content, meta) VALUES ($1,$2,$3,$4,$5::jsonb)
     RETURNING created_at`,
    [id, caseId, role, String(content ?? ''), meta ? JSON.stringify(meta) : null],
  );
  return { id, at: rows[0].created_at };
}

export async function addCitation(caseId, { source, quote, score }) {
  await pool.query(
    'INSERT INTO citations (id, case_id, source, quote, score) VALUES ($1,$2,$3,$4,$5)',
    [nid('cit'), caseId, String(source).slice(0, 200), String(quote ?? '').slice(0, 400), Number(score ?? 0)],
  );
}

// Lo que el motor comprobó por su cuenta (disponibilidad, precios, alérgenos) queda como herramienta.
export async function addToolCalls(caseId, rawSteps) {
  let steps = rawSteps;
  const seen = new Set();
  steps = steps.filter((s) => {
    const key = `${s.step}|${s.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!steps.length) return;
  const { rows } = await pool.query('SELECT COALESCE(MAX(seq), 0)::int AS seq FROM tool_calls WHERE case_id = $1', [caseId]);
  let seq = rows[0].seq;
  for (const s of steps) {
    seq += 1;
    await pool.query(
      `INSERT INTO tool_calls (id, case_id, seq, tool, source, args, result, ok, ms)
       VALUES ($1,$2,$3,$4,'motor',$5::jsonb,$6::jsonb,$7,$8)`,
      [nid('tc'), caseId, seq, String(s.step).slice(0, 60), JSON.stringify({}), JSON.stringify({ detalle: s.detail }), s.ok !== false, s.ms ?? 0],
    );
  }
}

export async function saveProposal(caseId, { checklist, start, end, draft, status = 'proposed' }) {
  const id = `prop-${Date.now().toString(36)}-${nid('x').slice(2, 8)}`;
  await pool.query(
    `INSERT INTO proposals (id, case_id, checklist, slot_start, slot_end, draft, status)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7)`,
    [id, caseId, JSON.stringify(checklist), start ?? null, end ?? null, draft, status],
  );
  return id;
}
