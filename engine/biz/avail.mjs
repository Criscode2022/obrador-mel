// Disponibilidad de los negocios de demostración. Todo es determinista y se calcula en el
// motor (el modelo nunca decide si hay hueco):
//   - el horario y los cierres salen del business.json;
//   - la ocupación «de fondo» (otros clientes) sale de un generador con semilla: mismo día,
//     mismo hueco libre o lleno para todos los visitantes y entre reinicios;
//   - las reservas y pedidos del propio visitante (`own`) se restan encima.
import { addDays, madridIso, madridParts } from '../when.mjs';
import { DAYS, toMin } from './store.mjs';
import { clamp, hash01, pad2 } from './text.mjs';

export const ymdOf = ({ y, m, d }) => `${y}-${pad2(m)}-${pad2(d)}`;

export function partsOf(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return { y, m, d };
}

export function weekdayKey(ymd) {
  const { y, m, d } = partsOf(ymd);
  return DAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

export function todayYmd(now = new Date()) {
  const p = madridParts(now);
  return ymdOf({ y: p.year, m: p.month, d: p.day });
}

export function nowMinutes(now = new Date()) {
  const p = madridParts(now);
  return p.hour * 60 + p.minute;
}

export function addDaysYmd(ymd, n) {
  return ymdOf(addDays(partsOf(ymd), n));
}

export function daysBetween(fromYmd, toYmd) {
  const a = partsOf(fromYmd);
  const b = partsOf(toYmd);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

export function isoAt(ymd, min) {
  const { y, m, d } = partsOf(ymd);
  return madridIso(y, m, d, Math.floor(min / 60), min % 60);
}

export const fmtTime = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

// Rangos abiertos del día en minutos [[inicio, fin]]. Vacío si cierra ese día.
export function dayRanges(biz, ymd) {
  if ((biz.closed_dates ?? []).includes(ymd)) return [];
  return (biz.hours?.[weekdayKey(ymd)] ?? []).map(([a, b]) => [toMin(a), toMin(b)]);
}

export function isOpenAt(biz, ymd, min) {
  return dayRanges(biz, ymd).some(([a, b]) => min >= a && min < b);
}

// Instante absoluto (ms) de un día y minuto del día en Madrid.
export const instant = (ymd, min) => Date.parse(isoAt(ymd, min));

// Próxima apertura a partir de ahora. -> { ymd, min } | null (busca dos semanas).
export function nextOpening(biz, now = new Date()) {
  const today = todayYmd(now);
  const minute = nowMinutes(now);
  for (let i = 0; i < 15; i += 1) {
    const ymd = addDaysYmd(today, i);
    for (const [a] of dayRanges(biz, ymd)) {
      if (i > 0 || a > minute) return { ymd, min: a };
    }
  }
  return null;
}

// «7:30–20:00», «13:00–16:00 y 20:00–23:30» o null si cierra.
export function rangesLabel(ranges) {
  if (!ranges.length) return null;
  return ranges.map(([a, b]) => `${fmtTime(a)}–${fmtTime(b)}`).join(' y ');
}

const dayPart = (min) => (min < 17 * 60 ? 'lunch' : 'dinner');

// Ocupación de fondo 0..1 de un momento (mesas del restaurante, pedidos de la barra).
export function backgroundLoad(biz, cfg, ymd, min) {
  const load = cfg.load ?? {};
  const key = `${weekdayKey(ymd)}_${dayPart(min)}`;
  const rush = load.rush && min >= toMin(load.rush.from) && min < toMin(load.rush.to)
    && !['sat', 'sun'].includes(weekdayKey(ymd));
  const base = load.overrides?.[key] ?? (rush ? load.rush.value : load.default ?? 0.3);
  const block = Math.floor(min / 30);
  const noise = (hash01(`${biz.slug}|${ymd}|${block}`) - 0.5) * 0.5;
  return clamp(base + noise, 0, 1);
}

// ------------------------------------------------------------------ recogida de pedidos

function pickupLeft(biz, cfg, ymd, min, own) {
  const max = cfg.max_per_slot ?? 5;
  const seeded = Math.round(max * backgroundLoad(biz, cfg, ymd, min));
  const mine = own.filter((o) => o.ymd === ymd && o.start === min).length;
  return Math.max(0, max - seeded - mine);
}

// Huecos de recogida de un día. `leadMinutes` es la antelación mínima (preparación o plazo del producto).
export function pickupAvailability(biz, { ymd, now = new Date(), leadMinutes = null, own = [] }) {
  const cfg = biz.order;
  const lead = leadMinutes ?? cfg.prep_minutes ?? 10;
  const today = todayYmd(now);
  const delta = daysBetween(today, ymd);
  if (delta < 0) return { ok: false, reason: 'past', slots: [] };
  if (delta > (cfg.horizon_days ?? 1)) return { ok: false, reason: 'too_far', slots: [] };
  const ranges = dayRanges(biz, ymd);
  if (!ranges.length) return { ok: false, reason: 'closed', slots: [] };
  const earliest = now.getTime() + lead * 60000;
  const step = cfg.slot_minutes ?? 10;
  const slots = [];
  for (const [a, b] of ranges) {
    for (let t = a; t <= b - Math.min(15, step * 2); t += step) {
      if (instant(ymd, t) < earliest) continue;
      const left = pickupLeft(biz, cfg, ymd, t, own);
      if (left > 0) slots.push({ time: fmtTime(t), min: t, left });
    }
  }
  return { ok: slots.length > 0, reason: slots.length ? null : 'full', slots };
}

// Primer hueco de recogida desde ahora (hoy o el siguiente día abierto dentro del horizonte).
export function firstPickup(biz, { now = new Date(), leadMinutes = null, own = [] }) {
  const today = todayYmd(now);
  const horizon = biz.order?.horizon_days ?? 1;
  for (let i = 0; i <= horizon; i += 1) {
    const ymd = addDaysYmd(today, i);
    const av = pickupAvailability(biz, { ymd, now, leadMinutes, own });
    if (av.slots.length) return { ymd, ...av.slots[0], slots: av.slots };
  }
  return null;
}

// Los n huecos más cercanos a una hora pedida, sin repetir y ordenados por hora.
export function nearestSlots(slots, targetMin, n = 3) {
  return [...slots]
    .sort((a, b) => Math.abs(a.min - targetMin) - Math.abs(b.min - targetMin) || a.min - b.min)
    .slice(0, n)
    .sort((a, b) => a.min - b.min);
}

// ------------------------------------------------------------------- agenda del día (panel del local)

// Lo que ve el local de un día: ocupación de fondo (otros clientes) y las solicitudes del visitante.
export function agendaOf(biz, { ymd, own = [] }) {
  const ranges = dayRanges(biz, ymd);
  const out = { ymd, open: ranges.length > 0, ranges: ranges.map(([a, b]) => ({ from: fmtTime(a), to: fmtTime(b), from_min: a, to_min: b })) };
  if (!ranges.length) return { ...out, kind: 'closed' };
  if (biz.order) {
    const max = biz.order.max_per_slot ?? 5;
    const rows = [];
    for (const [a, b] of ranges) {
      for (let t = a; t < b; t += biz.order.slot_minutes ?? 10) {
        const seeded = Math.round(max * backgroundLoad(biz, biz.order, ymd, t));
        const mine = own.filter((o) => o.ymd === ymd && o.start === t).length;
        rows.push({ time: fmtTime(t), min: t, taken: seeded, mine, total: max });
      }
    }
    return { ...out, kind: 'pickup', rows };
  }
  return { ...out, kind: 'none' };
}
