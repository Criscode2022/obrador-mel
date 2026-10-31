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

function leadCutoff(cfg, now) {
  return now.getTime() + (cfg.lead_minutes ?? 0) * 60000;
}

// Fuera de la ventana de reserva (pasado, demasiado pronto o demasiado lejos). -> motivo | null
export function windowProblem(biz, cfg, ymd, now) {
  const today = todayYmd(now);
  const delta = daysBetween(today, ymd);
  if (delta < 0) return 'past';
  if (delta > (cfg.horizon_days ?? 60)) return 'too_far';
  if (!dayRanges(biz, ymd).length) return 'closed';
  return null;
}

// ---------------------------------------------------------------- mesas (restaurante)

export function tableDuration(cfg, party) {
  const d = cfg.duration_minutes ?? {};
  if (typeof d === 'number') return d;
  return party >= (d.long_from ?? 6) ? (d.long ?? 120) : (d.default ?? 90);
}

function tableFree(biz, cfg, ymd, start, party, own) {
  const dur = tableDuration(cfg, party);
  const sizes = cfg.tables.filter((t) => t.seats >= party).sort((a, b) => a.seats - b.seats);
  let best = null;
  let totalFree = 0;
  for (const t of sizes) {
    let taken = 0;
    for (let blk = start; blk < start + dur; blk += 30) {
      const load = backgroundLoad(biz, cfg, ymd, blk);
      const f = clamp(load + (hash01(`${biz.slug}|${ymd}|${Math.floor(blk / 30)}|${t.seats}`) - 0.5) * 0.3, 0, 1);
      taken = Math.max(taken, Math.round(t.count * f));
    }
    const mine = own.filter((o) => o.ymd === ymd && o.seats === t.seats && o.start < start + dur && o.end > start).length;
    const free = t.count - taken - mine;
    if (free > 0) {
      totalFree += free;
      if (!best) best = t.seats;
    }
  }
  return best ? { seats: best, free: totalFree } : null;
}

// -> { ok, reason?, slots: [{ time, min, seats, free, scarce }] }
export function tableAvailability(biz, { ymd, party, now = new Date(), own = [] }) {
  const cfg = biz.booking;
  if (party < (cfg.party?.min ?? 1) || party > (cfg.party?.max ?? 99)) return { ok: false, reason: 'party', slots: [] };
  const problem = windowProblem(biz, cfg, ymd, now);
  if (problem) return { ok: false, reason: problem, slots: [] };
  const slots = [];
  const earliest = leadCutoff(cfg, now);
  const step = cfg.slot_minutes ?? 30;
  const lastGap = cfg.last_seating_before_close_minutes ?? 60;
  for (const [a, b] of dayRanges(biz, ymd)) {
    for (let t = a; t <= b - lastGap; t += step) {
      if (instant(ymd, t) < earliest) continue;
      const free = tableFree(biz, cfg, ymd, t, party, own);
      if (free) slots.push({ time: fmtTime(t), min: t, seats: free.seats, free: free.free, scarce: free.free <= 1 });
    }
  }
  return { ok: slots.length > 0, reason: slots.length ? null : 'full', slots };
}

// ------------------------------------------------- citas con profesionales (peluquería, fisio)

export function eligibleResources(cfg, serviceIds, resourceId = null) {
  return cfg.resources.filter((r) => {
    if (resourceId && r.id !== resourceId) return false;
    if (r.services === 'all' || r.services == null) return true;
    return serviceIds.every((s) => r.services.includes(s));
  });
}

function resourceRanges(biz, res, ymd) {
  if ((biz.closed_dates ?? []).includes(ymd)) return [];
  return (res.hours?.[weekdayKey(ymd)] ?? []).map(([a, b]) => [toMin(a), toMin(b)]);
}

// Citas «de fondo» de un profesional ese día: intervalos [inicio, fin) en minutos.
export function seededBusy(biz, cfg, res, ymd) {
  const ranges = resourceRanges(biz, res, ymd);
  const busy = [];
  for (const [a, b] of ranges) {
    let t = a;
    while (t < b) {
      const load = cfg.load?.overrides?.[`${weekdayKey(ymd)}_${dayPart(t)}`] ?? cfg.load?.default ?? 0.4;
      const p = clamp(load + (hash01(`${biz.slug}|${ymd}|${res.id}|d`) - 0.5) * 0.3, 0.02, 0.95) * 0.46;
      if (hash01(`${biz.slug}|${ymd}|${res.id}|${t}`) < p) {
        const durations = [30, 45, 60, 60, 90];
        const dur = durations[Math.floor(hash01(`${biz.slug}|${ymd}|${res.id}|${t}|len`) * durations.length)];
        busy.push([t, Math.min(b, t + dur)]);
        t += dur;
      } else {
        t += 15;
      }
    }
  }
  return busy;
}

const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

// -> { ok, reason?, slots: [{ time, min, resource: { id, name }, duration }] }
export function staffAvailability(biz, { ymd, duration, serviceIds, resourceId = null, now = new Date(), own = [] }) {
  const cfg = biz.booking;
  const problem = windowProblem(biz, cfg, ymd, now);
  if (problem) return { ok: false, reason: problem, slots: [] };
  const resources = eligibleResources(cfg, serviceIds, resourceId);
  if (!resources.length) return { ok: false, reason: 'no_resource', slots: [] };
  const earliest = leadCutoff(cfg, now);
  const step = cfg.slot_minutes ?? 30;
  const byTime = new Map();
  for (const res of resources) {
    const busy = seededBusy(biz, cfg, res, ymd);
    const mine = own.filter((o) => o.ymd === ymd && o.resource === res.id);
    for (const [a, b] of resourceRanges(biz, res, ymd)) {
      for (let t = a; t + duration <= b; t += step) {
        if (instant(ymd, t) < earliest) continue;
        if (busy.some(([x, y]) => overlaps(t, t + duration, x, y))) continue;
        if (mine.some((o) => overlaps(t, t + duration, o.start, o.end))) continue;
        if (!byTime.has(t)) byTime.set(t, { time: fmtTime(t), min: t, resource: { id: res.id, name: res.name }, duration, others: 0 });
        else byTime.get(t).others += 1;
      }
    }
  }
  const slots = [...byTime.values()].sort((x, y) => x.min - y.min);
  return { ok: slots.length > 0, reason: slots.length ? null : 'full', slots };
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
  const cfg = biz.booking;
  if (cfg?.mode === 'tables') {
    const total = cfg.tables.reduce((n, t) => n + t.count, 0);
    const rows = [];
    for (const [a, b] of ranges) {
      for (let t = a; t < b; t += 30) {
        let taken = 0;
        for (const tb of cfg.tables) {
          const f = clamp(backgroundLoad(biz, cfg, ymd, t) + (hash01(`${biz.slug}|${ymd}|${Math.floor(t / 30)}|${tb.seats}`) - 0.5) * 0.3, 0, 1);
          taken += Math.round(tb.count * f);
        }
        const mine = own.filter((o) => o.ymd === ymd && o.start <= t && o.end > t).length;
        rows.push({ time: fmtTime(t), min: t, taken: Math.min(total, taken), mine, total });
      }
    }
    return { ...out, kind: 'tables', rows };
  }
  if (cfg?.mode === 'staff') {
    const resources = cfg.resources.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role ?? '',
      ranges: resourceRanges(biz, r, ymd).map(([a, b]) => ({ from_min: a, to_min: b })),
      busy: seededBusy(biz, cfg, r, ymd).map(([a, b]) => ({ from_min: a, to_min: b })),
      mine: own.filter((o) => o.ymd === ymd && o.resource === r.id).map((o) => ({ from_min: o.start, to_min: o.end })),
    }));
    return { ...out, kind: 'staff', resources };
  }
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
