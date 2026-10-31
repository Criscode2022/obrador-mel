// Del texto libre («2 tartas de santiago y 1 de limón») a líneas de pedido sobre la carta real,
// y el precio. Determinista: el modelo no interviene ni decide un importe.
import { normalize, similarity, singular, toNumber } from './text.mjs';

const CONNECTORS = new Set([
  'y', 'e', 'o', 'con', 'de', 'del', 'la', 'el', 'los', 'las', 'lo', 'al', 'a', 'para', 'por', 'sin', 'en',
  'mas', 'tambien', 'ademas', 'ponme', 'pon', 'dame', 'dadme', 'quiero', 'queria', 'quisiera', 'quero',
  'quereria', 'gustaria', 'me', 'te', 'nos', 'favor', 'porfa', 'gracias', 'ola', 'hola', 'otro', 'otra',
  'otros', 'otras', 'pedido', 'pedir', 'pido', 'pedirte', 'hacer', 'recoger', 'llevar', 'recoller', 'levar', 'que',
  'unos', 'unas', 'poner', 'ponedme', 'poneme', 'si', 'vale', 'ok', 'perfecto', 'ya', 'solo', 'sola', 'tambien',
]);
const NOT_PRODUCTS = new Set([
  'pedido', 'hora', 'horas', 'minuto', 'minutos', 'vez', 'persona', 'personas', 'pregunta', 'duda', 'favor',
  'momento', 'cosa', 'algo', 'rato', 'poco', 'dia', 'dias', 'mesa', 'cita', 'reserva', 'tarde', 'manana',
  'noche', 'semana', 'mes', 'euro', 'euros', 'ahora', 'consulta', 'pedirlo', 'recogida', 'nombre',
]);
const REMOVE_RE = /\b(?:quita|quitame|quitar|quitalo|borra|borrar|elimina|eliminar|saca|sacar|cancela|cancelar|retira|sin el|sin la|ya no quiero|no quiero|no pongas|olvida)\b/;
const SET_RE = /\b(?:mejor|cambia|cambiar|cambialo|que sean|que sea|nada mas|en vez de|modifica)\b/;

// «media docena de» → 6, «una docena de» → 12, «un par de» → 2, antes de trocear.
const prenumber = (text) => normalize(text)
  .replace(/\bmedia docena(?: de)?\b/g, ' 6 ')
  .replace(/\b(?:una )?docena(?: de)?\b/g, ' 12 ')
  .replace(/\b(?:un |unha )?par de\b/g, ' 2 ');
const tokenize = (text) => prenumber(text).replace(/[^a-z0-9+x ]+/g, ' ').split(/\s+/).filter(Boolean);

// «un par de» → 2, «media docena de» → 6, «dos», «2», «2x».
function quantityAt(tokens, i) {
  const t = tokens[i];
  if (t == null) return null;
  const x = t.match(/^(\d{1,2})x$/) ?? t.match(/^x(\d{1,2})$/);
  if (x) return { qty: Number(x[1]), len: 1 };
  if (t === 'media' && tokens[i + 1] === 'docena') return { qty: 6, len: tokens[i + 2] === 'de' ? 3 : 2 };
  if (t === 'docena' || (t === 'una' && tokens[i + 1] === 'docena')) {
    const skip = t === 'una' ? 2 : 1;
    return { qty: 12, len: skip + (tokens[i + skip] === 'de' ? 1 : 0) };
  }
  if ((t === 'un' || t === 'unha') && tokens[i + 1] === 'par') return { qty: 2, len: tokens[i + 2] === 'de' ? 3 : 2 };
  if (t === 'par' && tokens[i + 1] === 'de') return { qty: 2, len: 2 };
  const n = toNumber(t);
  if (n && n <= 30) return { qty: n, len: 1 };
  return null;
}

function buildIndex(catalog) {
  const phrases = [];
  for (const item of catalog.items) {
    for (const phrase of item.phrases) {
      const weak = phrase.startsWith('^');
      phrases.push({ tokens: phrase.replace(/^\^/, '').split(' ').filter(Boolean), weak, itemId: item.id, ambiguous: null });
    }
  }
  for (const [key, amb] of Object.entries(catalog.ambiguous ?? {})) {
    for (const alias of amb.aliases ?? []) {
      const tokens = normalize(alias).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(Boolean).map(singular);
      phrases.push({ tokens, weak: false, itemId: null, ambiguous: key });
    }
  }
  return phrases.sort((a, b) => b.tokens.length - a.tokens.length);
}

const indexCache = new WeakMap();
function indexOf(catalog) {
  if (!indexCache.has(catalog)) indexCache.set(catalog, buildIndex(catalog));
  return indexCache.get(catalog);
}

// Frases de opción («12 raciones», «para 8») ya normalizadas.
function optionPhrases(catalog) {
  const out = [];
  for (const [group, opt] of Object.entries(catalog.options ?? {})) {
    for (const choice of opt.choices) {
      for (const alias of choice.aliases ?? []) {
        const tokens = normalize(alias).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(Boolean);
        if (tokens.length) out.push({ group, choice: choice.id, tokens });
      }
    }
  }
  return out.sort((a, b) => b.tokens.length - a.tokens.length);
}

const sameTokens = (tokens, i, phrase) => phrase.every((p, k) => tokens[i + k] != null && singular(tokens[i + k]) === singular(p));

// -> { lines, ambiguous, unknown, mode }
//   lines:     [{ item_id, qty, options: { grupo: 'opcion' }, at }]
//   ambiguous: [{ key, name, qty, candidates, options, at }]   («una tarta»: ¿cuál?)
//   unknown:   ['pizza']                                        (pidió algo que no está en la carta)
//   mode:      'add' | 'set' | 'remove'
export function findItems(text, catalog) {
  const tokens = tokenize(text);
  const flat = prenumber(text);
  const used = new Array(tokens.length).fill(false);
  const matches = [];
  const index = indexOf(catalog);

  for (let i = 0; i < tokens.length; i += 1) {
    if (used[i]) continue;
    for (const p of index) {
      if (!sameTokens(tokens, i, p.tokens)) continue;
      if (p.weak && i > 0 && used[i - 1]) continue;
      matches.push({ start: i, end: i + p.tokens.length, itemId: p.itemId, ambiguous: p.ambiguous });
      for (let k = i; k < i + p.tokens.length; k += 1) used[k] = true;
      break;
    }
  }

  // Errata: una palabra suelta parecida a un producto de una sola palabra («tartaletta», «macarrons»).
  const singles = catalog.items.flatMap((it) => it.phrases.filter((p) => !p.includes(' ') && p.length >= 6).map((p) => [p, it.id]));
  for (let i = 0; i < tokens.length; i += 1) {
    if (used[i] || tokens[i].length < 6 || CONNECTORS.has(tokens[i]) || NOT_PRODUCTS.has(tokens[i])) continue;
    let best = null;
    for (const [phrase, itemId] of singles) {
      const s = similarity(singular(tokens[i]), phrase);
      if (s >= 0.74 && (!best || s > best.s)) best = { s, itemId };
    }
    if (best) {
      matches.push({ start: i, end: i + 1, itemId: best.itemId, ambiguous: null, fuzzy: true });
      used[i] = true;
    }
  }
  matches.sort((a, b) => a.start - b.start);

  // Cantidades: justo antes del producto («dos palmeras»), o con «x2» tras él.
  for (const m of matches) {
    let qty = null;
    for (let back = 1; back <= 3 && qty == null; back += 1) {
      const j = m.start - back;
      if (j < 0 || matches.some((o) => o !== m && o.end > j && o.start <= j)) break;
      const q = quantityAt(tokens, j);
      if (q && j + q.len >= m.start - 1) qty = q.qty;
    }
    if (qty == null && m.end < tokens.length) {
      const q = quantityAt(tokens, m.end);
      if (q && /^(?:\d{1,2}x|x\d{1,2})$/.test(tokens[m.end])) qty = q.qty;
    }
    m.qty = qty ?? 1;
    m.qty_given = qty != null;
  }

  // Opciones: palabras sueltas que acompañan a un producto que las admite.
  const phrasesOpt = optionPhrases(catalog);
  const options = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (used[i]) continue;
    for (const p of phrasesOpt) {
      if (!p.tokens.every((w, k) => tokens[i + k] === w && !used[i + k])) continue;
      options.push({ ...p, at: i });
      for (let k = i; k < i + p.tokens.length; k += 1) used[k] = true;
      break;
    }
  }
  const lines = [];
  const ambiguous = [];
  for (const m of matches) {
    if (m.ambiguous) {
      const amb = catalog.ambiguous[m.ambiguous];
      ambiguous.push({ key: m.ambiguous, name: amb.name, qty: m.qty, candidates: amb.candidates, options: {}, at: m.start });
    } else {
      lines.push({ item_id: m.itemId, qty: m.qty, options: {}, at: m.start, fuzzy: Boolean(m.fuzzy) });
    }
  }
  const target = (opt) => {
    const supports = (l) => catalog.byId.get(l.item_id)?.options.includes(opt.group);
    const cands = lines.filter(supports);
    if (cands.length) {
      const before = cands.filter((l) => l.at <= opt.at);
      return (before.length ? before[before.length - 1] : cands[0]);
    }
    return ambiguous.find((a) => a.key === opt.group) ?? ambiguous[ambiguous.length - 1] ?? null;
  };
  const strayOptions = [];
  for (const opt of options) {
    const t = target(opt);
    if (t) t.options[opt.group] = opt.choice;
    else if (!catalog.ambiguous?.[opt.group]) strayOptions.push({ group: opt.group, choice: opt.choice });
    else if (catalog.ambiguous?.[opt.group]) {
      const amb = catalog.ambiguous[opt.group];
      ambiguous.push({ key: opt.group, name: amb.name, qty: 1, candidates: amb.candidates, options: { [opt.group]: opt.choice }, at: opt.at });
    }
  }

  // Lo que pidió y no está en la carta: «una pizza».
  const unknown = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const q = quantityAt(tokens, i);
    if (!q) continue;
    const start = i + q.len;
    if (start >= tokens.length || used[start]) continue;
    const words = [];
    for (let k = start; k < tokens.length && words.length < 3; k += 1) {
      if (used[k] || CONNECTORS.has(tokens[k])) break;
      words.push(tokens[k]);
    }
    if (words.length && !words.some((w) => NOT_PRODUCTS.has(singular(w)) || /^\d/.test(w) || quantityAt([w], 0))) unknown.push(words.join(' '));
  }

  let mode = 'add';
  if (REMOVE_RE.test(flat)) mode = 'remove';
  else if (SET_RE.test(flat) && (lines.length || ambiguous.length)) mode = 'set';
  return { lines, ambiguous, unknown, mode, strayOptions };
}

// Fusiona líneas iguales (mismo producto y opciones).
export function mergeLines(lines) {
  const out = [];
  for (const l of lines) {
    const key = `${l.item_id}|${JSON.stringify(Object.entries(l.options ?? {}).sort())}`;
    const hit = out.find((o) => o.key === key);
    if (hit) hit.qty += l.qty;
    else out.push({ key, item_id: l.item_id, qty: l.qty, options: { ...(l.options ?? {}) } });
  }
  return out.map(({ key, ...rest }) => rest);
}

// Aplica lo encontrado al pedido actual según el modo (añadir, fijar cantidad, quitar).
export function applyToCart(cart, found) {
  let lines = cart.map((l) => ({ ...l, options: { ...l.options } }));
  const touched = [];
  if (found.mode === 'remove') {
    for (const f of found.lines) {
      const before = lines.length;
      lines = lines.filter((l) => l.item_id !== f.item_id);
      if (lines.length !== before) touched.push(f.item_id);
    }
    return { lines, touched, removed: touched };
  }
  for (const f of found.lines) {
    if (found.mode === 'set') {
      const hit = lines.find((l) => l.item_id === f.item_id);
      if (hit) {
        hit.qty = f.qty;
        Object.assign(hit.options, f.options);
        touched.push(f.item_id);
        continue;
      }
    }
    lines.push({ item_id: f.item_id, qty: f.qty, options: { ...f.options } });
    touched.push(f.item_id);
  }
  return { lines: mergeLines(lines), touched, removed: [] };
}

// ---------------------------------------------------------------------------- precios y alérgenos

export function lineAllergens(catalog, line) {
  const item = catalog.byId.get(line.item_id);
  if (!item) return [];
  const set = new Set(item.contains);
  for (const [group, choiceId] of Object.entries(line.options ?? {})) {
    const choice = catalog.options?.[group]?.choices.find((c) => c.id === choiceId);
    for (const a of choice?.contains_remove ?? []) set.delete(a);
    for (const a of choice?.contains_add ?? []) set.add(a);
  }
  return [...set];
}

export function optionLabel(catalog, line) {
  const parts = [];
  for (const [group, choiceId] of Object.entries(line.options ?? {})) {
    const opt = catalog.options?.[group];
    if (!opt || (opt.default && choiceId === opt.default)) continue;
    const choice = opt.choices.find((c) => c.id === choiceId);
    if (choice) parts.push(opt.required ? choice.name : choice.name.toLowerCase());
  }
  return parts.join(', ');
}

export function priceLine(catalog, line) {
  const item = catalog.byId.get(line.item_id);
  if (!item) return null;
  let unit = item.price_cents;
  for (const [group, choiceId] of Object.entries(line.options ?? {})) {
    const choice = catalog.options?.[group]?.choices.find((c) => c.id === choiceId);
    unit += Math.round((choice?.delta ?? 0) * 100);
  }
  return {
    item_id: item.id,
    name: item.name,
    qty: line.qty,
    options: line.options ?? {},
    option_label: optionLabel(catalog, line),
    unit_cents: unit,
    total_cents: unit * line.qty,
    allergens: lineAllergens(catalog, line),
    lead_hours: item.lead_hours ?? null,
  };
}

export function priceOrder(catalog, lines) {
  const priced = lines.map((l) => priceLine(catalog, l)).filter(Boolean);
  return {
    lines: priced,
    count: priced.reduce((n, l) => n + l.qty, 0),
    total_cents: priced.reduce((n, l) => n + l.total_cents, 0),
  };
}

