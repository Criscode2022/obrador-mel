// Lee del texto de la persona el día de un encargo o una reserva, y las fechas en hora de Madrid.
// Determinista y local: el modelo no interviene. La hora se lee en biz/dates.mjs.
export const TZ = 'Europe/Madrid';

export const WEEKDAYS = {
  domingo: 0,
  lunes: 1, luns: 1,
  martes: 2,
  miercoles: 3, mercores: 3,
  jueves: 4, xoves: 4,
  viernes: 5, venres: 5,
  sabado: 6,
};

export const MONTHS = {
  enero: 1, xaneiro: 1,
  febrero: 2, febreiro: 2,
  marzo: 3,
  abril: 4,
  mayo: 5, maio: 5,
  junio: 6, xuno: 6,
  julio: 7, xullo: 7,
  agosto: 8,
  septiembre: 9, setiembre: 9, setembro: 9,
  octubre: 10, outubro: 10,
  noviembre: 11, novembro: 11,
  diciembre: 12, decembro: 12,
};

const MONTH_RE = Object.keys(MONTHS).join('|');
const DAY_RE = `(${Object.keys(WEEKDAYS).join('|')})`;
// «Por la mañana», «pola mañá», «esta mañá»: es la parte del día, no el día de mañana.
// Sin tildes, el gallego «mañá» queda en «mana» y el castellano «mañana» en «manana».
export const MORNING_RE = /\b(?:por|pola|de|na|en|esta) (?:la |a )?(?:manana|mana)\b/g;

export const pad = (n) => String(n).padStart(2, '0');

// Minúsculas y sin tildes: «mañá» y «mañana» quedan en «mana», «xoves» igual.
export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function madridParts(date) {
  const out = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)) out[part.type] = Number(part.value);
  return out;
}

// Suma días a una fecha civil sin pasar por husos horarios.
export function addDays({ y, m, d }, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function validDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Hora de pared de Madrid -> ISO con su offset (+01:00 o +02:00).
export function madridIso(y, m, d, hour, minute) {
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) {
    const p = madridParts(new Date(guess));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wall - shown;
  }
  const p = madridParts(new Date(guess));
  const offMin = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess) / 60000);
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return `${y}-${pad(m)}-${pad(d)}T${pad(hour)}:${pad(minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Números escritos con letras (sin tildes: «dúas» -> «duas»).
export const NUM_WORDS = {
  un: 1, uno: 1, una: 1, unha: 1, dos: 2, dous: 2, duas: 2, tres: 3, cuatro: 4, catro: 4, cinco: 5, seis: 6,
  siete: 7, sete: 7, ocho: 8, oito: 8, nueve: 9, nove: 9, diez: 10, dez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30,
};
export const NUM_RE = Object.keys(NUM_WORDS).join('|');
export const toNumber = (word) => (/^\d+$/.test(word) ? Number(word) : NUM_WORDS[word]);
const WRITTEN_DATE_RE = /\b(\d{1,2}) (?:de )?(enero|xaneiro|febrero|febreiro|marzo|abril|mayo|maio|junio|xuno|julio|xullo|agosto|septiembre|setiembre|setembro|octubre|outubro|noviembre|novembro|diciembre|decembro)(?: (?:de |del )?(\d{4}))?\b/g;
const BOOKING_RE = /\b(?:citas?|hueco|huecos|oco|ocos|reserv\w*|agend\w*|turno)\b/g;
// Verbos con los que la persona cuenta cuándo le llegó la notificación: ese día no es el de la cita.
const NOTICE_RE = /\b(?:notific\w*|llego|llegaron|llegou|chegou|chegoume|recib\w*|enviaron|mandaron|mandoume|entregaron)\b/;

// Todas las expresiones de día que trae el texto, con su posición.
function dayCandidates(t) {
  const out = [];
  const add = (index, raw, found) => out.push({ index, raw, found: { ...found, raw } });
  for (const m of t.matchAll(WRITTEN_DATE_RE)) add(m.index, m[0], { kind: 'date', d: Number(m[1]), m: MONTHS[m[2]], y: m[3] ? Number(m[3]) : null });
  for (const m of t.matchAll(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g)) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    add(m.index, m[0], { kind: 'date', d: Number(m[1]), m: Number(m[2]), y: year });
  }
  for (const m of t.matchAll(/\bdia (\d{1,2})\b(?! ?(?:de|[/:h]))/g)) add(m.index, m[0], { kind: 'daynum', d: Number(m[1]) });
  for (const m of t.matchAll(/\bpasado (?:manana|mana)\b|\bpasadomana\b/g)) add(m.index, m[0], { kind: 'offset', n: 2 });
  const ahead = new RegExp(`\\b(?:dentro de|en|daqui a|de aqui a|dende hoxe en) (\\d{1,2}|${NUM_RE}) (dias?|semanas?|meses|mes)\\b`, 'g');
  for (const m of t.matchAll(ahead)) {
    const n = toNumber(m[1]);
    if (/^dia/.test(m[2])) add(m.index, m[0], { kind: 'offset', n });
    else if (/^semana/.test(m[2])) add(m.index, m[0], { kind: 'offset', n: n * 7 });
    else add(m.index, m[0], { kind: 'months', n });
  }
  for (const m of t.matchAll(/\bhoy\b|\bhoxe\b/g)) add(m.index, m[0], { kind: 'offset', n: 0 });
  for (const m of t.matchAll(/(?<!pasado )\b(?:manana|mana)\b/g)) add(m.index, m[0], { kind: 'offset', n: 1 });
  for (const m of t.matchAll(/\banteayer\b|\bantonte\b/g)) add(m.index, m[0], { kind: 'offset', n: -2 });
  for (const m of t.matchAll(/\bayer\b|\bonte\b/g)) add(m.index, m[0], { kind: 'offset', n: -1 });
  for (const m of t.matchAll(/\b(?:la |a )?(?:semana|proxima semana) (?:que viene|que ven|proxima)\b|\b(?:la |a )?proxima semana\b/g)) add(m.index, m[0], { kind: 'nextweek' });
  for (const m of t.matchAll(/\b(?:el |o )?mes que (?:viene|ven)\b|\b(?:el |o )?proximo mes\b/g)) add(m.index, m[0], { kind: 'nextmonth' });
  for (const m of t.matchAll(new RegExp(`\\b${DAY_RE}\\b`, 'g'))) add(m.index, m[0], { kind: 'weekday', dow: WEEKDAYS[m[1]] });
  return out.sort((a, b) => a.index - b.index);
}

// Entre varias expresiones de día, la de la cita: la de destino («pasar al martes»), la que va
// junto a «cita» o «hueco», la última si pide un cambio, o la primera que no sea de la notificación.
export function findDay(t, today) {
  const all = dayCandidates(t);
  if (!all.length) return null;
  const target = t.match(new RegExp(`\\b(?:al|ao|para el|para o|pal) ${DAY_RE}\\b`));
  if (target) return { kind: 'weekday', dow: WEEKDAYS[target[1]] };
  // Un día que va con el verbo de la notificación («me notificaron el…», «el lunes me llegó…»)
  // cuenta cuándo llegó el aviso, no cuándo quiere la cita. Se mira solo la misma frase.
  const clause = (text) => text.split(/[.;?!]/);
  const isNotice = (c) => {
    const lead = clause(t.slice(Math.max(0, c.index - 40), c.index)).pop();
    const tail = clause(t.slice(c.index + c.raw.length, c.index + c.raw.length + 20))[0].slice(0, 14);
    return NOTICE_RE.test(lead) || NOTICE_RE.test(tail);
  };
  const usable = all.filter((c) => !isNotice(c));
  const bookings = [...t.matchAll(BOOKING_RE)];
  for (const booking of bookings) {
    const end = booking.index + booking[0].length;
    const after = usable.find((c) => c.index >= end && c.index - end <= 40);
    if (after) return after.found;
  }
  for (const booking of bookings) {
    const before = [...usable].reverse().find((c) => {
      const gap = t.slice(c.index + c.raw.length, booking.index);
      return c.index + c.raw.length <= booking.index && gap.length <= 14 && !/[.;?!]/.test(gap);
    });
    if (before) return before.found;
  }
  if (!usable.length) return null;
  const change = /\b(cambi\w*|pas[ae]\w*|mov\w*|aplaz\w*|adelant\w*|traslad\w*|mud\w*)\b/.test(t);
  return (change ? usable[usable.length - 1] : usable[0]).found;
}

export function resolveDay(found, today) {
  const base = today;
  if (found.kind === 'offset') return addDays(base, found.n);
  if (found.kind === 'months') {
    const index = base.m - 1 + found.n;
    const y = base.y + Math.floor(index / 12);
    const m = ((index % 12) + 12) % 12 + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { y, m, d: Math.min(base.d, last) };
  }
  const dowToday = new Date(Date.UTC(base.y, base.m - 1, base.d)).getUTCDay();
  if (found.kind === 'nextweek') return addDays(base, ((1 - dowToday + 7) % 7) || 7);
  if (found.kind === 'nextmonth') {
    const first = addDays({ y: base.y, m: base.m, d: 1 }, 32);
    const day = { y: first.y, m: first.m, d: 1 };
    const dow = new Date(Date.UTC(day.y, day.m - 1, 1)).getUTCDay();
    return dow === 6 ? addDays(day, 2) : dow === 0 ? addDays(day, 1) : day;
  }
  if (found.kind === 'weekday') {
    // El mismo día de la semana que hoy es el de la semana que viene.
    const delta = ((found.dow - dowToday + 7) % 7) || 7;
    return addDays(base, delta);
  }
  if (found.kind === 'daynum') {
    // «día 3» ya pasado este mes -> mes siguiente.
    const next = found.d < base.d ? addDays({ y: base.y, m: base.m, d: 1 }, 32) : base;
    return validDate(next.y, next.m, found.d) ? { y: next.y, m: next.m, d: found.d } : null;
  }
  // date
  if (!validDate(found.y ?? base.y, found.m, found.d)) return null;
  if (found.y) return { y: found.y, m: found.m, d: found.d };
  const thisYear = { y: base.y, m: found.m, d: found.d };
  const before = found.m < base.m || (found.m === base.m && found.d < base.d);
  return before ? { y: base.y + 1, m: found.m, d: found.d } : thisYear;
}
