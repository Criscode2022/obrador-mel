// Flujo de pedidos para recoger: productos reales de la carta, precio
// calculado por el motor, hora de recogida comprobada y, al final, un pedido PENDIENTE de que
// una persona del local lo confirme. Aquí nunca se confirma ni se cobra nada.
import {
  addDaysYmd, daysBetween, firstPickup, fmtTime, isoAt, nearestSlots, pickupAvailability, todayYmd,
} from './avail.mjs';
import { chipAction } from './ctx.mjs';
import { dayRel, dayShort, listJoin, money } from './format.mjs';
import { applyToCart, priceOrder } from './orders.mjs';

const MAX_CHIPS = 8;

const priced = (c) => priceOrder(c.catalog, c.state.order.lines);

function leadMinutes(c) {
  const prep = c.biz.order.prep_minutes ?? 10;
  const lead = Math.max(0, ...c.state.order.lines.map((l) => (c.catalog.byId.get(l.item_id)?.lead_hours ?? 0) * 60));
  return Math.max(prep, lead);
}

const horizonOf = (c) => c.biz.order.horizon_days ?? 1;

function pickupFor(c, ymd) {
  return pickupAvailability(c.biz, { ymd, now: c.now, leadMinutes: leadMinutes(c), own: c.own });
}

function spread(list, n) {
  if (list.length <= n) return list;
  const step = (list.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => list[Math.round(i * step)]);
}

const timeChips = (c, slots) => spread(slots, MAX_CHIPS).map((s) => chipAction(s.time, { type: 'set', field: 'pickup_time', value: s.time }));

export function orderCard(c, status = 'draft') {
  const o = c.state.order;
  const p = priced(c);
  const rows = [];
  if (o.ymd && o.min != null) {
    rows.push({ label: c.t('Recogida', 'Recollida'), value: `${dayRel(o.ymd, c.lang, c.now).replace(/^./, (x) => x.toUpperCase())}, ${fmtTime(o.min)}` });
  }
  if (o.name) rows.push({ label: c.t('A nombre de', 'A nome de'), value: o.name });
  if (o.phone) rows.push({ label: c.t('Teléfono', 'Teléfono'), value: o.phone });
  if (o.note) rows.push({ label: c.t('Notas', 'Notas'), value: o.note });
  return {
    type: 'order',
    status,
    title: c.t('Pedido para recoger', 'Pedido para recoller'),
    lines: p.lines.map((l, index) => ({
      index, item_id: l.item_id, name: l.name, qty: l.qty, option: l.option_label, unit_cents: l.unit_cents, total_cents: l.total_cents,
    })),
    total_cents: p.total_cents,
    rows,
    pay: c.biz.order.pay?.[c.lang === 'gl' ? 'gl' : 'es'] ?? '',
  };
}

function summaryLine(c) {
  const p = priced(c);
  const parts = p.lines.map((l) => `${l.qty} × ${l.name}${l.option_label ? ` (${l.option_label})` : ''}`);
  return c.t(`Apunto: ${listJoin(parts, c.lang)}. Total ${money(p.total_cents, c.lang)}.`, `Apunto: ${listJoin(parts, c.lang)}. Total ${money(p.total_cents, c.lang)}.`);
}

// ------------------------------------------------------------------------------ preguntas

function askItems(c, lead) {
  c.state.awaiting = 'items';
  const popular = c.catalog.items.filter((i) => i.popular).slice(0, 5);
  c.say({
    text: lead ?? c.biz.order.items_prompt?.[c.lang === 'gl' ? 'gl' : 'es'] ?? c.t('¿Qué te preparo? Escríbelo como quieras o elige.', '¿Que che preparo? Escríbeo como queiras ou elixe.'),
    chips: [
      ...popular.map((i) => chipAction(i.name, { type: 'add', item_id: i.id })),
    ],
  });
}

function askClarify(c) {
  const amb = c.state.clarify;
  c.state.awaiting = 'clarify';
  c.say({
    text: c.t(`¿Qué ${amb.name} quieres?`, `¿Que ${amb.name} queres?`),
    chips: amb.candidates.map((id) => {
      const it = c.catalog.byId.get(id);
      return chipAction(`${it.name} · ${money(it.price_cents, c.lang)}`, { type: 'pick', item_id: id });
    }),
  });
}

function askOption(c, line, group) {
  const opt = c.catalog.options[group];
  c.state.awaiting = 'option';
  c.state.pendingOption = { item_id: line.item_id, group };
  const item = c.catalog.byId.get(line.item_id);
  c.say({
    text: c.t(`${opt.question?.es ?? `${opt.name} de ${item.name}`}`, `${opt.question?.gl ?? `${opt.name} de ${item.name}`}`),
    chips: opt.choices.map((ch) => chipAction(`${ch.name}${ch.delta ? ` · +${money(Math.round(ch.delta * 100), c.lang)}` : ''}`, { type: 'option', item_id: line.item_id, group, choice: ch.id })),
  });
}

function askPickup(c) {
  const today = todayYmd(c.now);
  c.state.awaiting = 'pickup';
  const first = firstPickup(c.biz, { now: c.now, leadMinutes: leadMinutes(c), own: c.own });
  const lead = leadMinutes(c);
  // Productos con plazo (tartas por encargo): hay que elegir el día.
  if (lead >= 24 * 60) {
    const days = [];
    for (let i = 0; i <= horizonOf(c) && days.length < 6; i += 1) {
      const ymd = addDaysYmd(today, i);
      if (pickupFor(c, ymd).slots.length) days.push(ymd);
    }
    c.state.awaiting = 'pickup_date';
    return c.say({
      text: c.t(
        `Este pedido necesita ${Math.round(lead / 60)} horas de antelación. ¿Qué día lo recoges?`,
        `Este pedido necesita ${Math.round(lead / 60)} horas de antelación. ¿Que día o recollas?`,
      ),
      chips: days.map((ymd) => chipAction(dayShort(ymd, c.lang), { type: 'set', field: 'pickup_date', value: ymd })),
      evidence: [{ step: 'lead_time', ok: true, detail: `plazo mínimo ${Math.round(lead / 60)} h` }],
    });
  }
  if (!first) {
    c.state.awaiting = null;
    return c.say({
      text: c.t(`Ahora no puedo programar recogidas: ${c.biz.name} está cerrado y no hay huecos en los próximos días.`, `Agora non podo programar recollidas: ${c.biz.name} está pechado e non hai ocos nos próximos días.`),
    });
  }
  const soon = `${first.time}`;
  const sameDay = first.ymd === today;
  const slots = first.slots;
  c.say({
    text: sameDay
      ? c.t(`¿A qué hora lo recoges? Lo más pronto que puedo tenerlo listo es a las ${soon}.`, `¿A que hora o recolles? O máis cedo que podo telo listo é ás ${soon}.`)
      : c.t(`Ahora estamos cerrados. ¿Te lo dejo para ${dayRel(first.ymd, c.lang, c.now)}? La primera hora es ${soon}.`, `Agora estamos pechados. ¿Déixocho para ${dayRel(first.ymd, c.lang, c.now)}? A primeira hora é ${soon}.`),
    chips: [
      chipAction(c.t(`Lo antes posible · ${soon}`, `Canto antes · ${soon}`), { type: 'asap' }),
      ...timeChips(c, slots.filter((s) => s.min > first.min).slice(0, 7)),
    ].slice(0, MAX_CHIPS),
    evidence: [{ step: 'pickup', ok: true, detail: `${slots.length} huecos de recogida el ${first.ymd}; preparación mínima ${lead} min` }],
  });
}

function askName(c) {
  c.state.awaiting = 'name';
  c.say({ text: c.t('¿A nombre de quién lo preparo?', '¿A nome de quen o preparo?') });
}
function askPhone(c) {
  c.state.awaiting = 'phone';
  c.say({ text: c.t('¿Y un teléfono de contacto? Solo lo usará el local si hay algún problema con el pedido.', '¿E un teléfono de contacto? So o usará o local se hai algún problema co pedido.') });
}
function askNotes(c) {
  c.state.awaiting = 'notes';
  c.say({
    text: c.biz.order.notes_prompt?.[c.lang === 'gl' ? 'gl' : 'es'] ?? c.t('¿Alguna nota para el local? Si no, dime «no».', '¿Algunha nota para o local? Se non, dime «non».'),
    chips: [chipAction(c.t('Sin notas', 'Sen notas'), { type: 'notes', value: '' })],
  });
}

function recap(c) {
  c.state.awaiting = 'confirm';
  // Si este turno ya resumió lo apuntado, se junta con el resumen final: una sola tarjeta.
  const prev = c.replies[c.replies.length - 1];
  const lead = prev?.summary ? `${c.replies.pop().text} ` : '';
  c.say({
    text: lead + c.t(
      'Este es el pedido que enviaré al local. Una persona lo confirmará antes de prepararlo; hasta entonces no está confirmado.',
      'Este é o pedido que enviarei ao local. Unha persoa confirmarao antes de preparalo; ata entón non está confirmado.',
    ),
    cards: [orderCard(c, 'draft')],
    chips: [
      chipAction(c.t('Enviar pedido', 'Enviar pedido'), { type: 'confirm' }),
      chipAction(c.t('Añadir algo', 'Engadir algo'), { type: 'more' }),
      chipAction(c.t('Cambiar la hora', 'Cambiar a hora'), { type: 'reset', field: 'pickup' }),
    ],
  });
}

function finalize(c) {
  const o = c.state.order;
  const p = priced(c);
  c.state.awaiting = null;
  c.state.done = true;
  c.request = {
    kind: 'order',
    status: 'pending',
    slot_start: isoAt(o.ymd, o.min),
    slot_end: isoAt(o.ymd, o.min + 10),
    total_cents: p.total_cents,
    data: {
      lang: c.lang,
      lines: p.lines,
      count: p.count,
      ymd: o.ymd,
      time: fmtTime(o.min),
      min: o.min,
      name: o.name,
      phone: o.phone ?? '',
      note: o.note ?? '',
    },
  };
  c.request.data.card = orderCard(c, 'pending');
  c.say({
    text: c.t(
      `Hecho: he enviado tu pedido a ${c.biz.name}. Una persona lo confirmará y te avisaré aquí mismo; no lo prepararán hasta entonces.`,
      `Feito: enviei o teu pedido a ${c.biz.name}. Unha persoa confirmarao e avisareite aquí mesmo; non o prepararán ata entón.`,
    ),
    cards: [orderCard(c, 'pending')],
    evidence: [{ step: 'approval', ok: true, detail: 'pedido pendiente: la confirmación y el cobro son del local' }],
  });
  c.note('propose', true, `pedido pendiente de ${p.count} productos, ${p.total_cents} céntimos`);
}

// ------------------------------------------------------------------------------ recogida

// Fija la recogida con lo que dijo la persona y la comprueba contra los huecos reales.
function settlePickup(c) {
  const { signals: s, state } = c;
  const o = state.order;
  if (s.when.ymd) o.ymd = s.when.ymd;
  if (s.when.min != null) o.min = s.when.min;
  if (s.asap && !(s.when.min != null)) o.asap = true;
  if (s.when.relMin) o.rel = s.when.relMin;
  if (o.asap || o.rel) {
    const target = o.rel ? c.now.getTime() + o.rel * 60000 : c.now.getTime();
    o.asap = false;
    o.rel = null;
    for (let i = 0; i <= horizonOf(c); i += 1) {
      const ymd = addDaysYmd(todayYmd(c.now), i);
      const slot = pickupFor(c, ymd).slots.find((x) => Date.parse(isoAt(ymd, x.min)) >= target);
      if (slot) {
        o.ymd = ymd;
        o.min = slot.min;
        c.note('pickup', true, `recogida ${ymd} ${slot.time}`);
        return true;
      }
    }
    o.ymd = null;
    o.min = null;
    return false;
  }
  return true;
}

function verifyPickup(c) {
  const o = c.state.order;
  const today = todayYmd(c.now);
  if (o.min != null && !o.ymd) {
    if (leadMinutes(c) >= 24 * 60) return { need: 'date' };
    o.ymd = today;
  }
  if (!o.ymd) return { need: 'pickup' };
  if (daysBetween(today, o.ymd) > horizonOf(c)) {
    const bad = o.ymd;
    o.ymd = null;
    o.min = null;
    return { problem: 'too_far', ymd: bad };
  }
  const av = pickupFor(c, o.ymd);
  if (av.reason === 'closed' || av.reason === 'past') {
    const bad = o.ymd;
    o.ymd = null;
    o.min = null;
    return { problem: av.reason, ymd: bad };
  }
  if (!av.slots.length) {
    const bad = o.ymd;
    o.ymd = null;
    o.min = null;
    return { problem: leadMinutes(c) > (c.biz.order.prep_minutes ?? 10) ? 'lead' : 'full', ymd: bad };
  }
  if (o.min == null) return { need: 'pickup_time', av };
  const hit = av.slots.find((x) => x.min === o.min);
  if (hit) {
    c.note('pickup', true, `hueco de recogida libre ${o.ymd} ${fmtTime(o.min)}`);
    return { ok: true };
  }
  const asked = o.min;
  // Una hora que hoy ya pasó: se conserva para ofrecer el mismo hueco mañana.
  if (o.ymd === today && Date.parse(isoAt(today, asked)) <= c.now.getTime()) {
    o.ymd = null;
    return { problem: 'passed', av, asked };
  }
  o.min = null;
  return { problem: 'taken', av, asked };
}

// --------------------------------------------------------------------------------- flujo

function missingOption(c) {
  for (const line of c.state.order.lines) {
    const item = c.catalog.byId.get(line.item_id);
    for (const group of item.options) {
      const opt = c.catalog.options[group];
      if (opt.required && !line.options[group]) return { line, group };
    }
  }
  return null;
}

export function orderStep(c) {
  orderStepInner(c);
  const first = c.replies.find((r) => !r.summary) ?? c.replies[0];
  if (c.captured?.length && first?.text && ['pickup', 'pickup_date', 'items', 'clarify', 'option'].includes(c.state.awaiting)) {
    first.text = `${c.t('Anotado.', 'Anotado.')} ${first.text}`;
  }
}

function orderStepInner(c) {
  const { state, signals: s, biz } = c;
  const o = state.order;
  state.intent = 'order';
  let changed = false;

  // 1. Productos.
  const f = s.items;
  if (f.mode === 'remove') {
    const r = applyToCart(o.lines, { ...f, lines: [...f.lines, ...f.ambiguous.flatMap((a) => a.candidates.filter((id) => o.lines.some((l) => l.item_id === id)).slice(0, 1).map((id) => ({ item_id: id, qty: 1, options: {} })))] });
    if (r.removed.length) {
      o.lines = r.lines;
      changed = true;
      c.say({ text: c.t(`Quitado: ${listJoin(r.removed.map((id) => c.catalog.byId.get(id).name), c.lang)}.`, `Quitado: ${listJoin(r.removed.map((id) => c.catalog.byId.get(id).name), c.lang)}.`) });
    } else if (f.lines.length || f.ambiguous.length) {
      c.say({ text: c.t('Eso no estaba en tu pedido.', 'Iso non estaba no teu pedido.') });
    }
  } else if (f.lines.length) {
    const max = biz.order.max_items ?? 20;
    const next = applyToCart(o.lines, f);
    const count = next.lines.reduce((n, l) => n + l.qty, 0);
    if (count > max) {
      c.say({
        text: c.t(`Con ${count} unidades ya es un pedido grande (el máximo por aquí son ${max}). Lo gestiona una persona: llama al ${biz.phone} o pídeme que la avise.`, `Con ${count} unidades xa é un pedido grande (o máximo por aquí son ${max}). Xestiónao unha persoa: chama ao ${biz.phone} ou pídeme que a avise.`),
        chips: [chipAction(c.t('Avisar a una persona', 'Avisar a unha persoa'), { type: 'handoff' })],
      });
    } else {
      o.lines = next.lines;
      changed = true;
    }
  }
  if (o.touched) {
    changed = true;
    o.touched = false;
  }
  // Opciones sueltas («12 raciones») para lo que ya está en el pedido.
  for (const so of f.strayOptions ?? []) {
    const pend = state.pendingOption;
    for (const line of o.lines) {
      if (!c.catalog.byId.get(line.item_id)?.options.includes(so.group)) continue;
      if (pend && pend.group === so.group && line.item_id !== pend.item_id) continue;
      if (!line.options[so.group] || (pend && pend.group === so.group)) {
        line.options[so.group] = so.choice;
        changed = true;
        if (pend && pend.group === so.group) state.pendingOption = null;
      }
    }
  }
  for (const amb of f.ambiguous) {
    if (f.mode === 'remove') break;
    if (!state.queue.some((q) => q.key === amb.key) && state.clarify?.key !== amb.key) state.queue.push(amb);
  }
  if (f.unknown.length) {
    const wanted = f.unknown.slice(0, 2).map((w) => `«${w}»`);
    c.say({
      text: c.t(`No tengo ${listJoin(wanted, c.lang)} en la carta.`, `Non teño ${listJoin(wanted, c.lang)} na carta.`),
      chips: c.catalog.categories.slice(0, 4).map((cat) => chipAction(cat.name, { type: 'menu', category: cat.id })),
    });
  }

  // 2. Hora y contacto.
  const settled = settlePickup(c);
  c.captured = [];
  if (s.name && !o.name) c.captured.push('name');
  if (s.phone && !o.phone) c.captured.push('phone');
  if (s.name) o.name = s.name;
  if (s.phone) o.phone = s.phone;
  if (state.awaiting === 'notes') {
    if (s.no_notes || s.no) o.note = '';
    else if (s.text.trim() && s.when.min == null) o.note = s.text.replace(/^\s*(?:si|sí|vale|ok)[,.]?\s*/i, '').trim().slice(0, 240);
  }
  if (!settled) {
    return c.say({ text: c.t('No encuentro un hueco de recogida con ese plazo en los próximos días.', 'Non atopo un oco de recollida con ese prazo nos próximos días.') });
  }

  // 3. Aclarar productos ambiguos.
  if (!state.clarify && state.queue.length) state.clarify = state.queue.shift();
  if (changed && o.lines.length && !state.clarify) {
    c.say({ text: summaryLine(c), cards: [orderCard(c, 'draft')], summary: true });
  }
  if (state.clarify) return askClarify(c);

  // 4. Carrito vacío.
  if (!o.lines.length) return askItems(c);

  // 5. Opciones obligatorias.
  const missing = missingOption(c);
  if (missing) return askOption(c, missing.line, missing.group);

  // 6. Recogida.
  const check = verifyPickup(c);
  if (check.problem) {
    const near = check.av ? nearestSlots(check.av.slots, check.asked ?? 9 * 60, 3) : [];
    if (check.problem === 'lead' || check.problem === 'full') {
      const days = [];
      for (let i = 0; i <= horizonOf(c) && days.length < 6; i += 1) {
        const ymd = addDaysYmd(todayYmd(c.now), i);
        if (pickupFor(c, ymd).slots.length) days.push(ymd);
      }
      state.awaiting = 'pickup_date';
      const hours = Math.round(leadMinutes(c) / 60);
      return c.say({
        text: check.problem === 'lead'
          ? c.t(`${dayRel(check.ymd, c.lang, c.now)} no llego: este pedido necesita ${hours} horas de antelación. ¿Qué día te va bien?`.replace(/^./, (x) => x.toUpperCase()), `${dayRel(check.ymd, c.lang, c.now)} non chego: este pedido precisa ${hours} horas de antelación. ¿Que día che vai ben?`.replace(/^./, (x) => x.toUpperCase()))
          : c.t(`${dayRel(check.ymd, c.lang, c.now)} ya no quedan huecos. ¿Qué otro día te va bien?`.replace(/^./, (x) => x.toUpperCase()), `${dayRel(check.ymd, c.lang, c.now)} xa non quedan ocos. ¿Que outro día che vai ben?`.replace(/^./, (x) => x.toUpperCase())),
        chips: days.map((ymd) => chipAction(dayShort(ymd, c.lang), { type: 'set', field: 'pickup_date', value: ymd })),
        evidence: [{ step: 'lead_time', ok: false, detail: check.problem === 'lead' ? `plazo mínimo ${hours} h` : 'sin huecos ese día' }],
      });
    }
    const lead = check.problem === 'passed'
      ? c.t(`Las ${fmtTime(check.asked)} de hoy ya pasaron.`, `As ${fmtTime(check.asked)} de hoxe xa pasaron.`)
      : check.problem === 'taken'
        ? c.t(`A las ${fmtTime(check.asked)} no puedo tenerlo listo (o ya no quedan huecos).`, `Ás ${fmtTime(check.asked)} non podo telo listo (ou xa non quedan ocos).`)
        : check.problem === 'closed'
          ? c.t(`${dayRel(check.ymd, c.lang, c.now)} no abrimos.`.replace(/^./, (x) => x.toUpperCase()), `${dayRel(check.ymd, c.lang, c.now)} non abrimos.`.replace(/^./, (x) => x.toUpperCase()))
          : check.problem === 'too_far'
            ? c.t('Solo puedo programar recogidas con poca antelación.', 'So podo programar recollidas con pouca antelación.')
            : c.t('Ese momento ya pasó.', 'Ese momento xa pasou.');
    const tomorrow = addDaysYmd(todayYmd(c.now), 1);
    const chips = timeChips(c, near);
    if (check.problem === 'passed' && horizonOf(c) >= 1) {
      chips.push(chipAction(c.t(`Mañana · ${fmtTime(check.asked)}`, `Mañá · ${fmtTime(check.asked)}`), { type: 'set', field: 'pickup_date', value: tomorrow }));
    }
    if (chips.length) {
      state.awaiting = 'pickup';
      return c.say({ text: `${lead} ${c.t('¿Qué prefieres?', '¿Que prefires?')}`, chips, evidence: [{ step: 'pickup', ok: false, detail: lead }] });
    }
    return askPickup(c);
  }
  if (check.need === 'date' || check.need === 'pickup') return askPickup(c);
  if (check.need === 'pickup_time') {
    state.awaiting = 'pickup';
    const slots = check.av.slots;
    return c.say({
      text: c.t(`¿A qué hora lo recoges ${dayRel(o.ymd, c.lang, c.now)}?`, `¿A que hora o recolles ${dayRel(o.ymd, c.lang, c.now)}?`),
      chips: timeChips(c, slots),
      evidence: [{ step: 'pickup', ok: true, detail: `${slots.length} huecos el ${o.ymd}` }],
    });
  }

  // 7. Contacto y resumen.
  if (!o.name) return askName(c);
  if (biz.order.need_phone && !o.phone) return askPhone(c);
  if (biz.order.ask_notes && o.note === undefined) return askNotes(c);
  return recap(c);
}

export function orderConfirm(c) {
  const o = c.state.order;
  const check = o.lines.length && o.ymd && o.min != null && o.name ? verifyPickup(c) : { need: 'x' };
  if (!check.ok) return orderStep(c);
  return finalize(c);
}

export function orderMore(c) {
  askItems(c, c.t('¿Qué más quieres añadir?', '¿Que máis queres engadir?'));
}

