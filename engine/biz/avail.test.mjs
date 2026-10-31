import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agendaOf, dayRanges, firstPickup, isOpenAt, nearestSlots, nextOpening, pickupAvailability,
} from './avail.mjs';
import { getBusiness } from './store.mjs';

const NOW = new Date('2026-10-15T08:00:00Z'); // jueves 15 de octubre, 10:00 en Madrid
const mel = getBusiness('pasteleria').business;

test('horario del obrador: abierto, cerrado y festivos', () => {
  assert.equal(isOpenAt(mel, '2026-10-15', 10 * 60), true);
  assert.equal(isOpenAt(mel, '2026-10-15', 15 * 60), false); // pausa de mediodía
  assert.deepEqual(dayRanges(mel, '2026-10-19'), []); // lunes
  assert.deepEqual(dayRanges(mel, '2026-12-25'), []); // Navidad
  assert.deepEqual(nextOpening(mel, new Date('2026-10-15T13:00:00Z')), { ymd: '2026-10-15', min: 16 * 60 + 30 });
  assert.deepEqual(nextOpening(mel, new Date('2026-10-18T18:00:00Z')), { ymd: '2026-10-20', min: 9 * 60 }); // tras el domingo, el martes
});

test('recogida: respeta la preparación y el plazo del producto', () => {
  const soon = pickupAvailability(mel, { ymd: '2026-10-15', now: NOW });
  assert.ok(soon.slots[0].min >= 10 * 60 + 15, 'no antes de 15 minutos');
  const tarta = pickupAvailability(mel, { ymd: '2026-10-16', now: NOW, leadMinutes: 48 * 60 });
  assert.equal(tarta.slots.length, 0);
  assert.ok(pickupAvailability(mel, { ymd: '2026-10-18', now: NOW, leadMinutes: 48 * 60 }).slots.length > 0);
});

test('recogida: días fuera de la ventana', () => {
  assert.equal(pickupAvailability(mel, { ymd: '2026-10-14', now: NOW }).reason, 'past');
  assert.equal(pickupAvailability(mel, { ymd: '2026-10-19', now: NOW }).reason, 'closed');
  assert.equal(pickupAvailability(mel, { ymd: '2026-12-01', now: NOW }).reason, 'too_far');
});

test('recogida: lo que el visitante ya tiene pedido resta huecos', () => {
  const { slots } = pickupAvailability(mel, { ymd: '2026-10-16', now: NOW });
  const slot = slots.find((s) => s.left === 1) ?? slots[0];
  const own = Array.from({ length: slot.left }, () => ({ ymd: '2026-10-16', start: slot.min, end: slot.min + 10 }));
  const after = pickupAvailability(mel, { ymd: '2026-10-16', now: NOW, own });
  assert.ok(!after.slots.some((s) => s.min === slot.min));
});

test('recogida: el primer hueco salta al siguiente día abierto', () => {
  const sundayNight = new Date('2026-10-18T19:00:00Z');
  assert.equal(firstPickup(mel, { now: sundayNight }).ymd, '2026-10-20');
});

test('los huecos más cercanos a una hora se devuelven ordenados', () => {
  const slots = [{ min: 540 }, { min: 570 }, { min: 600 }, { min: 630 }];
  assert.deepEqual(nearestSlots(slots, 610, 2).map((s) => s.min), [600, 630]);
});

test('la ocupación de fondo es determinista', () => {
  const a = pickupAvailability(mel, { ymd: '2026-10-17', now: NOW });
  const b = pickupAvailability(mel, { ymd: '2026-10-17', now: NOW });
  assert.deepEqual(a.slots, b.slots);
});

test('agenda del panel: cada modo devuelve su estructura', () => {
  assert.equal(agendaOf(mel, { ymd: '2026-10-17' }).kind, 'pickup');
  assert.equal(agendaOf(mel, { ymd: '2026-10-19' }).kind, 'closed');
});

test('agenda del obrador: los pedidos del visitante se ven aparte de la ocupación', () => {
  const own = [{ ymd: '2026-10-17', start: 11 * 60, end: 11 * 60 + 10 }];
  const row = agendaOf(mel, { ymd: '2026-10-17', own }).rows.find((r) => r.min === 11 * 60);
  assert.equal(row.mine, 1);
  assert.equal(row.total, 6);
});
