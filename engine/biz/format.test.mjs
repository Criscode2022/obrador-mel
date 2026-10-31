import test from 'node:test';
import assert from 'node:assert/strict';
import { dayLong, dayRel, dayShort, listJoin, money, weekRows } from './format.mjs';
import { getBusiness } from './store.mjs';

const NOW = new Date('2026-10-15T08:00:00Z');

test('importes en euros con el formato de cada idioma', () => {
  assert.equal(money(3000).replace(/\s/g, ' '), '30,00 €');
  assert.equal(money(145, 'gl').replace(/\s/g, ' '), '1,45 €');
  assert.equal(money(null).replace(/\s/g, ' '), '0,00 €');
});

test('días: largo, corto y relativo a hoy', () => {
  assert.equal(dayLong('2026-10-17'), 'sábado 17 de octubre');
  assert.match(dayShort('2026-10-17'), /^sáb 17 oct$/);
  assert.equal(dayRel('2026-10-15', 'es', NOW), 'hoy');
  assert.equal(dayRel('2026-10-16', 'es', NOW), 'mañana');
  assert.equal(dayRel('2026-10-16', 'gl', NOW), 'mañá');
  assert.equal(dayRel('2026-10-17', 'es', NOW), 'el sábado 17 de octubre');
});

test('listas con la conjunción de cada idioma', () => {
  assert.equal(listJoin(['a', 'b', 'c']), 'a, b y c');
  assert.equal(listJoin(['a', 'b'], 'gl'), 'a e b');
  assert.equal(listJoin(['a', null]), 'a');
  assert.equal(listJoin([]), '');
});

test('el horario semanal agrupa los días iguales', () => {
  const rows = weekRows(getBusiness('pasteleria').business);
  assert.deepEqual(rows.map((r) => [r.day, r.value]), [
    ['Lunes', 'Cerrado'],
    ['Martes a sábado', '9:00–14:00 · 16:30–20:00'],
    ['Domingo', '9:30–14:00'],
  ]);
});
