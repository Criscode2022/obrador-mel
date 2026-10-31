// Crea las tablas de db/schema.sql. Idempotente: se puede lanzar sobre una base que ya las tiene.
import fs from 'node:fs';
import path from 'node:path';
import { root } from './config.mjs';
import { pool } from './db.mjs';

const sql = fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8');
await pool.query(sql);
await pool.end();
process.stdout.write('esquema aplicado\n');
