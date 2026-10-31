// Textos de cara al cliente: fechas, horas e importes en castellano o gallego.
import { daysBetween, partsOf, todayYmd } from './avail.mjs';

export const L = (lang, es, gl) => (lang === 'gl' ? gl : es);
export const locale = (lang) => (lang === 'gl' ? 'gl-ES' : 'es-ES');

export function money(cents, lang = 'es') {
  return new Intl.NumberFormat(locale(lang), { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);
}

const fmt = (ymd, lang, opts) => {
  const { y, m, d } = partsOf(ymd);
  return new Intl.DateTimeFormat(locale(lang), { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, d, 12)));
};

// «sábado 17 de octubre»
export const dayLong = (ymd, lang = 'es') => fmt(ymd, lang, { weekday: 'long', day: 'numeric', month: 'long' }).replace(/,/g, '');
// «sáb 17 oct»
export const dayShort = (ymd, lang = 'es') => fmt(ymd, lang, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[.,]/g, '').replace(/ de /g, ' ');
export const weekdayName = (ymd, lang = 'es') => fmt(ymd, lang, { weekday: 'long' });

// «hoy», «mañana» o «el sábado 17 de octubre».
export function dayRel(ymd, lang, now = new Date()) {
  const delta = daysBetween(todayYmd(now), ymd);
  if (delta === 0) return L(lang, 'hoy', 'hoxe');
  if (delta === 1) return L(lang, 'mañana', 'mañá');
  return L(lang, `el ${dayLong(ymd, lang)}`, `o ${dayLong(ymd, lang)}`);
}

export function listJoin(items, lang = 'es') {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ${L(lang, 'y', 'e')} ${xs[xs.length - 1]}`;
}

export function weekRows(biz, lang = 'es') {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const names = {
    es: { mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo' },
    gl: { mon: 'Luns', tue: 'Martes', wed: 'Mércores', thu: 'Xoves', fri: 'Venres', sat: 'Sábado', sun: 'Domingo' },
  }[lang === 'gl' ? 'gl' : 'es'];
  const label = (d) => {
    const r = biz.hours[d] ?? [];
    return r.length ? r.map(([a, b]) => `${a.replace(/^0/, '')}–${b.replace(/^0/, '')}`).join(' · ') : L(lang, 'Cerrado', 'Pechado');
  };
  const rows = [];
  for (const d of order) {
    const last = rows[rows.length - 1];
    if (last && last.value === label(d)) last.days.push(d);
    else rows.push({ days: [d], value: label(d) });
  }
  return rows.map((r) => ({
    day: r.days.length > 1 ? `${names[r.days[0]]} a ${names[r.days[r.days.length - 1]].toLowerCase()}` : names[r.days[0]],
    days: r.days,
    value: r.value,
  }));
}

