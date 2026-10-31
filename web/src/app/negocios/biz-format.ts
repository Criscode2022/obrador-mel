import { BizRequest } from './biz-types';

export const euro = (cents: number | null | undefined, from = false): string =>
  `${from ? 'desde ' : ''}${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((cents ?? 0) / 100)}`;

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const DAY_NAMES: Record<string, string> = {
  mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo',
};

export function ymdToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n, 12));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function dayLabel(ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function dayShort(ymd: string): string {
  const today = ymdToday();
  if (ymd === today) return 'Hoy';
  if (ymd === addDays(today, 1)) return 'Mañana';
  return dayLabel(ymd, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[.,]/g, '');
}

export function weekdayKey(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return DAY_KEYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

export const minToTime = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export interface StatusView {
  tone: 'wait' | 'ok' | 'bad' | 'info';
  label: string;
  short: string;
}

// Cómo se cuenta al cliente (y al local) el estado de una solicitud.
export function statusView(r: Pick<BizRequest, 'kind' | 'status'> | null): StatusView | null {
  if (!r) return null;
  const noun = r.kind === 'order' ? 'pedido' : r.kind === 'booking' ? 'solicitud' : 'mensaje';
  switch (r.status) {
    case 'pending':
      if (r.kind === 'handoff' || r.kind === 'question') return { tone: 'wait', label: 'Una persona del local te responderá aquí', short: 'Avisado' };
      return { tone: 'wait', label: `Tu ${noun} está pendiente: el local lo confirmará`, short: 'Pendiente' };
    case 'confirmed':
      return { tone: 'ok', label: r.kind === 'order' ? 'Pedido confirmado por el local' : 'Confirmada por el local', short: 'Confirmada' };
    case 'denied':
      return { tone: 'bad', label: 'El local no ha podido confirmarla', short: 'No confirmada' };
    case 'change_proposed':
      return { tone: 'info', label: 'El local propone otra hora', short: 'Cambio propuesto' };
    case 'answered':
      return r.kind === 'info' ? { tone: 'info', label: 'Respondido por el asistente', short: 'Respondida' } : { tone: 'ok', label: 'Respondido por el local', short: 'Respondida' };
    case 'reviewed':
      return { tone: 'ok', label: 'Revisada por el local', short: 'Revisada' };
    default:
      return null;
  }
}

// Horario semanal agrupado: «Lunes a jueves · 7:30–20:00».
export function hoursRows(hours: Record<string, [string, string][]>): { day: string; value: string; keys: string[] }[] {
  const label = (k: string) => {
    const r = hours[k] ?? [];
    return r.length ? r.map(([a, b]) => `${a.replace(/^0/, '')}–${b.replace(/^0/, '')}`).join(' y ') : 'Cerrado';
  };
  const rows: { keys: string[]; value: string }[] = [];
  for (const k of DAY_KEYS) {
    const last = rows[rows.length - 1];
    if (last && last.value === label(k)) last.keys.push(k);
    else rows.push({ keys: [k], value: label(k) });
  }
  return rows.map((r) => ({
    keys: r.keys,
    value: r.value,
    day: r.keys.length > 1 ? `${DAY_NAMES[r.keys[0]]} a ${DAY_NAMES[r.keys[r.keys.length - 1]].toLowerCase()}` : DAY_NAMES[r.keys[0]],
  }));
}

export const TAG_LABEL: Record<string, string> = {
  vegano: 'Vegano', vegetariano: 'Vegetariano', sin_gluten: 'Sin gluten', sin_lactosa: 'Sin lactosa', sin_azucar: 'Sin azúcar',
};
export const ALLERGEN_LABEL: Record<string, string> = {
  gluten: 'gluten', crustaceos: 'crustáceos', huevos: 'huevo', pescado: 'pescado', cacahuetes: 'cacahuetes', soja: 'soja',
  lacteos: 'lácteos', frutos_secos: 'frutos secos', apio: 'apio', mostaza: 'mostaza', sesamo: 'sésamo', sulfitos: 'sulfitos',
  altramuces: 'altramuces', moluscos: 'moluscos',
};
