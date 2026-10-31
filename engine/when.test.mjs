import test from 'node:test';
import assert from 'node:assert/strict';
import { MORNING_RE, findDay, madridIso, madridParts, normalize, pad, resolveDay } from './when.mjs';

// Miércoles 2026-09-30.
const TODAY = { y: 2026, m: 9, d: 30 };
const day = (text) => {
  const found = findDay(normalize(text).replace(MORNING_RE, ' '), TODAY);
  if (!found) return null;
  const r = resolveDay(found, TODAY);
  return r ? `${r.y}-${pad(r.m)}-${pad(r.d)}` : 'invalid';
};

test('sin día no hay lectura', () => {
  assert.equal(day('quiero una tarta'), null);
  assert.equal(day('unha cita algún día pola mañá'), null);
});

test('días de la semana en castellano y en gallego', () => {
  assert.equal(day('para el viernes por la mañana'), '2026-10-02');
  assert.equal(day('para o xoves pola mañá'), '2026-10-01');
  assert.equal(day('el lunes'), '2026-10-05');
  assert.equal(day('o venres'), '2026-10-02');
});

test('el mismo día de la semana que hoy es el de la semana que viene', () => {
  assert.equal(day('el miércoles'), '2026-10-07');
});

test('hoy, mañana, pasado mañana y dentro de N días', () => {
  assert.equal(day('hoy a las 18'), '2026-09-30');
  assert.equal(day('mañana'), '2026-10-01');
  assert.equal(day('pasado mañana'), '2026-10-02');
  assert.equal(day('dentro de 10 días'), '2026-10-10');
  assert.equal(day('mañana por la mañana'), '2026-10-01');
});

test('«mañá» es el día, «pola mañá» la parte del día', () => {
  assert.equal(day('quero unha tarta mañá'), '2026-10-01');
  assert.equal(day('pasado mañá'), '2026-10-02');
  assert.equal(day('mañá pola mañá'), '2026-10-01');
});

test('varios días: manda el de destino', () => {
  assert.equal(day('Tenía cita el viernes pero me ha surgido algo. ¿Me la podéis pasar al martes a las 11?'), '2026-10-06');
  assert.equal(day('¿Puedo cambiar mi cita del viernes al lunes?'), '2026-10-05');
  assert.equal(day('Quiero cambiar la cita al lunes porque el viernes no puedo'), '2026-10-05');
  assert.equal(day('Tiña cita o venres; podedes mudala para o luns?'), '2026-10-05');
  assert.equal(day('cita el lunes o el martes'), '2026-10-05');
});

test('fecha escrita y numérica', () => {
  assert.equal(day('el 15 de octubre'), '2026-10-15');
  assert.equal(day('o 2 de outubro'), '2026-10-02');
  assert.equal(day('el 15/10'), '2026-10-15');
  assert.equal(day('el 3 de marzo'), '2027-03-03');
  assert.equal(day('el día 3'), '2026-10-03');
});

test('una fecha que no existe se marca, no se corrige', () => {
  assert.equal(day('el 31 de febrero'), 'invalid');
});

test('relativos: semanas, meses y la semana que viene', () => {
  assert.equal(day('dentro de dos semanas'), '2026-10-14');
  assert.equal(day('unha cita dentro de dúas semanas'), '2026-10-14');
  assert.equal(day('dentro de un mes'), '2026-10-30');
  assert.equal(day('la semana que viene'), '2026-10-05');
});

test('la fecha en que llegó un aviso no es la de la cita', () => {
  assert.equal(day('Quiero cita el martes a las 10 y me notificaron el 22 de septiembre'), '2026-10-06');
  assert.equal(day('Hoy me llegó la notificación; quiero cita el jueves a las 17'), '2026-10-01');
  assert.equal(day('Onte chegoume a carta. Quero unha cita o venres'), '2026-10-02');
});

test('el desfase de Madrid cambia con el horario de invierno', () => {
  assert.equal(madridIso(2026, 10, 24, 10, 0), '2026-10-24T10:00:00+02:00');
  assert.equal(madridIso(2026, 10, 26, 10, 0), '2026-10-26T10:00:00+01:00');
});

test('madridParts lee la hora de pared de Madrid', () => {
  const p = madridParts(new Date('2026-10-15T06:30:00Z'));
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [2026, 10, 15, 8, 30]);
});
