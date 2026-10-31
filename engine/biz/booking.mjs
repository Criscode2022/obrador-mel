// Flujo de reservas de mesa y de citas con profesional: se recogen los datos que faltan de uno
// en uno, se comprueba la disponibilidad en el motor y, con todo claro, se deja una solicitud
// PENDIENTE para que la confirme una persona del local. Aquí nunca se confirma nada.
import {
  addDaysYmd, dayRanges, daysBetween, fmtTime, isoAt, nearestSlots, staffAvailability, tableAvailability, tableDuration, todayYmd, windowProblem,
} from './avail.mjs';
import { chipAction, identity } from './ctx.mjs';
import { weekendDays } from './dates.mjs';
import { L, dayLong, dayRel, dayShort, money } from './format.mjs';

const MAX_SLOT_CHIPS = 8;

const isStaff = (c) => c.biz.booking.mode === 'staff';
const partOk = (part, min) => {
  if (!part) return true;
  if (part === 'morning') return min < 13 * 60;
  if (part === 'lunch') return min >= 12 * 60 && min < 17 * 60;
  if (part === 'afternoon') return min >= 15 * 60;
  if (part === 'dinner' || part === 'night') return min >= 19 * 60 + 30;
  return true;
};

function servicesOf(c) {
  return (c.state.booking.services ?? []).map((id) => c.catalog.byId.get(id)).filter(Boolean);
}
const durationOf = (c) => servicesOf(c).reduce((n, s) => n + (s.duration ?? 30), 0);
const priceOf = (c) => servicesOf(c).reduce((n, s) => n + s.price_cents, 0);

function availability(c, ymd) {
  const b = c.state.booking;
  if (isStaff(c)) {
    return staffAvailability(c.biz, {
      ymd, duration: durationOf(c) || 30, serviceIds: b.services ?? [], resourceId: b.resource && b.resource !== 'any' ? b.resource : null, now: c.now, own: c.own,
    });
  }
  return tableAvailability(c.biz, { ymd, party: b.party ?? 2, now: c.now, own: c.own });
}

// Días con hueco para lo que se pide, a partir de hoy.
function openDays(c, n = 6) {
  const out = [];
  const today = todayYmd(c.now);
  const horizon = c.biz.booking.horizon_days ?? 30;
  for (let i = 0; i <= horizon && out.length < n; i += 1) {
    const ymd = addDaysYmd(today, i);
    if (!dayRanges(c.biz, ymd).length) continue;
    const av = availability(c, ymd);
    if (av.slots.length) out.push({ ymd, count: av.slots.length });
  }
  return out;
}

function dayChips(c, days) {
  return days.map(({ ymd }) => {
    const delta = daysBetween(todayYmd(c.now), ymd);
    const label = delta === 0 ? L(c.lang, 'Hoy', 'Hoxe') : delta === 1 ? L(c.lang, 'Mañana', 'Mañá') : dayShort(ymd, c.lang);
    return chipAction(label, { type: 'set', field: 'date', value: ymd });
  });
}

function spread(list, n) {
  if (list.length <= n) return list;
  const step = (list.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => list[Math.round(i * step)]);
}

function slotChips(c, slots) {
  const staff = isStaff(c);
  return spread(slots, MAX_SLOT_CHIPS).map((s) => chipAction(
    staff && c.biz.booking.resources.length > 1 ? `${s.time} · ${s.resource.name}` : s.time,
    { type: 'set', field: 'time', value: s.time, ...(staff ? { resource: s.resource.id } : {}) },
  ));
}

// ------------------------------------------------------------------------------ preguntas

function askParty(c) {
  c.state.awaiting = 'party';
  const max = c.biz.booking.party?.max ?? 8;
  c.say({
    text: c.t('¿Para cuántas personas?', '¿Para cantas persoas?'),
    chips: [1, 2, 3, 4, 5, 6].filter((n) => n <= max).map((n) => chipAction(
      n === 1 ? c.t('1 persona', '1 persoa') : c.t(`${n} personas`, `${n} persoas`), { type: 'set', field: 'party', value: n },
    )),
  });
}

function askDate(c, lead = '') {
  c.state.awaiting = 'date';
  const days = openDays(c, 6);
  const staff = isStaff(c);
  const text = lead || (staff
    ? c.t('¿Qué día te viene bien?', '¿Que día che vén ben?')
    : c.t('¿Qué día queréis venir?', '¿Que día queredes vir?'));
  c.say({
    text,
    chips: days.length ? dayChips(c, days) : [],
    evidence: days.length ? [{ step: 'availability', ok: true, detail: `próximos días con hueco: ${days.map((d) => d.ymd).join(', ')}` }] : [],
  });
}

function askService(c) {
  c.state.awaiting = 'service';
  const items = c.catalog.items.filter((i) => i.duration != null);
  const featured = items.filter((i) => i.popular).slice(0, 6);
  const list = featured.length ? featured : items.slice(0, 6);
  c.say({
    text: c.t('¿Qué te gustaría reservar? Puedes escribirlo («corte y barba») o elegir uno.', '¿Que che gustaría reservar? Podes escribilo («corte e barba») ou elixir un.'),
    chips: list.map((i) => chipAction(i.name, { type: 'set', field: 'service', value: i.id })),
  });
}

function askName(c) {
  c.state.awaiting = 'name';
  c.say({ text: isStaff(c) ? c.t('¿A nombre de quién apunto la cita?', '¿A nome de quen apunto a cita?') : c.t('¿A nombre de quién pongo la reserva?', '¿A nome de quen poño a reserva?') });
}

function askPhone(c) {
  c.state.awaiting = 'phone';
  c.say({ text: c.t('Y un teléfono de contacto, por si el local necesita avisarte.', 'E un teléfono de contacto, por se o local necesita avisarte.') });
}

function askNotes(c) {
  c.state.awaiting = 'notes';
  c.say({
    text: c.biz.booking.notes_prompt?.[c.lang === 'gl' ? 'gl' : 'es'] ?? c.t('¿Algo que debamos saber? Alergias, trona, una celebración... Si no, dime «no».', '¿Algo que debamos saber? Alerxias, trona, unha celebración... Se non, dime «non».'),
    chips: [chipAction(c.t('Sin notas', 'Sen notas'), { type: 'notes', value: '' })],
  });
}

// ------------------------------------------------------------------------------- resumen

export function bookingCard(c, status = 'draft') {
  const b = c.state.booking;
  const staff = isStaff(c);
  const rows = [];
  if (staff) {
    rows.push({ label: c.t('Servicio', 'Servizo'), value: servicesOf(c).map((s) => s.name).join(' + ') });
    rows.push({ label: c.t('Día', 'Día'), value: dayLong(b.ymd, c.lang) });
    rows.push({ label: c.t('Hora', 'Hora'), value: `${fmtTime(b.min)} · ${durationOf(c)} min` });
    if (b.resource_name) rows.push({ label: c.t('Con', 'Con'), value: b.resource_name });
    rows.push({ label: c.t('Importe orientativo', 'Importe orientativo'), value: `${servicesOf(c).some((s) => s.price_from) ? c.t('desde ', 'desde ') : ''}${money(priceOf(c), c.lang)}` });
  } else {
    rows.push({ label: c.t('Día', 'Día'), value: dayLong(b.ymd, c.lang) });
    rows.push({ label: c.t('Hora', 'Hora'), value: fmtTime(b.min) });
    rows.push({ label: c.t('Personas', 'Persoas'), value: String(b.party) });
  }
  rows.push({ label: c.t('A nombre de', 'A nome de'), value: b.name });
  if (b.phone) rows.push({ label: c.t('Teléfono', 'Teléfono'), value: b.phone });
  if (b.note) rows.push({ label: c.t('Notas', 'Notas'), value: b.note });
  return { type: 'booking', status, title: staff ? c.t('Cita', 'Cita') : c.t('Reserva de mesa', 'Reserva de mesa'), rows };
}

function recap(c) {
  c.state.awaiting = 'confirm';
  c.say({
    text: isStaff(c)
      ? c.t('Esto es lo que enviaré al local. Una persona lo confirmará; hasta entonces no es una cita.', 'Isto é o que enviarei ao local. Unha persoa confirmarao; ata entón non é unha cita.')
      : c.t('Esto es lo que enviaré al local. Una persona lo confirmará; hasta entonces no es una reserva.', 'Isto é o que enviarei ao local. Unha persoa confirmarao; ata entón non é unha reserva.'),
    cards: [bookingCard(c, 'draft')],
    chips: [
      chipAction(c.t('Enviar al local', 'Enviar ao local'), { type: 'confirm' }),
      chipAction(c.t('Cambiar algo', 'Cambiar algo'), { type: 'edit' }),
    ],
  });
}

function finalize(c) {
  const b = c.state.booking;
  const staff = isStaff(c);
  const duration = staff ? durationOf(c) : tableDuration(c.biz.booking, b.party);
  const start = isoAt(b.ymd, b.min);
  const end = isoAt(b.ymd, b.min + duration);
  c.state.awaiting = null;
  c.state.done = true;
  c.request = {
    kind: 'booking',
    status: 'pending',
    slot_start: start,
    slot_end: end,
    total_cents: staff ? priceOf(c) : null,
    data: {
      lang: c.lang,
      mode: c.biz.booking.mode,
      party: b.party ?? null,
      ymd: b.ymd,
      time: fmtTime(b.min),
      min: b.min,
      duration,
      seats: b.seats ?? null,
      resource: b.resource && b.resource !== 'any' ? { id: b.resource, name: b.resource_name ?? '' } : null,
      services: servicesOf(c).map((s) => ({ id: s.id, name: s.name, duration: s.duration, price_cents: s.price_cents, price_from: Boolean(s.price_from) })),
      name: b.name,
      phone: b.phone ?? '',
      note: b.note ?? '',
    },
  };
  c.request.data.card = bookingCard(c, 'pending');
  c.say({
    text: staff
      ? c.t(
        `Hecho: he enviado tu solicitud a ${c.biz.name}. Una persona la confirmará y te avisaré aquí mismo; hasta entonces la cita no está confirmada.`,
        `Feito: enviei a túa solicitude a ${c.biz.name}. Unha persoa confirmarana e avisareite aquí mesmo; ata entón a cita non está confirmada.`,
      )
      : c.t(
        `Hecho: he enviado tu solicitud a ${c.biz.name}. Una persona la confirmará y te avisaré aquí mismo; hasta entonces la reserva no está confirmada.`,
        `Feito: enviei a túa solicitude a ${c.biz.name}. Unha persoa confirmarana e avisareite aquí mesmo; ata entón a reserva non está confirmada.`,
      ),
    cards: [bookingCard(c, 'pending')],
    evidence: [{ step: 'approval', ok: true, detail: 'solicitud pendiente: nada se confirma sin una persona (sin Calendar.create hasta aprobar)' }],
  });
  c.note('propose', true, 'solicitud de reserva pendiente de aprobación');
}

// ---------------------------------------------------------------------- comprobaciones

function explainWindow(c, problem, ymd) {
  const horizon = c.biz.booking.horizon_days ?? 30;
  if (problem === 'past') return c.t('Ese día ya pasó.', 'Ese día xa pasou.');
  if (problem === 'too_far') return c.t(`Solo reservo con un máximo de ${horizon} días de antelación.`, `So reservo cun máximo de ${horizon} días de antelación.`);
  if (problem === 'closed') {
    const holiday = (c.biz.closed_dates ?? []).includes(ymd);
    return holiday
      ? c.t(`${dayRel(ymd, c.lang, c.now)} es festivo y cerramos.`.replace(/^./, (x) => x.toUpperCase()), `${dayRel(ymd, c.lang, c.now)} é festivo e pechamos.`.replace(/^./, (x) => x.toUpperCase()))
      : c.t(`${dayRel(ymd, c.lang, c.now)} no abrimos.`.replace(/^./, (x) => x.toUpperCase()), `${dayRel(ymd, c.lang, c.now)} non abrimos.`.replace(/^./, (x) => x.toUpperCase()));
  }
  return '';
}

// Una vez conocidos día y hora: ¿hay sitio?
function verifySlot(c) {
  const b = c.state.booking;
  const av = availability(c, b.ymd);
  const exact = av.slots.find((s) => s.min === b.min);
  if (exact) {
    if (isStaff(c)) {
      b.resource = b.resource && b.resource !== 'any' ? b.resource : exact.resource.id;
      b.resource_name = (c.biz.booking.resources.find((r) => r.id === b.resource) ?? exact.resource).name;
    } else {
      b.seats = exact.seats;
    }
    c.note('availability', true, `${b.ymd} ${fmtTime(b.min)}: hueco libre${exact.scarce ? ' (último)' : ''}`);
    return { ok: true, slot: exact, av };
  }
  c.note('availability', false, `${b.ymd} ${fmtTime(b.min)}: sin hueco`);
  return { ok: false, av };
}

function whoFor(c) {
  const b = c.state.booking;
  return isStaff(c) ? '' : (b.party === 1 ? c.t(' para 1 persona', ' para 1 persoa') : c.t(` para ${b.party}`, ` para ${b.party}`));
}

function offerAlternatives(c, av, lead) {
  const b = c.state.booking;
  c.state.awaiting = 'time';
  const slots = av.slots.filter((s) => partOk(b.part, s.min));
  // Mismo turno (comida o cena) si hay hueco; si no, lo más cercano del día.
  const target = b.min ?? 20 * 60;
  const sameService = slots.filter((s) => Math.abs(s.min - target) <= 150);
  const near = slots.length ? nearestSlots(sameService.length ? sameService : slots, target, 4) : [];
  if (near.length) {
    c.say({
      text: `${lead} ${c.t('Lo más cercano:', 'O máis próximo:')}`.trim(),
      chips: slotChips(c, near),
      evidence: [{ step: 'availability', ok: true, detail: `${av.slots.length} huecos el ${b.ymd}` }],
    });
    return;
  }
  // Ese día no hay nada: los siguientes días con hueco.
  const days = openDays(c, 4);
  b.min = null;
  b.ymd = null;
  c.state.awaiting = 'date';
  c.say({
    text: `${lead} ${days.length ? c.t('Estos días sí tengo hueco:', 'Estes días si teño oco:') : c.t(`No veo huecos en los próximos días; llama al ${c.biz.phone}.`, `Non vexo ocos nos próximos días; chama ao ${c.biz.phone}.`)}`.replace(/\s+/g, ' ').trim(),
    chips: dayChips(c, days),
  });
}

// ------------------------------------------------------------------------------- fusión

function merge(c) {
  const { signals: s, state, biz } = c;
  const b = state.booking;
  const staff = isStaff(c);
  if (s.party != null && !staff) b.party = s.party;
  if (s.when.ymd) b.ymd = s.when.ymd;
  if (s.when.min != null) {
    b.min = s.when.min;
    b.part = null;
  } else if (s.when.part) {
    b.part = s.when.part;
  }
  if (staff) {
    const ids = [...new Set(s.items.lines.map((l) => l.item_id))].filter((id) => c.catalog.byId.get(id)?.duration != null);
    if (ids.length) {
      const adds = /\b(?:y tambien|ademas|tambien|mas|y)\b/.test(s.norm) && b.services?.length && state.awaiting !== 'service';
      b.services = adds ? [...new Set([...b.services, ...ids])] : ids;
    }
    for (const amb of s.items.ambiguous) {
      if (!state.queue.some((q) => q.key === amb.key) && state.clarify?.key !== amb.key) state.queue.push(amb);
    }
    if (s.resource && s.resource !== 'any') {
      b.resource = s.resource;
      b.resource_name = biz.booking.resources.find((r) => r.id === s.resource)?.name ?? '';
    } else if (s.resource === 'any') {
      b.resource = 'any';
      b.resource_name = '';
    }
  }
  c.captured = [];
  if (s.name && !b.name) c.captured.push('name');
  if (s.phone && !b.phone) c.captured.push('phone');
  if (s.name) b.name = s.name;
  if (s.phone) b.phone = s.phone;
  if (state.awaiting === 'notes') {
    if (s.no_notes || s.no) b.note = '';
    else if (s.text.trim() && s.when.min == null) b.note = s.text.replace(/^\s*(?:si|sí|vale|ok)[,.]?\s*/i, '').trim().slice(0, 240);
  }
}

// -----------------------------------------------------------------------------------------

export function bookingStep(c) {
  bookingStepInner(c);
  // Si en este turno se ha anotado un dato suelto (nombre, teléfono), se dice antes de seguir preguntando.
  const first = c.replies[0];
  if (c.captured?.length && first?.text && ['party', 'date', 'time', 'service', 'clarify'].includes(c.state.awaiting)) {
    first.text = `${c.t('Anotado.', 'Anotado.')} ${first.text}`;
  }
}

function bookingStepInner(c) {
  const { state, biz, signals: s } = c;
  const b = state.booking;
  const cfg = biz.booking;
  state.intent = 'booking';
  merge(c);

  // El día se entiende a medias.
  if (s.when.invalid_day) {
    b.ymd = null;
    return askDate(c, c.t('No he entendido esa fecha. ¿Qué día es?', 'Non entendín esa data. ¿Que día é?'));
  }
  if (s.when.ambiguous === 'weekend' || s.when.ambiguous === 'next_week') {
    const days = s.when.ambiguous === 'weekend'
      ? weekendDays(c.now).filter((d) => dayRanges(biz, d).length).map((ymd) => ({ ymd }))
      : openDays(c, 7).filter((d) => daysBetween(todayYmd(c.now), d.ymd) >= 2);
    state.awaiting = 'date';
    return c.say({ text: c.t('¿Qué día exactamente?', '¿Que día exactamente?'), chips: dayChips(c, days) });
  }

  // Grupos grandes: lo lleva una persona.
  if (!isStaff(c) && b.party) {
    const over = cfg.party?.handoff_over ?? cfg.party?.max;
    if (b.party > over) {
      state.awaiting = null;
      state.done = true;
      c.request = {
        kind: 'handoff', status: 'pending', slot_start: null, slot_end: null, total_cents: null,
        data: { lang: c.lang, reason: 'group', party: b.party, ymd: b.ymd ?? null, time: b.min != null ? fmtTime(b.min) : null, text: s.text.slice(0, 280) },
      };
      return c.say({
        text: c.t(
          `Para ${b.party} personas lo gestiona directamente una persona del local, porque hay que preparar mesas y menú. Le paso tu mensaje y te responderá aquí. ${identity('es')}`,
          `Para ${b.party} persoas xestiónao directamente unha persoa do local, porque hai que preparar mesas e menú. Pásolle a túa mensaxe e responderache aquí. ${identity('gl')}`,
        ),
        evidence: [{ step: 'policy', ok: true, detail: `grupo de ${b.party} > ${over}: pasa a una persona` }],
      });
    }
    if (b.party < (cfg.party?.min ?? 1)) {
      b.party = null;
      return askParty(c);
    }
  }

  // Fecha fuera de ventana.
  if (b.ymd) {
    const problem = windowProblem(biz, cfg, b.ymd, c.now);
    if (problem) {
      const lead = explainWindow(c, problem, b.ymd);
      b.ymd = null;
      b.min = null;
      return askDate(c, `${lead} ${c.t('¿Qué otro día te va bien?', '¿Que outro día che vai ben?')}`);
    }
  }

  // Aclarar un servicio ambiguo («corte»).
  if (isStaff(c) && !state.clarify && state.queue.length) {
    state.clarify = state.queue.shift();
  }
  if (isStaff(c) && state.clarify) {
    const amb = state.clarify;
    state.awaiting = 'clarify';
    return c.say({
      text: c.t(`¿Qué ${amb.name} exactamente?`, `¿Que ${amb.name} exactamente?`),
      chips: amb.candidates.map((id) => {
        const it = c.catalog.byId.get(id);
        return chipAction(`${it.name} · ${it.price_from ? c.t('desde ', 'desde ') : ''}${money(it.price_cents, c.lang)}`, { type: 'pick', item_id: id });
      }),
    });
  }

  // Siguiente dato que falta.
  const need = nextNeed(c);
  if (need === 'party') return askParty(c);
  if (need === 'service') return askService(c);
  if (need === 'date') return askDate(c);

  if (need === 'time' || b.min != null) {
    if (b.min == null) {
      const av = availability(c, b.ymd);
      const slots = av.slots.filter((x) => partOk(b.part, x.min));
      if (!slots.length) return offerAlternatives(c, av, c.t(`${dayRel(b.ymd, c.lang, c.now)} no me queda hueco${whoFor(c)}.`.replace(/^./, (x) => x.toUpperCase()), `${dayRel(b.ymd, c.lang, c.now)} non me queda oco${whoFor(c)}.`.replace(/^./, (x) => x.toUpperCase())));
      state.awaiting = 'time';
      const lead = isStaff(c)
        ? c.t(`${durationNote(c)}Estas son las horas libres ${dayRel(b.ymd, c.lang, c.now)}:`, `${durationNote(c)}Estas son as horas libres ${dayRel(b.ymd, c.lang, c.now)}:`)
        : c.t(`Para ${b.party} ${dayRel(b.ymd, c.lang, c.now)} tengo mesa a estas horas:`, `Para ${b.party} ${dayRel(b.ymd, c.lang, c.now)} teño mesa a estas horas:`);
      return c.say({
        text: lead,
        chips: slotChips(c, slots),
        evidence: [{ step: 'availability', ok: true, detail: `${slots.length} huecos libres el ${b.ymd}${b.part ? ` (${b.part})` : ''}` }],
      });
    }
    const check = verifySlot(c);
    if (!check.ok) {
      const ranges = dayRanges(biz, b.ymd);
      const inside = ranges.some(([x, y]) => b.min >= x && b.min < y);
      const asked = fmtTime(b.min);
      const lead = !inside
        ? c.t(`A las ${asked} no hay servicio ${dayRel(b.ymd, c.lang, c.now)} (${ranges.map(([x, y]) => `${fmtTime(x)}–${fmtTime(y)}`).join(' y ')}).`, `Ás ${asked} non hai servizo ${dayRel(b.ymd, c.lang, c.now)} (${ranges.map(([x, y]) => `${fmtTime(x)}–${fmtTime(y)}`).join(' e ')}).`)
        : c.t(`${dayRel(b.ymd, c.lang, c.now)} a las ${asked} ya no me queda hueco${whoFor(c)}.`.replace(/^./, (x) => x.toUpperCase()), `${dayRel(b.ymd, c.lang, c.now)} ás ${asked} xa non me queda oco${whoFor(c)}.`.replace(/^./, (x) => x.toUpperCase()));
      b.min = null;
      return offerAlternatives(c, check.av, lead);
    }
  }

  const after = nextNeed(c);
  if (after === 'name') return askName(c);
  if (after === 'phone') return askPhone(c);
  if (after === 'notes') return askNotes(c);
  return recap(c);
}

function durationNote(c) {
  const list = servicesOf(c);
  if (!list.length) return '';
  const name = list.map((s) => s.name).join(' + ');
  return c.t(`${name}: ${durationOf(c)} min. `, `${name}: ${durationOf(c)} min. `);
}

function nextNeed(c) {
  const b = c.state.booking;
  const cfg = c.biz.booking;
  if (isStaff(c)) {
    if (!b.services?.length) return 'service';
  } else if (!b.party) return 'party';
  if (!b.ymd) return 'date';
  if (b.min == null) return 'time';
  if (!b.name) return 'name';
  if (cfg.need_phone && !b.phone) return 'phone';
  if (cfg.ask_notes && b.note === undefined) return 'notes';
  return 'confirm';
}

// Confirmar: solo si todo está completo y el hueco sigue libre.
export function bookingConfirm(c) {
  if (nextNeed(c) !== 'confirm') return bookingStep(c);
  const check = verifySlot(c);
  if (!check.ok) {
    const b = c.state.booking;
    b.min = null;
    return offerAlternatives(c, check.av, c.t('Ese hueco se acaba de ocupar.', 'Ese oco acaba de ocuparse.'));
  }
  return finalize(c);
}

export function bookingEdit(c) {
  c.state.awaiting = 'edit';
  const staff = isStaff(c);
  c.say({
    text: c.t('¿Qué quieres cambiar?', '¿Que queres cambiar?'),
    chips: [
      chipAction(c.t('El día', 'O día'), { type: 'reset', field: 'date' }),
      chipAction(c.t('La hora', 'A hora'), { type: 'reset', field: 'time' }),
      ...(staff ? [chipAction(c.t('El servicio', 'O servizo'), { type: 'reset', field: 'service' })] : [chipAction(c.t('Las personas', 'As persoas'), { type: 'reset', field: 'party' })]),
    ],
  });
}

