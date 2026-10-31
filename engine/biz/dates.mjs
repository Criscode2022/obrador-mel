// Día y hora de un mensaje («el sábado a las nueve y media», «mañana por la tarde», «en 20 minutos»).
// Determinista. La hora ambigua («a las 9») se resuelve con el horario del negocio: en un
// restaurante abierto de 13 a 16 y de 20 a 23:30 son las 21:00; en el obrador, las 9:00.
import { MORNING_RE, findDay, madridParts, resolveDay } from '../when.mjs';
import { dayRanges, fmtTime, todayYmd, ymdOf, addDaysYmd } from './avail.mjs';
import { DAYS, toMin } from './store.mjs';
import { NUMBER_WORDS, normalize, toNumber } from './text.mjs';

const NUM = `(?:\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')})`;
const PEOPLE = '(?:personas?|pax|comensales|adultos?|ninos?|criaturas|persoas?)';
const PHONE = /(?:\+34|0034)?[\s.-]*\b[6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g;

const RE = {
  rel: new RegExp(`\\b(?:dentro de|en|daqui a|de aqui a)\\s+(${NUM}|media|un cuarto de)\\s*(minutos?|mins?|horas?|hora)\\b`),
  relHalf: /\b(?:dentro de|en)\s+(?:media hora|una hora y media)\b/,
  asap: /\b(?:ahora mismo|ya mismo|cuanto antes|lo antes posible|en cuanto (?:puedas|podais|puedan|este)|de inmediato|asap|canto antes|xa mesmo|agora mesmo|ahora|agora)\b/,
  clock: /\b(\d{1,2})[:.h](\d{2})\b/,
  hourH: /\b(\d{1,2})\s?(?:h|hs|hrs|horas)\b/,
  weekend: /\b(?:fin de semana|finde|fin de seman\w*)\b/,
  nextWeek: /\b(?:semana que viene|proxima semana|semana proxima|semana seguinte|semana que vén|semana que ven)\b/,
  morning: /\b(?:por|pola|de|na|en|esta|a)\s+(?:la\s+|a\s+)?(?:manana|mana)\b|\btemprano\b|\bdesayun\w*/,
  afternoon: /\b(?:tarde|tardes)\b/,
  night: /\b(?:noche|noite)\b/,
  lunch: /\b(?:comer|comida|almuerzo|almorzar|mediodia|xantar|xantares)\b/,
  dinner: /\b(?:cenar|cena|cenas|ceas)\b/,
};

// A partir de «las», «la» o «as» (gallego): «a las 9», «para las nueve y media», «ás oito».
const AT = new RegExp(
  `(?:^|\\s)(?:a|para|sobre|hacia|desde|ata|de)?\\s*(?:las|la|as)\\s+(${NUM})(?!\\s*${PEOPLE})`
  + '(?:\\s+(?:y|e)\\s+(media|cuarto|\\d{1,2})|\\s+menos\\s+(cuarto|veinte|diez|cinco|\\d{1,2}))?',
);

function stripNoise(t) {
  return t.replace(PHONE, ' ').replace(new RegExp(`\\b${NUM}\\s+${PEOPLE}\\b`, 'g'), ' ');
}

// -> { ymd, kind, raw } | { ambiguous: 'weekend' | 'next_week' } | { invalid: true, raw } | null
export function parseDay(text, now = new Date()) {
  const t = stripNoise(normalize(text)).replace(MORNING_RE, ' ');
  const p = madridParts(now);
  const today = { y: p.year, m: p.month, d: p.day };
  if (RE.weekend.test(t)) return { ambiguous: 'weekend' };
  if (RE.nextWeek.test(t)) return { ambiguous: 'next_week' };
  const found = findDay(t, today);
  if (!found) return null;
  const day = resolveDay(found, today);
  if (!day) return { invalid: true, raw: found.raw };
  return { ymd: ymdOf(day), kind: found.kind, raw: found.raw ?? '' };
}

function weekRanges(biz) {
  const out = [];
  for (const d of DAYS) for (const [a, b] of biz.hours?.[d] ?? []) out.push([toMin(a), toMin(b)]);
  return out;
}

// Pasa una hora «de reloj de 12 h» a 24 h con lo que se sabe: «de la tarde», el horario del día.
export function to24(hour, hint, ranges, bias = null) {
  if (hour >= 13 || hour === 0) return hour;
  if (hint === 'morning') return hour;
  if (['afternoon', 'night', 'lunch', 'dinner'].includes(hint)) return hour < 12 ? hour + 12 : hour;
  if (hour === 12) return 12;
  const fits = (h) => ranges.some(([a, b]) => h * 60 >= a && h * 60 < b);
  const am = hour;
  const pm = hour + 12;
  // Negocio de mañanas: «a las 8» es por la mañana aunque aún no hayan abierto (se le dirá la hora de apertura).
  if (bias === 'am' && hour <= 11) {
    const firstOpen = Math.min(...ranges.map(([a]) => a));
    if (fits(am) || am * 60 >= firstOpen - 90) return am;
  }
  if (fits(am) && fits(pm)) return bias === 'pm' || hour <= 7 ? pm : am;
  if (fits(am)) return am;
  if (fits(pm)) return pm;
  // Fuera de horario con cualquier lectura: la que más se parece a lo habitual del negocio.
  if (bias === 'am') return am;
  return hour <= 7 ? pm : am;
}

function partOf(t) {
  if (RE.dinner.test(t)) return 'dinner';
  if (RE.lunch.test(t)) return 'lunch';
  if (RE.morning.test(t)) return 'morning';
  if (RE.afternoon.test(t)) return 'afternoon';
  if (RE.night.test(t)) return 'night';
  return null;
}

// -> { min, time, explicit, part, asap, relMin }. `bare`: acepta un número suelto («9», «21:30») como hora.
export function parseTime(text, { biz, ymd = null, bare = false } = {}) {
  let t = stripNoise(normalize(text));
  const day = parseDay(text);
  if (day?.raw) t = t.replace(day.raw, ' ');
  const part = partOf(t);
  const out = { min: null, time: null, explicit: false, part, asap: false, relMin: null };

  const rel = t.match(RE.rel);
  if (RE.relHalf.test(t)) out.relMin = t.includes('y media') ? 90 : 30;
  else if (rel) {
    const unit = rel[2];
    const raw = rel[1];
    const n = raw === 'media' ? 0.5 : raw === 'un cuarto de' ? 0.25 : toNumber(raw);
    if (n) out.relMin = Math.round(n * (/^h/.test(unit) ? 60 : 1));
  }
  if (out.relMin) return out;
  if (RE.asap.test(t)) {
    out.asap = true;
    return out;
  }

  const ranges = (ymd && dayRanges(biz, ymd).length ? dayRanges(biz, ymd) : weekRanges(biz));
  const bias = biz.hour_bias ?? null;
  const hintOf = (tail) => {
    if (/\bde la manana\b|\bam\b/.test(tail)) return 'morning';
    if (/\bde la tarde\b|\bpm\b/.test(tail)) return 'afternoon';
    if (/\bde la noche\b|\bde la noite\b/.test(tail)) return 'night';
    return part;
  };
  const set = (h, m, tail) => {
    const hour = to24(h, hintOf(tail), ranges, bias);
    if (hour > 23 || m > 59) return false;
    out.min = hour * 60 + m;
    out.time = fmtTime(out.min);
    out.explicit = true;
    return true;
  };

  let m = t.match(RE.clock);
  if (m && set(Number(m[1]), Number(m[2]), t.slice(m.index + m[0].length, m.index + m[0].length + 24))) return out;
  m = t.match(RE.hourH);
  if (m && set(Number(m[1]), 0, t.slice(m.index + m[0].length, m.index + m[0].length + 24))) return out;
  m = t.match(AT);
  if (m) {
    const h = toNumber(m[1]);
    let minutes = 0;
    if (m[2]) minutes = m[2] === 'media' ? 30 : m[2] === 'cuarto' ? 15 : Number(m[2]);
    let hh = h;
    if (m[3]) {
      const less = m[3] === 'cuarto' ? 15 : m[3] === 'veinte' ? 20 : m[3] === 'diez' ? 10 : m[3] === 'cinco' ? 5 : Number(m[3]);
      hh = h - 1;
      minutes = 60 - less;
    }
    if (hh != null && set(hh, minutes, t.slice(m.index + m[0].length, m.index + m[0].length + 24))) return out;
  }
  if (/\b(?:al )?medio ?dia\b/.test(t)) {
    out.min = 12 * 60;
    out.time = '12:00';
    out.explicit = true;
    return out;
  }
  if (bare) {
    m = t.match(/^\s*(?:a las?\s+)?(\d{1,2})(?::(\d{2}))?\s*$/) ?? t.match(/^\s*(?:a|para)?\s*(?:las?|as)?\s*(\d{1,2})\s*$/);
    if (m && set(Number(m[1]), Number(m[2] ?? 0), '')) return out;
    const w = toNumber(t.trim());
    if (w && w <= 12 && set(w, 0, '')) return out;
  }
  return out;
}

// Día + hora de una sola vez. `ymdHint` es el día ya acordado en la conversación.
export function parseWhenBiz(text, { biz, now = new Date(), ymdHint = null, bare = false } = {}) {
  const day = parseDay(text, now);
  const ymd = day?.ymd ?? ymdHint ?? null;
  const time = parseTime(text, { biz, ymd, bare });
  const today = todayYmd(now);
  // «esta noche», «esta tarde» o «hoy» sin más: hoy.
  let resolved = day?.ymd ?? null;
  if (!resolved && /\besta (?:tarde|noche|noite|manana)\b/.test(normalize(text))) resolved = today;
  if (!resolved && time.relMin) resolved = today;
  return {
    ymd: resolved,
    day_kind: day?.kind ?? (resolved ? 'rel' : null),
    ambiguous: day?.ambiguous ?? null,
    invalid_day: Boolean(day?.invalid),
    ...time,
  };
}

// Primer día que cae en cierto día de la semana de `weekend` («finde» -> sábado y domingo próximos).
export function weekendDays(now = new Date()) {
  const today = todayYmd(now);
  const out = [];
  for (let i = 0; i < 8 && out.length < 2; i += 1) {
    const ymd = addDaysYmd(today, i);
    const { y, m, d } = { y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)), d: Number(ymd.slice(8, 10)) };
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 6 || dow === 0) out.push(ymd);
  }
  return out;
}
