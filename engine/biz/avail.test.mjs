import test from 'node:test';
import assert from 'node:assert/strict';
import { peluqueria, restaurante } from '../test/fixtures/index.mjs';
import {
  agendaOf, dayRanges, firstPickup, isOpenAt, nearestSlots, nextOpening, pickupAvailability, staffAvailability, tableAvailability, windowProblem,
} from './avail.mjs';
import { getBusiness } from './store.mjs';

const NOW = new Date('2026-10-15T08:00:00Z'); // jueves 15 de octubre, 10:00 en Madrid
const mel = getBusiness('pasteleria').business;
const rest = restaurante().business;
const pelu = peluqueria();

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

test('mesas: el sábado por la noche hay menos huecos que un martes', () => {
  const sat = tableAvailability(rest, { ymd: '2026-10-17', party: 4, now: NOW }).slots.filter((s) => s.min >= 20 * 60).length;
  const tue = tableAvailability(rest, { ymd: '2026-10-20', party: 4, now: NOW }).slots.filter((s) => s.min >= 20 * 60).length;
  assert.ok(tue > sat, `martes ${tue} > sábado ${sat}`);
});

test('mesas: tamaño de grupo, día cerrado y fuera de plazo', () => {
  assert.equal(tableAvailability(rest, { ymd: '2026-10-17', party: 20, now: NOW }).reason, 'party');
  assert.equal(tableAvailability(rest, { ymd: '2026-10-19', party: 2, now: NOW }).reason, 'closed');
  assert.equal(windowProblem(rest, rest.booking, '2027-03-01', NOW), 'too_far');
  assert.equal(windowProblem(rest, rest.booking, '2026-10-10', NOW), 'past');
});

test('citas: solo los profesionales que hacen todos los servicios', () => {
  const { business, catalog } = pelu;
  const ids = ['corte-mujer', 'tinte-raiz'];
  const duration = ids.reduce((n, id) => n + catalog.byId.get(id).duration, 0);
  const av = staffAvailability(business, { ymd: '2026-10-21', duration, serviceIds: ids, now: NOW });
  assert.ok(av.slots.length > 0);
  assert.ok(av.slots.every((s) => s.resource.id === 'marta'), 'solo Marta hace corte de mujer y tinte');
});

test('citas: lo que ya tengo reservado resta disponibilidad', () => {
  const { business } = pelu;
  const base = staffAvailability(business, { ymd: '2026-10-21', duration: 30, serviceIds: [], resourceId: 'marta', now: NOW });
  const first = base.slots[0];
  const own = [{ ymd: '2026-10-21', start: first.min, end: first.min + 30, resource: 'marta' }];
  const after = staffAvailability(business, { ymd: '2026-10-21', duration: 30, serviceIds: [], resourceId: 'marta', now: NOW, own });
  assert.ok(!after.slots.some((s) => s.min === first.min));
});

test('agenda del panel: cada modo devuelve su estructura', () => {
  assert.equal(agendaOf(mel, { ymd: '2026-10-17' }).kind, 'pickup');
  assert.equal(agendaOf(mel, { ymd: '2026-10-19' }).kind, 'closed');
  assert.equal(agendaOf(rest, { ymd: '2026-10-17' }).kind, 'tables');
  assert.equal(agendaOf(pelu.business, { ymd: '2026-10-17' }).kind, 'staff');
});

test('agenda del obrador: los pedidos del visitante se ven aparte de la ocupación', () => {
  const own = [{ ymd: '2026-10-17', start: 11 * 60, end: 11 * 60 + 10 }];
  const row = agendaOf(mel, { ymd: '2026-10-17', own }).rows.find((r) => r.min === 11 * 60);
  assert.equal(row.mine, 1);
  assert.equal(row.total, 6);
});
