// Un turno de conversación con un negocio: lee el mensaje (o el botón pulsado), decide qué toca
// (preguntar, reservar, pedir, avisar a una persona, rechazar) y devuelve lo que se le dice a la
// persona, el estado de la conversación y, si procede, una solicitud pendiente de aprobación.
// Es una función pura salvo la consulta al conocimiento del negocio, que se inyecta.
import { bookingConfirm, bookingEdit, bookingStep } from './booking.mjs';
import { chipText, freshState, identity, makeCtx, neutralSignals } from './ctx.mjs';
import { answerMenu, infoReplies } from './info.mjs';
import { analyze, extractName, hasExtraQuestion } from './nlu.mjs';
import { orderConfirm, orderMore, orderStep } from './ordering.mjs';
import { applyToCart } from './orders.mjs';
import { toMin } from './store.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));

const quickChips = (c, n = 3) => (c.biz.assistant?.quick_actions ?? []).slice(0, n).map((q) => chipText(q.label, q.text));

const midFlow = (c) => ['booking', 'order'].includes(c.state.intent) && !c.state.done;

function resetFlow(state) {
  state.intent = null;
  state.awaiting = null;
  state.clarify = null;
  state.queue = [];
  state.booking = {};
  state.order = { lines: [] };
  state.pendingOption = null;
}

function runFlow(c) {
  if (c.state.intent === 'order') return orderStep(c);
  return bookingStep(c);
}

// El flujo vuelve a preguntar lo que falta, sin leer nada nuevo del mensaje.
function reprompt(c) {
  c.signals = neutralSignals(c.lang);
  runFlow(c);
}

// ------------------------------------------------------------------------------ rechazos

function handoffRequest(c, reason, extra = {}) {
  c.state.done = true;
  c.state.awaiting = null;
  c.request = {
    kind: 'handoff',
    status: 'pending',
    slot_start: null,
    slot_end: null,
    total_cents: null,
    data: { lang: c.lang, reason, text: c.signals.text.slice(0, 280), ...extra },
  };
}

function startHandoff(c, reason = 'person') {
  handoffRequest(c, reason);
  c.say({
    text: c.t(
      `Se lo paso a una persona de ${c.biz.name}: te responderá aquí mismo. Si es urgente, llama al ${c.biz.phone}. ${identity('es')}`,
      `Pásollo a unha persoa de ${c.biz.name}: responderache aquí mesmo. Se é urxente, chama ao ${c.biz.phone}. ${identity('gl')}`,
    ),
    evidence: [{ step: 'handoff', ok: true, detail: `pasa a una persona (${reason})` }],
  });
}

function refuse(c) {
  const r = c.signals.refusal;
  c.refused = true;
  c.note('refuse', true, `rechazo: ${r.id}`);
  if (r.id === 'card') {
    c.redacted = true;
    return c.say({
      text: c.t('Por seguridad, no escribas datos de tarjeta por aquí: no los necesito ni los guardo (los he tapado en el chat). El pago se hace en el local.',
        'Por seguridade, non escribas datos de tarxeta por aquí: non os necesito nin os gardo (tapeinos no chat). O pago faise no local.',
      ),
      chips: quickChips(c, 2),
    });
  }
  if (r.id === 'injection') {
    return c.say({
      text: c.t(`No puedo cambiar mis reglas ni compartir mis instrucciones. Sí puedo ayudarte con ${c.biz.name}: la carta, los horarios o dejarte algo preparado. ${identity('es')}`,
        `Non podo cambiar as miñas regras nin compartir as miñas instrucións. Si podo axudarte con ${c.biz.name}: a carta, os horarios ou deixarche algo preparado. ${identity('gl')}`,
      ),
      chips: quickChips(c, 3),
    });
  }
  if (r.id === 'abuse') {
    return c.say({
      text: c.t(`Prefiero que hablemos con respeto. Si lo prefieres, una persona de ${c.biz.name} te atiende en el ${c.biz.phone}.`,
        `Prefiro que falemos con respecto. Se o prefires, unha persoa de ${c.biz.name} atendete no ${c.biz.phone}.`,
      ),
    });
  }
  const text = r.reply?.[c.lang === 'gl' ? 'gl' : 'es'] ?? r.reply?.es ?? '';
  if (r.handoff) handoffRequest(c, r.id);
  return c.say({
    text,
    // Una urgencia no lleva botones: solo el aviso.
    chips: r.id === 'urgency' ? [] : quickChips(c, 3),
    evidence: [{ step: 'policy', ok: true, detail: `política del negocio: ${r.id}` }],
  });
}

// --------------------------------------------------------------------------------- información

async function infoStep(c, { interrupt = false } = {}) {
  const { signals: s, biz, catalog } = c;
  // «¿y el domingo?» tras hablar del horario sigue siendo del horario.
  if (!s.topic && c.state.last.topic === 'hours' && s.when.ymd) {
    s.topic = 'hours';
    s.topics = ['hours'];
  }
  const direct = infoReplies({ biz, catalog, lang: c.lang, signals: s, now: c.now });
  if (direct.length) {
    const withChips = ['menu', 'price'].includes(s.topic) || s.diet.avoid.length > 0 || s.diet.tags.length > 0;
    direct.forEach((r, i) => c.say({ ...r, chips: r.chips ?? (withChips && i === direct.length - 1 ? followUps(c) : []) }));
    c.state.last.topic = s.topic ?? 'info';
    c.note('answer', true, direct.length > 1 ? `${direct.length} respuestas calculadas con los datos del negocio` : 'respuesta calculada con los datos del negocio');
    // Una pregunta más que los datos no cubren: la completa la búsqueda, sin abrir una solicitud si no hay nada.
    if (!hasExtraQuestion(s.norm, s.raw)) return true;
    const more = await c.kbAnswer(s.text, c);
    if (!more.no_data && more.text) {
      c.kb = more;
      c.say({ text: more.text, cites: (more.used ?? []).slice(0, 2).map((u) => ({ title: u.title, source: u.source, heading: u.heading })), chips: [] });
    }
    return true;
  }
  const kb = await c.kbAnswer(s.text, c);
  c.note('retrieve', !kb.no_data, kb.no_data ? 'sin contexto suficiente' : `${kb.used?.length ?? 0} trozos: ${(kb.used ?? []).map((u) => u.heading).join(' · ')}`);
  c.kb = kb;
  if (kb.no_data && interrupt) {
    // En mitad de un pedido o una reserva: no se abandona; se dice que no se sabe y se sigue.
    c.say({
      text: c.t(
        `Ese dato no lo tengo y prefiero no inventarlo; puedes preguntárselo al local en el ${c.biz.phone}.`,
        `Ese dato non o teño e prefiro non inventalo; podes preguntarllo ao local no ${c.biz.phone}.`,
      ),
      evidence: [{ step: 'retrieve', ok: false, detail: kb.reason ?? 'sin respuesta en el conocimiento del negocio' }],
    });
    return false;
  }
  if (kb.no_data) {
    handoffRequest(c, 'unanswered', { question: s.text.slice(0, 280) });
    c.request.kind = 'question';
    c.say({
      text: c.t(
        `Eso no lo tengo claro y prefiero no inventarlo. Le paso tu pregunta a una persona de ${c.biz.name} y te responderá aquí; si es urgente, llama al ${c.biz.phone}. ${identity('es')}`,
        `Iso non o teño claro e prefiro non inventalo. Pásolle a túa pregunta a unha persoa de ${c.biz.name} e responderache aquí; se é urxente, chama ao ${c.biz.phone}. ${identity('gl')}`,
      ),
      evidence: [{ step: 'retrieve', ok: false, detail: kb.reason ?? 'sin respuesta en el conocimiento del negocio' }],
    });
    return false;
  }
  c.say({
    text: kb.text,
    cites: (kb.used ?? []).slice(0, 3).map((u) => ({ title: u.title === 'Carta y catálogo' ? u.heading : u.title, source: u.source, heading: u.heading })),
    evidence: [{
      step: 'retrieve',
      ok: true,
      detail: `${kb.used?.length ?? 0} fuentes (${(kb.used ?? []).map((u) => `${u.heading} ${u.score}`).join(', ')})${kb.degraded ? ' · búsqueda por palabras' : ''}`,
    }, {
      step: 'generate',
      ok: !kb.fallback,
      detail: kb.fallback ? `texto de la fuente (${kb.reason})` : `${kb.model} · ${kb.tokens_out} tokens · ${kb.ms} ms · cifras comprobadas`,
    }],
    chips: [],
  });
  c.state.last.topic = 'kb';
  c.info = { answered: true };
  return true;
}

function followUps(c) {
  const out = [];
  const caps = c.biz.capabilities;
  if (caps.includes('order')) out.push(chipText(c.t('Hacer un pedido', 'Facer un pedido'), c.t('Quiero hacer un pedido para recoger', 'Quero facer un pedido para recoller')));
  if (caps.includes('booking')) {
    out.push(chipText(c.biz.booking.mode === 'staff' ? c.t('Reservar cita', 'Reservar cita') : c.t('Reservar mesa', 'Reservar mesa'), c.biz.booking.mode === 'staff' ? c.t('Quiero reservar una cita', 'Quero reservar unha cita') : c.t('Quiero reservar una mesa', 'Quero reservar unha mesa')));
  }
  return out.slice(0, 2);
}

// -------------------------------------------------------------------------------- simples

function greet(c) {
  c.say({
    text: c.t('¡Hola! ¿En qué te puedo ayudar?', '¡Ola! ¿En que che podo axudar?'),
    chips: quickChips(c, 3),
  });
}

function offtopic(c) {
  c.say({
    text: c.t(`Eso se me escapa: solo puedo ayudarte con ${c.biz.name}. Si quieres, te cuento la carta o los horarios.`,
      `Iso escápame: só podo axudarte con ${c.biz.name}. Se queres, cóntoche a carta ou os horarios.`,
    ),
    chips: quickChips(c, 3),
  });
}

function cancel(c) {
  if (midFlow(c)) {
    resetFlow(c.state);
    return c.say({ text: c.t('Vale, lo dejo así. No he enviado nada. ¿Necesitas otra cosa?', 'Vale, déixoo así. Non enviei nada. ¿Precisas outra cousa?'), chips: quickChips(c, 3) });
  }
  if (c.hasPending) {
    c.signals = { ...c.signals, text: c.signals.text || c.signals.raw };
    handoffRequest(c, 'change_request');
    return c.say({
      text: c.t(
        `Aviso al local de que quieres cancelar o cambiar tu solicitud: lo gestiona una persona y te responde aquí. ${identity('es')}`,
        `Aviso ao local de que queres cancelar ou cambiar a túa solicitude: xestiónao unha persoa e respóndeche aquí. ${identity('gl')}`,
      ),
    });
  }
  return c.say({ text: c.t('No tengo nada pendiente que cancelar. ¿Te ayudo con otra cosa?', 'Non teño nada pendente que cancelar. ¿Axúdoche con outra cousa?'), chips: quickChips(c, 3) });
}

async function unsupported(c) {
  // «¿Hacéis reservas?» en un local que no las gestiona: que responda el conocimiento del negocio.
  const answered = await infoStep(c);
  if (answered && c.replies.length) return;
  c.replies.pop();
  c.request = null;
  c.state.done = false;
  const what = c.signals.primary === 'booking_unsupported' ? c.t('reservas', 'reservas') : c.t('pedidos', 'pedidos');
  c.say({
    text: c.t(`Aquí no gestiono ${what}. Puedes llamar al ${c.biz.phone} y te atienden.`, `Aquí non xestiono ${what}. Podes chamar ao ${c.biz.phone} e atendente.`),
    chips: quickChips(c, 3),
  });
}

// ----------------------------------------------------------------------------- slots del flujo

// ¿Trae el mensaje algo que sirve al flujo en curso?
function feedsFlow(c) {
  const s = c.signals;
  const aw = c.state.awaiting;
  if (['notes', 'name', 'phone'].includes(aw) && s.raw.trim() && !(s.question && !s.name && !s.phone)) return true;
  if (s.yes || s.no || s.asap || s.name || s.phone || s.anyone || s.change) return true;
  if (s.party != null || s.resource) return true;
  const w = s.when;
  if (w.ymd || w.min != null || w.part || w.ambiguous || w.invalid_day || w.relMin) return true;
  if (s.items.strayOptions?.length && c.state.intent === 'order') return true;
  if (s.items.lines.length || s.items.ambiguous.length) return !s.question || s.want_kw || s.order_kw;
  if (c.state.intent === 'order' && s.items.unknown.length) return true;
  return false;
}

function resolveClarify(c) {
  const st = c.state;
  const cl = st.clarify;
  if (!cl) return;
  const hit = c.signals.items.lines.find((l) => cl.candidates.includes(l.item_id));
  if (!hit) return;
  if (st.intent === 'order') hit.qty = hit.qty > 1 ? hit.qty : cl.qty;
  hit.options = { ...cl.options, ...hit.options };
  st.clarify = null;
}

function confirm(c) {
  if (c.state.intent === 'order') return orderConfirm(c);
  if (c.state.intent === 'booking') return bookingConfirm(c);
  return c.say({ text: c.t('No tengo nada preparado para enviar todavía. ¿Qué te gustaría hacer?', 'Non teño nada preparado para enviar aínda. ¿Que che gustaría facer?'), chips: quickChips(c, 3) });
}

// Una pregunta de horario, teléfono o dirección dentro de un mensaje que también reserva o pide:
// se contesta primero y después se sigue con la reserva o el pedido.
function sideInfo(c) {
  const s = c.signals;
  if (!s.question || !s.topics?.some((t) => ['hours', 'address', 'phone'].includes(t))) return;
  const trimmed = { ...s, topics: s.topics.filter((t) => ['hours', 'address', 'phone'].includes(t)) };
  trimmed.topic = trimmed.topics[0];
  const replies = infoReplies({ biz: c.biz, catalog: c.catalog, lang: c.lang, signals: trimmed, now: c.now });
  for (const r of replies) c.say({ ...r, chips: [] });
}

async function continueFlow(c) {
  sideInfo(c);
  const s = c.signals;
  const aw = c.state.awaiting;
  resolveClarify(c);
  if (aw === 'confirm' && s.yes && !s.items.lines.length) return confirm(c);
  if (aw === 'confirm' && s.no) return c.state.intent === 'order' ? orderMore(c) : bookingEdit(c);
  if (aw === 'edit' && c.state.intent === 'booking') return bookingStep(c);
  return runFlow(c);
}

// -------------------------------------------------------------------------------- botones

const slotOf = (hhmm) => (hhmm ? toMin(hhmm) : null);

function actionSignals(c, a) {
  const s = neutralSignals(c.lang);
  if (a.type === 'set') {
    if (a.field === 'party') s.party = Number(a.value);
    else if (a.field === 'date') s.when.ymd = a.value;
    else if (a.field === 'time') {
      s.when.min = slotOf(a.value);
      s.when.time = a.value;
      if (a.resource) s.resource = a.resource;
    } else if (a.field === 'service') s.items.lines = [{ item_id: a.value, qty: 1, options: {} }];
    else if (a.field === 'resource') s.resource = a.value;
    else if (a.field === 'pickup_time') {
      s.when.min = slotOf(a.value);
      s.when.time = a.value;
    } else if (a.field === 'pickup_date') s.when.ymd = a.value;
  } else if (a.type === 'add') {
    s.items.lines = [{ item_id: a.item_id, qty: 1, options: {} }];
  } else if (a.type === 'asap') {
    s.asap = true;
  }
  return s;
}

async function runAction(c, a) {
  const st = c.state;
  const type = a.type;
  if (type === 'start') {
    resetFlow(st);
    st.intent = a.intent === 'order' ? 'order' : 'booking';
    return runFlow(c);
  }
  if (type === 'menu') {
    const cat = c.catalog.categories.find((x) => x.id === a.category);
    c.signals = { ...neutralSignals(c.lang), text: cat?.name ?? '' };
    return c.say({ ...answerMenu({ biz: c.biz, catalog: c.catalog, lang: c.lang, signals: c.signals }) });
  }
  if (type === 'handoff') {
    return startHandoff(c, 'person');
  }
  if (type === 'confirm') return confirm(c);
  if (type === 'edit') return st.intent === 'order' ? orderMore(c) : bookingEdit(c);
  if (type === 'more') return orderMore(c);
  if (type === 'notes') {
    if (st.intent === 'order') st.order.note = a.value ?? '';
    else st.booking.note = a.value ?? '';
    c.signals = neutralSignals(c.lang);
    return runFlow(c);
  }
  if (type === 'reset') {
    const b = st.booking;
    const o = st.order;
    if (a.field === 'date') { b.ymd = null; b.min = null; }
    if (a.field === 'time') b.min = null;
    if (a.field === 'party') { b.party = null; b.min = null; }
    if (a.field === 'service') { b.services = []; b.min = null; b.resource = null; b.resource_name = ''; }
    if (a.field === 'pickup') { o.ymd = null; o.min = null; }
    c.signals = neutralSignals(c.lang);
    return runFlow(c);
  }
  if (type === 'pick') {
    const cl = st.clarify;
    const qty = cl?.qty ?? 1;
    const options = cl?.options ?? {};
    st.clarify = null;
    if (st.intent === 'order') {
      st.order.lines = applyToCart(st.order.lines, { mode: 'add', lines: [{ item_id: a.item_id, qty, options }] }).lines;
      c.signals = neutralSignals(c.lang);
      c.signals.items.lines = [];
      st.order.touched = true;
    } else {
      st.booking.services = [...new Set([...(st.booking.services ?? []), a.item_id])];
      c.signals = neutralSignals(c.lang);
    }
    return runFlow(c);
  }
  if (type === 'option') {
    for (const l of st.order.lines) if (l.item_id === a.item_id && !l.options[a.group]) l.options[a.group] = a.choice;
    st.pendingOption = null;
    c.signals = neutralSignals(c.lang);
    return runFlow(c);
  }
  if (type === 'qty') {
    const line = st.order.lines[a.index];
    if (line) {
      line.qty = Math.max(0, line.qty + (a.delta ?? 0));
      st.order.lines = st.order.lines.filter((l) => l.qty > 0);
    }
    c.signals = neutralSignals(c.lang);
    return runFlow(c);
  }
  // set / add / asap: se comportan como si lo hubiera escrito.
  c.signals = actionSignals(c, a);
  if (!st.intent) st.intent = ['pickup_time', 'pickup_date'].includes(a.field) || type === 'add' || type === 'asap' ? 'order' : 'booking';
  if (st.intent === 'order' && type === 'set' && a.field === 'time') c.signals.when.min = slotOf(a.value);
  return continueFlow(c);
}

// -------------------------------------------------------------------------------------- turno

// -> { state, replies, request, refused, redacted, trace, signals, kb }
export async function turn({
  biz, catalog, state: prev, input, now = new Date(), own = [], hasPending = false, kbAnswer, history = [],
}) {
  const state = clone(prev ?? freshState());
  const lang = state.lang ?? 'es';
  let c;
  if (input.action) {
    c = makeCtx({ biz, catalog, state, signals: neutralSignals(lang), now, own, kbAnswer, history, hasPending });
    await runAction(c, input.action);
  } else {
    const signals = analyze(input.text, { biz, catalog, state, now });
    state.lang = signals.lang;
    c = makeCtx({ biz, catalog, state, signals, now, own, kbAnswer, history, hasPending });
    c.note('understand', true, `idioma ${signals.lang} · intención ${signals.primary}${signals.topic ? ` · tema ${signals.topic}` : ''}`);
    await route(c);
  }
  if (!c.replies.length) greet(c);
  for (const r of c.replies) delete r.summary;
  return {
    state: c.state,
    replies: c.replies,
    request: c.request,
    refused: Boolean(c.refused),
    redacted: Boolean(c.redacted),
    trace: c.trace,
    signals: c.signals,
    kb: c.kb ?? null,
    info: c.info ?? null,
  };
}

async function route(c) {
  const s = c.signals;
  const st = c.state;
  if (s.primary === 'refuse') return refuse(c);
  if (s.primary === 'handoff') return startHandoff(c, 'person');
  if (s.primary === 'cancel') return cancel(c);

  if (midFlow(c)) {
    if (feedsFlow(c)) return continueFlow(c);
    // Un nombre suelto cuando aún no se ha dado («Iria»): es el nombre del pedido o de la reserva.
    const who = c.state.intent === 'order' ? c.state.order : c.state.booking;
    const loose = !who.name && s.short && extractName(s.text, { expecting: true });
    if (loose && !s.question) {
      c.signals = { ...s, name: loose };
      return continueFlow(c);
    }
    if (s.primary === 'info' || s.primary === 'booking_unsupported' || s.primary === 'order_unsupported') {
      await infoStep(c, { interrupt: true });
      if (!c.request) reprompt(c);
      return undefined;
    }
    if (s.primary === 'offtopic') {
      offtopic(c);
      return reprompt(c);
    }
    if (s.primary === 'thanks' || s.primary === 'greet' || s.primary === 'bye') {
      c.say({ text: s.primary === 'bye' ? c.t('¡Hasta luego!', 'Ata logo!') : c.t('¡Aquí estoy! Seguimos cuando quieras.', 'Aquí estou! Seguimos cando queiras.') });
      return reprompt(c);
    }
    c.say({ text: c.t('No te he entendido bien. Te vuelvo a preguntar:', 'Non te entendín ben. Volvo preguntarche:') });
    return reprompt(c);
  }

  switch (s.primary) {
    case 'greet':
      return greet(c);
    case 'thanks':
      return c.say({ text: c.t('¡De nada! Si necesitas algo más, aquí estoy.', 'De nada! Se precisas algo máis, aquí estou.'), chips: quickChips(c, 3) });
    case 'bye':
      return c.say({ text: c.t('¡Hasta pronto!', 'Ata pronto!') });
    case 'offtopic':
      return offtopic(c);
    case 'booking':
      resetFlow(st);
      st.intent = 'booking';
      sideInfo(c);
      return bookingStep(c);
    case 'order':
      resetFlow(st);
      st.intent = 'order';
      sideInfo(c);
      return orderStep(c);
    case 'booking_unsupported':
    case 'order_unsupported':
      return unsupported(c);
    case 'yes':
    case 'no':
      return c.say({ text: c.t('¿Qué te gustaría hacer?', '¿Que che gustaría facer?'), chips: quickChips(c, 3) });
    default:
      return infoStep(c);
  }
}

