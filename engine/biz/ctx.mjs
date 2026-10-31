// Contexto de un turno de conversación: lo que se lee, lo que se dice y lo que queda por hacer.
import { L } from './format.mjs';

export const freshState = (lang = 'es') => ({
  v: 1,
  lang,
  intent: null, // 'booking' | 'order' | 'info' | 'handoff'
  awaiting: null, // qué se le ha preguntado a la persona
  clarify: null, // producto ambiguo pendiente de elegir
  queue: [], // más productos ambiguos por aclarar
  booking: {},
  order: { lines: [] },
  last: { topic: null },
  done: false,
});

export function neutralSignals(lang, norm = '') {
  return {
    raw: '',
    text: '',
    norm,
    lang,
    flags: [],
    short: true,
    greet: false,
    thanks: false,
    bye: false,
    yes: false,
    no: false,
    cancel: false,
    change: false,
    handoff: false,
    asap: false,
    anyone: false,
    no_notes: false,
    offtopic: false,
    question: false,
    booking_kw: false,
    order_kw: false,
    want_kw: false,
    asks_options: false,
    has_items: false,
    items: { lines: [], ambiguous: [], unknown: [], mode: 'add', strayOptions: [] },
    when: { ymd: null, time: null, min: null, part: null, asap: false, relMin: null, ambiguous: null, invalid_day: false },
    party: null,
    resource: null,
    name: null,
    phone: null,
    email: null,
    diet: { avoid: [], tags: [], free: false },
    topic: null,
    topics: [],
    refusal: null,
    primary: 'info',
  };
}

export function makeCtx({ biz, catalog, state, signals, now, own = [], kbAnswer, history = [], hasPending = false }) {
  const c = {
    biz, catalog, state, signals, now, own, kbAnswer, history, hasPending,
    lang: signals.lang,
    replies: [],
    request: null,
    events: [],
    trace: [],
    t: (es, gl) => L(signals.lang, es, gl),
  };
  c.say = (reply) => {
    c.replies.push(reply);
    return reply;
  };
  c.note = (step, ok, detail) => c.trace.push({ step, ok, detail });
  return c;
}

export const chipText = (label, text) => ({ label, text: text ?? label });
export const chipAction = (label, action) => ({ label, action });

export function identity(lang) {
  return lang === 'gl' ? 'Son un asistente; unha persoa confirmará.' : 'Soy un asistente; una persona lo confirmará.';
}
