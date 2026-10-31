// Conexión a Postgres y los identificadores de lo que se guarda.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { readEnv, root } from './config.mjs';

const env = readEnv();

export const pool = new pg.Pool({
  host: env.POSTGRES_HOST || '127.0.0.1',
  port: Number(env.POSTGRES_PORT || 55432),
  user: env.POSTGRES_USER || 'obrador',
  password: env.POSTGRES_PASSWORD || 'obrador',
  database: env.POSTGRES_DB || 'obrador',
  max: 8,
});

// Dónde se escribe el markdown de cierre de cada expediente.
export const outputDir = () => readEnv().OUTPUT_DIR || path.join(root, 'output');

export function nid(prefix) {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

export function caseId(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  const ymd = `${get('year')}${get('month')}${get('day')}`;
  return `EXP-${ymd}-${randomBytes(3).toString('hex')}`;
}

export async function healthDb() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}
