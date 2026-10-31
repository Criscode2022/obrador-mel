// Respuestas de información que el motor calcula con los datos del negocio (horario, precios,
// carta, alérgenos), sin modelo: son datos que tienen que ser exactos. Lo demás va por kb.mjs.
import { dayRanges, fmtTime, isOpenAt, nextOpening, nowMinutes, todayYmd } from './avail.mjs';
import { L, dayRel, listJoin, money, weekRows } from './format.mjs';
import { findItems, lineAllergens } from './orders.mjs';
import { asksContains } from './nlu.mjs';
import { normalize, singular } from './text.mjs';

export const ALLERGEN_NAMES = {
  es: {
    gluten: 'gluten', crustaceos: 'crustáceos', huevos: 'huevo', pescado: 'pescado', cacahuetes: 'cacahuetes', soja: 'soja',
    lacteos: 'lácteos', frutos_secos: 'frutos secos', apio: 'apio', mostaza: 'mostaza', sesamo: 'sésamo', sulfitos: 'sulfitos',
    altramuces: 'altramuces', moluscos: 'moluscos',
  },
  gl: {
    gluten: 'gluten', crustaceos: 'crustáceos', huevos: 'ovo', pescado: 'peixe', cacahuetes: 'cacahuetes', soja: 'soia',
    lacteos: 'lácteos', frutos_secos: 'froitos secos', apio: 'apio', mostaza: 'mostaza', sesamo: 'sésamo', sulfitos: 'sulfitos',
    altramuces: 'chícharos', moluscos: 'moluscos',
  },
};
const TAG_NAMES = {
  es: { vegano: 'veganos', vegetariano: 'vegetarianos', sin_gluten: 'sin gluten', sin_lactosa: 'sin lactosa', sin_azucar: 'sin azúcar' },
  gl: { vegano: 'veganos', vegetariano: 'vegetarianos', sin_gluten: 'sen gluten', sin_lactosa: 'sen lactosa', sin_azucar: 'sen azucre' },
};
const SAFETY = {
  es: 'Si es una alergia o intolerancia grave, una persona del local lo confirma con cocina antes de preparar nada.',
  gl: 'Se é unha alerxia ou intolerancia grave, unha persoa do local confírmao coa cociña antes de preparar nada.',
};

const cite = (title, source, quote) => ({ title, source, ...(quote ? { quote } : {}) });
export const hasAllergenData = (catalog) => catalog.items.some((i) => i.contains.length || i.tags.length);

// ------------------------------------------------------------------------------------- horario

function dayTail(biz, ymd, lang, now) {
  const ranges = dayRanges(biz, ymd);
  const closedByHoliday = (biz.closed_dates ?? []).includes(ymd);
  if (!ranges.length) {
    return closedByHoliday
      ? L(lang, `${dayRel(ymd, lang, now)} cerramos por festivo`, `${dayRel(ymd, lang, now)} pechamos por festivo`)
      : L(lang, `${dayRel(ymd, lang, now)} no abrimos`, `${dayRel(ymd, lang, now)} non abrimos`);
  }
  return L(
    lang,
    `${dayRel(ymd, lang, now)} abrimos ${ranges.map(([a, b]) => `de ${fmtTime(a)} a ${fmtTime(b)}`).join(' y ')}`,
    `${dayRel(ymd, lang, now)} abrimos ${ranges.map(([a, b]) => `de ${fmtTime(a)} a ${fmtTime(b)}`).join(' e ')}`,
  );
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAME = {
  es: { mon: 'lunes', tue: 'martes', wed: 'miércoles', thu: 'jueves', fri: 'viernes', sat: 'sábado', sun: 'domingo' },
  gl: { mon: 'luns', tue: 'martes', wed: 'mércores', thu: 'xoves', fri: 'venres', sat: 'sábado', sun: 'domingo' },
};

// «martes a sábado» o «lunes, miércoles y viernes» a partir de una lista de días.
function dayList(keys, lang) {
  const names = DAY_NAME[lang === 'gl' ? 'gl' : 'es'];
  const idx = keys.map((k) => DAY_KEYS.indexOf(k));
  const runs = [];
  for (const i of idx) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else runs.push([i]);
  }
  const parts = runs.map((r) => (r.length >= 3 ? L(lang, `de ${names[DAY_KEYS[r[0]]]} a ${names[DAY_KEYS[r[r.length - 1]]]}`, `de ${names[DAY_KEYS[r[0]]]} a ${names[DAY_KEYS[r[r.length - 1]]]}`) : r.map((i) => names[DAY_KEYS[i]]).join(L(lang, ' y ', ' e '))));
  return listJoin(parts, lang);
}

const lastClose = (ranges) => ranges[ranges.length - 1][1];

// Una pregunta de horario, se formule como se formule: ¿cuándo abrís?, ¿hasta qué hora?, ¿el lunes
// estáis abiertos?, ¿qué días abrís?... Se contesta con el horario del negocio, sin modelo.
export function answerHours({ biz, lang, signals, now }) {
  const today = todayYmd(now);
  const t = signals.norm;
  if (/\b(?:festiv\w*|navidad|nochebuena|nochevieja|reyes|ano nuevo|puente)\b/.test(t)) return null; // lo explica el documento del local
  const source = cite(L(lang, 'Horario del local', 'Horario do local'), 'business.json');
  const evidence = [{ step: 'hours', ok: true, detail: 'horario y cierres del negocio' }];
  const rows = weekRows(biz, lang).map((r) => ({ label: r.day, value: r.value, days: r.days }));
  const todayKey = DAY_KEYS[(new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7];
  for (const r of rows) if (r.days.includes(todayKey)) r.today = true;
  const card = { type: 'hours', title: L(lang, 'Horario', 'Horario'), rows: rows.map(({ label, value, today: td }) => ({ label, value, ...(td ? { today: true } : {}) })) };
  const reply = (text, withCard = false) => ({ text, cites: [source], evidence, ...(withCard ? { cards: [card] } : {}) });
  const rel = (ymd) => dayRel(ymd, lang, now);
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);

  // «¿A qué hora abrís?» pide una hora; «¿abrís el domingo?» pregunta si se abre.
  const timeAsk = /\b(?:a que hora|cuando|cando|desde que hora|dende que hora|a partir de que hora|hasta que hora|ata que hora|hasta cuando|ata cando|hora de (?:apertura|cierre)|que hora|desde cuando)\b/.test(t);
  const wantsClose = timeAsk && /\b(?:cerr\w*|cierr\w*|pech\w*|termin\w*|acab\w*|hasta que hora|hasta cuando|hora de cierre|cierre)\b/.test(t);
  const wantsOpen = timeAsk && /\b(?:abri\w*|abre\w*|abren|empiez\w*|comienz\w*|a partir de que hora|desde que hora|hora de apertura|apertura)\b/.test(t);
  const midday = /\b(?:a )?medio ?dia\b|\bhora de comer\b|\bsiesta\b|\bde corrido\b|\bsin parar\b/.test(t);
  const wantsDays = /\bque dias\b|\bdias? de (?:apertura|cierre|descanso|servicio)\b|\bcuantos dias\b|\bdescans\w*/.test(t);
  const nowAsk = /\b(?:ahora|ya|ahorita|agora)\b|\besta\w* (?:abiert|cerrad|aberto|pechad)\w*/.test(t);
  const weekend = signals.when?.ambiguous === 'weekend' || /\bfin(?:es)? de semana\b|\bfinde\b/.test(t);
  const asked = signals.when?.ymd ?? null;

  if (weekend) {
    const sat = rows.find((r) => r.days.includes('sat'));
    const sun = rows.find((r) => r.days.includes('sun'));
    return reply(L(lang, `Los sábados: ${sat.value.toLowerCase()}. Los domingos: ${sun.value.toLowerCase()}.`, `Os sábados: ${sat.value.toLowerCase()}. Os domingos: ${sun.value.toLowerCase()}.`));
  }
  if (midday && !asked) {
    const rs = dayRanges(biz, today);
    const open = rs.length ? rs : dayRanges(biz, nextOpening(biz, now)?.ymd ?? today);
    if (open.length === 1) return reply(L(lang, `No cerramos a mediodía: abrimos de corrido, de ${fmtTime(open[0][0])} a ${fmtTime(open[0][1])}.`, `Non pechamos ao mediodía: abrimos de contado, de ${fmtTime(open[0][0])} a ${fmtTime(open[0][1])}.`));
    if (open.length > 1) return reply(L(lang, `Sí, hay pausa a mediodía: abrimos ${open.map(([a, b]) => `de ${fmtTime(a)} a ${fmtTime(b)}`).join(' y ')}.`, `Si, hai pausa ao mediodía: abrimos ${open.map(([a, b]) => `de ${fmtTime(a)} a ${fmtTime(b)}`).join(' e ')}.`));
  }
  if (wantsDays && !asked) {
    const open = DAY_KEYS.filter((k) => (biz.hours[k] ?? []).length);
    const closed = DAY_KEYS.filter((k) => !(biz.hours[k] ?? []).length);
    const text = closed.length
      ? L(lang, `Abrimos ${dayList(open, lang)}. Cerramos ${closed.map((k) => `el ${DAY_NAME.es[k]}`).join(' y ')}.`, `Abrimos ${dayList(open, lang)}. Pechamos ${closed.map((k) => `o ${DAY_NAME.gl[k]}`).join(' e ')}.`)
      : L(lang, 'Abrimos todos los días de la semana.', 'Abrimos todos os días da semana.');
    return reply(text, true);
  }

  if (asked) {
    const ranges = dayRanges(biz, asked);
    const holiday = (biz.closed_dates ?? []).includes(asked);
    const name = rel(asked);
    if (!ranges.length) {
      return reply(cap(L(lang, `${holiday ? `${name} es festivo y cerramos` : `no, ${name} cerramos`}.`, `${holiday ? `${name} é festivo e pechamos` : `non, ${name} pechamos`}.`)));
    }
    const full = ranges.map(([a, b]) => L(lang, `de ${fmtTime(a)} a ${fmtTime(b)}`, `de ${fmtTime(a)} a ${fmtTime(b)}`)).join(L(lang, ' y ', ' e '));
    if (wantsClose && !wantsOpen) return reply(cap(L(lang, `${name} cerramos a las ${fmtTime(lastClose(ranges))}.`, `${name} pechamos ás ${fmtTime(lastClose(ranges))}.`)));
    if (wantsOpen && !wantsClose && ranges.length === 1) return reply(cap(L(lang, `${name} abrimos a las ${fmtTime(ranges[0][0])}.`, `${name} abrimos ás ${fmtTime(ranges[0][0])}.`)));
    return reply(cap(L(lang, `sí, ${name} abrimos ${full}.`, `si, ${name} abrimos ${full}.`)));
  }

  if (nowAsk && !wantsClose && !wantsOpen) {
    const ranges = dayRanges(biz, today);
    const cur = ranges.find(([a, b]) => nowMinutes(now) >= a && nowMinutes(now) < b);
    if (cur) return reply(L(lang, `Sí, ahora estamos abiertos y cerramos a las ${fmtTime(cur[1])}.`, `Si, agora estamos abertos e pechamos ás ${fmtTime(cur[1])}.`));
    const next = nextOpening(biz, now);
    const when = next ? L(lang, `${rel(next.ymd)} a las ${fmtTime(next.min)}`, `${rel(next.ymd)} ás ${fmtTime(next.min)}`) : '';
    return reply(L(lang, `No, ahora estamos cerrados. Volvemos a abrir ${when}.`, `Non, agora estamos pechados. Volvemos abrir ${when}.`), true);
  }

  if (wantsClose || wantsOpen) {
    // Hoy si todavía queda algo abierto; si no, el próximo día con horario.
    const ranges = dayRanges(biz, today);
    const stillToday = ranges.some(([, b]) => nowMinutes(now) < b);
    const ymd = stillToday ? today : (nextOpening(biz, now)?.ymd ?? today);
    const rs = dayRanges(biz, ymd);
    if (!rs.length) return reply(L(lang, 'Ahora mismo no tengo un día de apertura próximo.', 'Agora mesmo non teño un día de apertura próximo.'), true);
    const name = rel(ymd);
    const full = rs.map(([a, b]) => `de ${fmtTime(a)} a ${fmtTime(b)}`).join(L(lang, ' y ', ' e '));
    if (wantsClose && !wantsOpen) return reply(cap(L(lang, `${name} cerramos a las ${fmtTime(lastClose(rs))}${rs.length > 1 ? ` (con pausa: ${full})` : ''}.`, `${name} pechamos ás ${fmtTime(lastClose(rs))}${rs.length > 1 ? ` (con pausa: ${full})` : ''}.`)));
    if (rs.length === 1) {
      const open = isOpenAt(biz, ymd, nowMinutes(now)) && ymd === today;
      return reply(cap(L(lang, `${name} abrimos a las ${fmtTime(rs[0][0])}${open ? ' y ya estamos abiertos' : ''}${wantsClose ? ` y cerramos a las ${fmtTime(rs[0][1])}` : ''}.`, `${name} abrimos ás ${fmtTime(rs[0][0])}${open ? ' e xa estamos abertos' : ''}${wantsClose ? ` e pechamos ás ${fmtTime(rs[0][1])}` : ''}.`)));
    }
    return reply(cap(L(lang, `${name} abrimos ${full}.`, `${name} abrimos ${full}.`)));
  }

  return reply(L(lang, 'Este es nuestro horario.', 'Este é o noso horario.'), true);
}

export function answerAddress({ biz, lang }) {
  return {
    text: L(lang, `Estamos en ${biz.address}. Teléfono: ${biz.phone}.`, `Estamos en ${biz.address}. Teléfono: ${biz.phone}.`),
    cites: [cite(L(lang, 'Datos del local', 'Datos do local'), 'business.json')],
    evidence: [{ step: 'profile', ok: true, detail: 'dirección del negocio' }],
  };
}

export function answerPhone({ biz, lang }) {
  return {
    text: L(lang, `Puedes llamar al ${biz.phone} o escribir a ${biz.email}.`, `Podes chamar ao ${biz.phone} ou escribir a ${biz.email}.`),
    cites: [cite(L(lang, 'Datos de contacto', 'Datos de contacto'), 'business.json')],
    evidence: [{ step: 'profile', ok: true, detail: 'contacto del negocio' }],
  };
}

// ------------------------------------------------------------------------------ carta y precios

const CATEGORY_STOP = new Set(['para', 'con', 'del', 'las', 'los', 'una', 'uno', 'que', 'por', 'sin', 'mas', 'tipo']);

function categoryOf(text, catalog) {
  const t = ` ${normalize(text).replace(/[^a-z0-9 ]+/g, ' ')} `;
  const stem = (w) => singular(w);
  let best = null;
  for (const c of catalog.categories) {
    const words = [c.id, c.name, ...(c.aliases ?? [])].flatMap((x) => normalize(x).replace(/[^a-z0-9 ]+/g, ' ').split(' ')).filter((w) => w.length > 2 && !CATEGORY_STOP.has(w));
    const phrases = [...new Set(words.map(stem))];
    const hit = phrases.find((p) => t.split(' ').some((w) => stem(w) === p));
    if (hit && (!best || hit.length > best.hit.length)) best = { cat: c, hit };
  }
  return best?.cat ?? null;
}

const priceLabel = (item, lang) => `${item.price_from ? L(lang, 'desde ', 'desde ') : ''}${money(item.price_cents, lang)}`;

function menuRows(items, lang) {
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    price_cents: i.price_cents,
    price_from: Boolean(i.price_from),
    note: [i.duration ? `${i.duration} min` : '', ...i.tags.filter((t) => t !== 'vegetariano' || !i.tags.includes('vegano')).slice(0, 2).map((t) => TAG_NAMES[lang === 'gl' ? 'gl' : 'es'][t])].filter(Boolean).join(' · '),
  }));
}

export function answerMenu({ biz, catalog, lang, signals }) {
  const cat = categoryOf(signals.text, catalog);
  const evidence = [{ step: 'catalog', ok: true, detail: cat ? `categoría «${cat.name}»` : `${catalog.categories.length} categorías` }];
  const source = [cite(L(lang, 'Carta y catálogo', 'Carta e catálogo'), 'catalog.json')];
  const staff = biz.booking?.mode === 'staff';
  if (cat) {
    const items = catalog.items.filter((i) => i.category === cat.id);
    return {
      text: L(lang, `${cat.name}: ${items.length} opciones. ${cat.note ?? ''}`.trim(), `${cat.name}: ${items.length} opcións. ${cat.note ?? ''}`.trim()),
      cards: [{ type: 'menu', title: cat.name, rows: menuRows(items, lang) }],
      cites: source,
      evidence,
      chips: biz.capabilities.includes('order')
        ? [{ label: L(lang, 'Hacer un pedido', 'Facer un pedido'), text: L(lang, 'Quiero hacer un pedido', 'Quero facer un pedido') }]
        : staff ? [{ label: L(lang, 'Reservar cita', 'Reservar cita'), text: L(lang, 'Quiero reservar una cita', 'Quero reservar unha cita') }] : [],
    };
  }
  return {
    text: L(
      lang,
      staff ? 'Esto es lo que hacemos. Dime una categoría y te enseño los precios.' : 'Esto es lo que tenemos. Dime una categoría y te enseño la carta con precios.',
      staff ? 'Isto é o que facemos. Dime unha categoría e ensínoche os prezos.' : 'Isto é o que temos. Dime unha categoría e ensínoche a carta con prezos.',
    ),
    chips: catalog.categories.slice(0, 6).map((c) => ({ label: c.name, text: c.name })),
    cites: source,
    evidence,
  };
}

export function answerPrice({ biz, catalog, lang, signals }) {
  const found = findItems(signals.text, catalog);
  const source = [cite(L(lang, 'Carta y catálogo', 'Carta e catálogo'), 'catalog.json')];
  const evidence = [{ step: 'catalog', ok: true, detail: 'precios del catálogo' }];
  const ids = [...new Set(found.lines.map((l) => l.item_id))];
  if (ids.length === 1 && !found.ambiguous.length) {
    const item = catalog.byId.get(ids[0]);
    const line = found.lines[0];
    const extra = Object.entries(line.options).map(([g, c]) => catalog.options[g]?.choices.find((x) => x.id === c)).filter((c) => c && c.delta).map((c) => `${c.name.toLowerCase()} +${money(Math.round(c.delta * 100), lang)}`);
    return {
      text: L(lang, `${item.name}: ${priceLabel(item, lang)}${item.duration ? ` (${item.duration} min)` : ''}${extra.length ? `; ${extra.join(', ')}` : ''}.`, `${item.name}: ${priceLabel(item, lang)}${item.duration ? ` (${item.duration} min)` : ''}${extra.length ? `; ${extra.join(', ')}` : ''}.`),
      cites: source,
      evidence,
    };
  }
  const group = found.ambiguous[0];
  const cand = group ? group.candidates.map((id) => catalog.byId.get(id)) : ids.map((id) => catalog.byId.get(id));
  if (cand.length) {
    return {
      text: L(lang, 'Estos son los precios.', 'Estes son os prezos.'),
      cards: [{ type: 'menu', title: group?.name ? group.name[0].toUpperCase() + group.name.slice(1) : L(lang, 'Precios', 'Prezos'), rows: menuRows(cand, lang) }],
      cites: source,
      evidence,
    };
  }
  const cat = categoryOf(signals.text, catalog);
  if (cat) return answerMenu({ biz, catalog, lang, signals });
  return {
    text: L(lang, '¿De qué producto quieres saber el precio? Te enseño la carta con todos.', '¿De que produto queres saber o prezo? Ensínoche a carta con todos.'),
    chips: catalog.categories.slice(0, 5).map((c) => ({ label: c.name, text: c.name })),
    cites: source,
    evidence,
  };
}

// --------------------------------------------------------------------------- alérgenos y dietas

export function safeItems(catalog, avoid, tags) {
  const skip = new Set(catalog.categories.filter((c) => c.skip_diet).map((c) => c.id));
  return catalog.items.filter((item) => {
    if (item.no_diet || skip.has(item.category)) return false;
    if (avoid.some((a) => item.contains.includes(a))) return false;
    if (tags.some((t) => !(item.tags.includes(t) || (t === 'vegetariano' && item.tags.includes('vegano'))))) return false;
    return true;
  });
}

export function answerDiet({ catalog, lang, signals }) {
  const { avoid, tags } = signals.diet;
  const names = ALLERGEN_NAMES[lang === 'gl' ? 'gl' : 'es'];
  const label = [
    ...avoid.map((a) => L(lang, `sin ${names[a]}`, `sen ${names[a]}`)),
    ...tags.map((t) => TAG_NAMES[lang === 'gl' ? 'gl' : 'es'][t]),
  ];
  const list = safeItems(catalog, avoid, tags);
  const source = [cite(L(lang, 'Carta y alérgenos', 'Carta e alérxenos'), 'catalog.json')];
  const evidence = [{ step: 'allergens', ok: true, detail: `${list.length} de ${catalog.items.length} productos cumplen: ${label.join(', ')}` }];
  if (!list.length) {
    return {
      text: L(lang, `Ahora mismo no tenemos productos ${listJoin(label, lang)} en la carta. ${SAFETY.es}`, `Agora mesmo non temos produtos ${listJoin(label, lang)} na carta. ${SAFETY.gl}`),
      cites: source,
      evidence,
    };
  }
  const shown = list.slice(0, 5).map((i) => i.name);
  const more = list.length - shown.length;
  return {
    text: L(
      lang,
      `Tenemos ${list.length} productos ${listJoin(label, lang)}: ${more > 0 ? `${shown.join(', ')} y ${more} más` : listJoin(shown, lang)}. ${SAFETY.es}`,
      `Temos ${list.length} produtos ${listJoin(label, lang)}: ${more > 0 ? `${shown.join(', ')} e ${more} máis` : listJoin(shown, lang)}. ${SAFETY.gl}`,
    ),
    cards: [{
      type: 'menu',
      title: L(lang, `Productos ${listJoin(label, lang)}`, `Produtos ${listJoin(label, lang)}`),
      rows: menuRows(list, lang),
    }],
    cites: source,
    evidence,
  };
}

// «¿El brownie lleva gluten?», «¿qué lleva la tarta de queso?»
export function answerContains({ catalog, lang, signals }) {
  const found = findItems(signals.text, catalog);
  const ids = [...new Set(found.lines.map((l) => l.item_id))];
  if (ids.length !== 1) return null;
  const item = catalog.byId.get(ids[0]);
  const names = ALLERGEN_NAMES[lang === 'gl' ? 'gl' : 'es'];
  const has = lineAllergens(catalog, { item_id: item.id, options: found.lines[0].options });
  const asked = signals.diet.avoid;
  const source = [cite(L(lang, 'Carta y alérgenos', 'Carta e alérxenos'), 'catalog.json', item.description)];
  const evidence = [{ step: 'allergens', ok: true, detail: `${item.name}: ${has.length ? has.join(', ') : 'sin alérgenos declarados'}` }];
  let text;
  if (asked.length) {
    const yes = asked.filter((a) => has.includes(a));
    const no = asked.filter((a) => !has.includes(a));
    const parts = [];
    if (yes.length) parts.push(L(lang, `${item.name} contiene ${listJoin(yes.map((a) => names[a]), lang)}.`, `${item.name} contén ${listJoin(yes.map((a) => names[a]), lang)}.`));
    if (no.length) {
      const list = no.map((a) => names[a]);
      const plural = list.length > 1 || /s$/.test(list[0]);
      parts.push(L(lang, `${yes.length ? 'En cambio, no' : 'No'} ${plural ? 'constan' : 'consta'} ${listJoin(list, lang)} entre sus alérgenos declarados.`, `${yes.length ? 'En cambio, non' : 'Non'} ${plural ? 'constan' : 'consta'} ${listJoin(list, lang)} entre os seus alérxenos declarados.`));
    }
    text = `${parts.join(' ')} ${SAFETY[lang === 'gl' ? 'gl' : 'es']}`;
  } else {
    text = has.length
      ? L(lang, `${item.name} contiene ${listJoin(has.map((a) => names[a]), lang)}. ${SAFETY.es}`, `${item.name} contén ${listJoin(has.map((a) => names[a]), lang)}. ${SAFETY.gl}`)
      : L(lang, `${item.name} no tiene alérgenos declarados. ${SAFETY.es}`, `${item.name} non ten alérxenos declarados. ${SAFETY.gl}`);
  }
  return { text, cites: source, evidence };
}

function byTopic(topic, { biz, catalog, lang, signals, now }) {
  const hasHours = Object.values(biz.hours ?? {}).some((r) => r?.length);
  const hasCatalog = catalog.items.length > 0;
  if (topic === 'price') return hasCatalog ? answerPrice({ biz, catalog, lang, signals }) : null;
  if (topic === 'hours') return hasHours ? answerHours({ biz, lang, signals, now }) : null;
  if (topic === 'phone') return answerPhone({ biz, lang });
  if (topic === 'address') {
    if (!biz.address) return null;
    // «aparcamiento», «cómo llegar» tienen más detalle en el documento: que lo cuente la búsqueda.
    if (/\b(?:aparcamiento|aparcar|parking|llegar|autobus|bus|metro|estacionar|estacionamiento|transporte|cerca de)\b/.test(signals.norm)) return null;
    return answerAddress({ biz, lang });
  }
  if (topic === 'menu') return hasCatalog ? answerMenu({ biz, catalog, lang, signals }) : null;
  return null;
}

// -> Reply | null (null: que responda la búsqueda con el modelo)
export function infoReply({ biz, catalog, lang, signals, now }) {
  const topic = signals.topic;
  const catalogHasData = hasAllergenData(catalog);
  const dietCue = signals.diet.free || asksContains(signals.text) || /\b(?:alerg\w*|intoleran\w*|celiac\w*|vegan\w*|vegetarian\w*|puedo (?:comer|pedir|tomar))\b/.test(signals.norm);
  const dietAsked = dietCue && (signals.diet.avoid.length > 0 || signals.diet.tags.length > 0);
  if (dietAsked && catalogHasData) {
    if (asksContains(signals.text) && signals.items.lines.length) {
      const r = answerContains({ catalog, lang, signals });
      if (r) return r;
    }
    if (signals.diet.free || signals.diet.tags.length || signals.asks_options || topic === 'menu') return answerDiet({ catalog, lang, signals });
    if (signals.items.lines.length) {
      const r = answerContains({ catalog, lang, signals });
      if (r) return r;
    }
  }
  if (asksContains(signals.text) && signals.items.lines.length && catalogHasData) {
    const r = answerContains({ catalog, lang, signals });
    if (r) return r;
  }
  if (topic) {
    const r = byTopic(topic, { biz, catalog, lang, signals, now });
    if (r || topic !== 'menu') return r;
  }
  if (signals.items.lines.length && !signals.process_question && /(?:^|\s)(?:tenei?s|teneis|tienen|haceis|hacen)\b|^hay\b|\bque hay\b/.test(signals.norm)) {
    return answerPrice({ biz, catalog, lang, signals });
  }
  if (categoryOf(signals.text, catalog) && /\b(?:tenei?s|teneis|hay|tienen|haceis|hacen|ofreceis)\b/.test(signals.norm)) {
    return answerMenu({ biz, catalog, lang, signals });
  }
  return null;
}

// Varias respuestas calculadas para un mensaje con varias preguntas («¿dónde estáis y a qué hora abrís?»,
// «¿cuánto cuesta el brownie y lleva frutos secos?»). Vacío si hay que recurrir a la búsqueda.
export function infoReplies(ctx) {
  const { signals } = ctx;
  const out = [];
  const add = (r) => {
    if (r && !out.some((o) => o.text === r.text)) out.push(r);
  };
  // El precio primero: infoReply contesta de alérgenos en cuanto oye «lleva» y se lo saltaría.
  if (signals.topic === 'price' && asksContains(signals.text) && signals.items.lines.length) add(byTopic('price', ctx));
  add(infoReply(ctx));
  for (const t of (signals.topics ?? []).slice(0, 3)) {
    if (t !== signals.topic) add(byTopic(t, ctx));
  }
  return out;
}

