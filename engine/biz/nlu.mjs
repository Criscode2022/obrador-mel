// Comprensión determinista del mensaje de quien escribe a un negocio: idioma, qué quiere
// (reservar, pedir, preguntar...), y los datos sueltos (día, hora, personas, servicios,
// productos, nombre, teléfono). Lo que el cliente dice se contrasta después con el
// negocio: aquí solo se lee, no se decide nada.
import { parseWhenBiz } from './dates.mjs';
import { findItems } from './orders.mjs';
import { scrub } from '../pii.mjs';
import { NUMBER_WORDS, normalize, toNumber } from './text.mjs';

const NUM = `(?:\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')})`;

// Palabras que solo existen en gallego (sin tildes), para no confundirlo con castellano.
const GL_ONLY = /\b(?:ola|grazas|obrigad[ao]|quero|teno|unha|duas|dous|onde|cando|canto|custa|hoxe|tamen|nome|abrides|pechades|tenen|tedes|podo|gustariame|facer|recoller|levar|moi|moitas|vosa|voso|cousa|cousas|ben|axudar|axuda|bos dias|boas)\b/g;
const ES_ONLY = /\b(?:hola|gracias|quiero|queria|tengo|una|dos|donde|cuando|cuanto|cuesta|hoy|tambien|nombre|abris|cerrais|teneis|puedo|puede|gustaria|hacer|muy|buenos dias|buenas|bien|ayudar|recoger|hasta|vuestra|vuestro|cosa|cosas|cual|cuales|quien|tiene|tienen|sabe|saben|usar|trabaja|trabajado|esperado|proyectos|cuentame|dime|contar|conoce|habla|idiomas|sus|ha|han)\b/g;

export function detectLang(text, prev = 'es') {
  const t = normalize(text);
  const raw = String(text).toLowerCase();
  const gl = (t.match(GL_ONLY) ?? []).length + (/mañá|(?<![\p{L}])ás(?![\p{L}])|(?<![\p{L}])ó(?![\p{L}])/u.test(raw) ? 1 : 0);
  const es = (t.match(ES_ONLY) ?? []).length;
  if (gl > es) return 'gl';
  if (es > gl) return 'es';
  return prev === 'gl' ? 'gl' : 'es';
}

const R = {
  greet: /^(?:ol[aá]|hola|ola|buenas?|buenos dias|bos dias|boas|buenas tardes|boas tardes|buenas noches|boas noites|hey|ey|saludos|que tal|como estas|como va)\b/,
  thanks: /\b(?:obrigad[oa]|gracias|muchas gracias|mil gracias|grazas|moitas grazas|te lo agradezco|vale gracias|genial gracias|perfecto gracias)\b/,
  bye: /^(?:adeus|adios|hasta luego|hasta pronto|chao|chau|nos vemos|ata logo|ata pronto|vale adios|nada mas|eso es todo|ya esta|ya esta todo)\b/,
  yes: /^(?:si|sii|vale|ok|okey|okay|de acuerdo|perfecto|claro|adelante|confirmo|confirmado|correcto|exacto|eso es|dale|venga|por supuesto|sip|afirmativo|enviar|enviarlo|envialo|mandalo|hazlo|apuntalo|ben|certo|de acordo|si por favor|si gracias|si, por favor|genial|estupendo|lo quiero|me va bien|me viene bien|me cuadra|esa|ese)\b/,
  no: /^(?:no|nop|nope|nel|mejor no|todavia no|aun no|no gracias|no, gracias|ninguno|ninguna|nada|paso|non|nin)\b/,
  cancel: /\b(?:cancela|cancelar|cancelalo|anula|anular|anulalo|olvidalo|olvida|dejalo|borra todo|empezar de nuevo|empezar otra vez|de nuevo|reiniciar|reinicia|cancelo)\b/,
  change: /\b(?:cambiar|cambio|cambia|modificar|modifica|otro dia|otra hora|otro horario|mover|mueve|aplazar|retrasar|adelantar)\b/,
  handoff: /\b(?:hablar con (?:una |un )?(?:persona|alguien|humano|encargad[oa]|responsable|jefe|camarer[oa])|con una persona|una persona real|atencion humana|me pasas con|pasame con|llamadme|llamame|que me llame|queja|reclamacion|reclamar|hoja de reclamaciones|hablar con alguien|persoa real|falar con)\b/,
  booking: /\b(?:reserv\w*|mesa|mesas|cita|citas|hueco|huecos|disponibilidad|disponible|turno|agend\w*|apunt\w*|pedir hora|pedir cita|cita previa|quedar|sitio para|sitio libre|plaza|plazas|hora para)\b/,
  orderStrong: /\b(?:pedido|pedir|pido|pedirte|encargo|encargar|encargarte|para recoger|para llevar|para recoller|para levar|recoger|recoller|ponme|poneme|ponedme|dame|dadme|sirveme|preparame|apuntame|me pones|me pondrias|me preparas|me das|nos pones|nos das)\b/,
  want: /\b(?:quiero|queria|quisiera|quero|quereria|me gustaria|nos gustaria|gustariame|necesito|necesitaria|busco|pongame)\b/,
  question: /\?|\b(?:que|cual|cuales|cuanto|cuantos|cuanta|como|donde|cuando|quien|hay|tenei?s|teneis|aceptais|abris|cerrais|puedo|podemos|se puede|es posible|admiten|permiten|lleva|llevan|incluye|incluyen|vale|cuesta|cuestan|precio|precios|horario|abierto|abiertos|cerrado|sirven|hacen|haceis|ofreceis|tienen|dan|existe|teneis|canto|onde|cando|teñen|tedes|abrides|pechades)\b/,
  injection: /\b(?:ignore (?:all |any )?(?:previous|prior|above|your)|disregard (?:the |all )?(?:previous|above)|you are now|act as|pretend (?:to be|you are)|reveal your (?:prompt|instructions)|show (?:me )?your (?:prompt|instructions)|ignora (?:todas? )?(?:tus|las|lo|todo)|ignore (?:all|previous)|olvida (?:tus|todas|las) (?:instrucciones|reglas)|system prompt|prompt del sistema|tus instrucciones|a partir de ahora (?:eres|actua)|actua como|haz de cuenta|eres ahora|modo desarrollador|jailbreak|dan mode|revela (?:tus|el) (?:prompt|instrucciones))\b/,
  abuse: /\b(?:idiota|imbecil|estupid[oa]|gilipollas|mierda|cabron|puta|joder|coño|hijo de|subnormal|basura de bot|inutil)\b/,
  offtopic: /\b(?:chiste|poema|cancion|adivinanza|capital de|quien gano|futbol|bitcoin|politica|presidente|clima en|tiempo en|programa|codigo|python|javascript|traduce|traducir|matematicas|ecuacion|resuelve)\b/,
  asap: /\b(?:ahora mismo|ya mismo|cuanto antes|lo antes posible|en cuanto puedas|de inmediato|ahora|agora|xa mesmo|canto antes)\b/,
  anyone: /\b(?:cualquiera|cualquier(?:a)?|me da igual|da igual|quien sea|con quien sea|indiferente|sin preferencia|el que (?:este|haya|tenga)|lo que haya|calquera|me es igual|me es indiferente)\b/,
  noNotes: /^(?:no|nada|ninguna|ninguno|sin notas|sin nada|ni una|todo bien|no gracias|non|nada mais|nada mas)\b/,
};

// -------------------------------------------------------------- datos de contacto

const NAME_STOP = new Set([
  'si', 'no', 'vale', 'ok', 'hola', 'ola', 'gracias', 'grazas', 'cancela', 'cancelar', 'nada', 'ninguno', 'ninguna',
  'perfecto', 'claro', 'quiero', 'nombre', 'telefono', 'mesa', 'cita', 'pedido', 'cambiar', 'adios', 'buenas',
  'buenos', 'dias', 'tardes', 'noches', 'sin', 'con', 'para', 'por', 'favor', 'que', 'como', 'cuando', 'donde',
  'reserva', 'reservar', 'enviar', 'confirmo', 'confirmar', 'listo', 'ya', 'si,', 'hoy', 'manana', 'ahora',
  'celiaco', 'celiaca', 'vegano', 'vegana', 'alergico', 'alergica', 'intolerante', 'cliente', 'nuevo', 'nueva',
]);

function titleCase(name) {
  return name
    .split(/\s+/)
    .map((w, i) => (['de', 'del', 'la', 'las', 'los', 'da', 'do', 'y', 'e'].includes(w.toLowerCase()) && i > 0
      ? w.toLowerCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

// «a nombre de Iria», «soy Iria Castro», o una respuesta corta cuando se estaba pidiendo el nombre.
export function extractName(text, { expecting = false } = {}) {
  const raw = String(text ?? '').trim();
  const m = raw.match(/\b(a nombre de|a nome de|me llamo|mi nombre es|soy|son|chamome|chámome|o meu nome é|pon(?:lo|erlo)? a nombre de)\s+((?:[\p{L}'-]+)(?:\s+(?:de |del |da |do )?[\p{L}'-]+){0,3})/iu);
  if (m) {
    const bare = /^(?:soy|son)$/i.test(m[1]);
    let words = m[2].split(/\s+/);
    // «soy celíaca», «soy vegano»: solo es un nombre si empieza por mayúscula.
    if (bare && !/^\p{Lu}/u.test(words[0])) return null;
    words = words.filter((w) => !NAME_STOP.has(normalize(w)) && !/\d/.test(w));
    if (words.length) return titleCase(words.slice(0, 3).join(' '));
  }
  if (!expecting) return null;
  const plain = raw.replace(/[.!¡¿?,;:]+$/g, '').trim();
  if (plain.length < 2 || plain.length > 40 || /\d/.test(plain)) return null;
  const parts = plain.split(/\s+/);
  if (parts.length > 4) return null;
  if (parts.some((w) => NAME_STOP.has(normalize(w)))) return null;
  if (!/^[\p{L}][\p{L}' .-]*$/u.test(plain)) return null;
  return titleCase(plain);
}

export function extractPhone(text) {
  const m = String(text ?? '').replace(/(\d)[\s.-](?=\d)/g, '$1').match(/(?:\+34|0034)?\b([6-9]\d{8})\b/);
  return m ? m[1] : null;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
export function extractEmail(text) {
  const m = String(text ?? '').match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}

// ----------------------------------------------------------------------- comensales y servicios

export function extractParty(text, { expecting = false } = {}) {
  const t = normalize(text);
  const groups = [...t.matchAll(new RegExp(`\\b(${NUM})\\s+(?:adultos?|ninos?|ninas?|criaturas|bebes?|peques?|mayores|jovenes|ninos)\\b`, 'g'))];
  if (groups.length) {
    const n = groups.reduce((s, g) => s + (toNumber(g[1]) ?? 0), 0);
    if (n) return n;
  }
  let m = t.match(new RegExp(`\\b(${NUM})\\s+(?:personas?|pax|comensales|persoas?|gente)\\b`));
  if (m) return toNumber(m[1]);
  m = t.match(new RegExp(`\\b(?:para|somos|seremos|seriamos|mesa de|mesa para|grupo de|sitio para|sitio de|cabida para)\\s+(${NUM})\\b(?!\\s*(?::|h\\b|horas|de (?:la|el|los|las) ))`));
  if (m) {
    const n = toNumber(m[1]);
    // «para las 9» no entra aquí (tras «para» va «las»); «para 2» sí.
    if (n) return n;
  }
  m = t.match(new RegExp(`\\bsomos\\s+(${NUM})\\b`));
  if (m) return toNumber(m[1]);
  if (expecting) {
    m = t.match(new RegExp(`^\\s*(?:para\\s+|somos\\s+)?(${NUM})\\s*(?:personas?|pax|comensales)?\\s*$`));
    if (m) return toNumber(m[1]);
  }
  return null;
}

export function extractResource(text, biz) {
  if (biz.booking?.mode !== 'staff') return null;
  const t = normalize(text);
  for (const r of biz.booking.resources) {
    const name = normalize(r.name);
    if (new RegExp(`\\b${name}\\b`).test(t)) return r.id;
  }
  if (R.anyone.test(t)) return 'any';
  return null;
}

// -------------------------------------------------------------------------- reglas de rechazo

// Rechazos propios del negocio (business.json -> refusals) y los comunes a todos.
export function refusalFor(text, biz, flags = []) {
  const t = normalize(text);
  if (flags.includes('card')) return { id: 'card' };
  if (R.injection.test(t)) return { id: 'injection' };
  for (const r of biz.refusals ?? []) {
    if (new RegExp(r.pattern, 'i').test(t)) return { id: r.id, reply: r.reply, handoff: Boolean(r.handoff) };
  }
  if (R.abuse.test(t)) return { id: 'abuse' };
  return null;
}

// ------------------------------------------------------------------------------ tema de consulta

// Qué alérgenos y dietas se mencionan: «sin gluten», «soy celíaca», «alérgico a los frutos secos».
const ALLERGEN_WORDS = {
  gluten: ['gluten', 'celiac', 'celiaco', 'celiaca', 'celiacos', 'trigo', 'harina'],
  lacteos: ['lactosa', 'lacteo', 'lacteos', 'leche de vaca', 'intolerante a la lactosa'],
  huevos: ['huevo', 'huevos', 'ovo'],
  frutos_secos: ['frutos secos', 'fruto seco', 'nueces', 'nuez', 'almendra', 'almendras', 'avellana', 'avellanas', 'pistacho'],
  pescado: ['pescado', 'pescados', 'peixe'],
  crustaceos: ['crustaceo', 'crustaceos', 'marisco', 'mariscos', 'gambas', 'langostino', 'langostinos', 'bogavante'],
  moluscos: ['molusco', 'moluscos', 'mejillon', 'mejillones', 'almeja', 'almejas', 'berberecho', 'pulpo', 'calamar'],
  soja: ['soja'],
  cacahuetes: ['cacahuete', 'cacahuetes', 'mani'],
  sesamo: ['sesamo'],
  mostaza: ['mostaza'],
  apio: ['apio'],
  sulfitos: ['sulfito', 'sulfitos'],
  altramuces: ['altramuz', 'altramuces'],
};
const DIET_WORDS = {
  vegano: ['vegano', 'vegana', 'veganos', 'veganas', 'vegan'],
  vegetariano: ['vegetariano', 'vegetariana', 'vegetarianos', 'vegetarianas', 'veggie'],
};

export function detectDiet(text) {
  const t = ` ${normalize(text).replace(/[^a-z0-9 ]+/g, ' ')} `;
  const avoid = new Set();
  for (const [allergen, words] of Object.entries(ALLERGEN_WORDS)) {
    if (words.some((w) => t.includes(` ${w} `) || t.includes(` ${w}s `))) avoid.add(allergen);
  }
  const tags = [];
  for (const [tag, words] of Object.entries(DIET_WORDS)) if (words.some((w) => t.includes(` ${w} `))) tags.push(tag);
  const free = /\b(?:sin|libre de|libres de|apto para|apta para|aptos para|alergic[oa]s? a|alergia a|intolerante a|intolerancia a|celiac[oa]s?|intolerante|alergia|sen)\b/.test(normalize(text)) || /celiac/.test(t);
  return { avoid: [...avoid], tags, free: Boolean(free) && (avoid.size > 0 || /celiac/.test(t)) };
}

// «lleva frutos secos», «contiene gluten», «tiene huevo»: pregunta por un producto concreto.
export function asksContains(text) {
  return /\b(?:lleva|llevan|contiene|contienen|tiene|tienen|incluye|incluyen|esta hecho|hecho con|lleva algo)\b/.test(normalize(text));
}

// Formas distintas de pedir lo mismo. Todo sobre texto sin tildes ni mayúsculas.
const HOURS_VERB = '(?:abr\\w*|abre\\w*|abiert\\w*|aberto\\w*|cerr\\w*|cierr\\w*|pech\\w*|empiez\\w*|comienz\\w*|termin\\w*|acab\\w*|serv\\w*|atend\\w*|esta(?:is|n|mos)? (?:aqui|ahi|por ahi|en el local)|descans\\w*)';
export const TOPICS = {
  hours: new RegExp(
    '\\b(?:horarios?|festivos?|dias? de (?:apertura|cierre|descanso|servicio)|que dias|cuantos dias|'
    + `(?:cuando|cando|hasta cuando|ata cando|desde cuando|a que hora|hasta que hora|ata que hora|desde que hora|dende que hora|a partir de que hora|en que horario|que hora) (?:\\w+ )?${HOURS_VERB}|`
    + `${HOURS_VERB} (?:a mediodia|por la tarde|por la noche|por la manana|todo el dia|los (?:lunes|martes|miercoles|jueves|viernes|sabados|domingos|festivos|fines de semana)|el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|luns|xoves|venres)|hoy|manana|hoxe|ahora|ya)|`
    + 'esta\\w* (?:abiert\\w*|cerrad\\w*|aberto\\w*|pechad\\w*)|hasta que hora|hasta cuando (?:estais|estan|abri|abre)|a partir de que hora|desde que hora (?:abri|abre|serv|atend|puedo)|'
    + `a que hora (?:\\w+ ){0,2}${HOURS_VERB}|`
    + '(?:abri|abre|abren|cerrais|cierra|cierran|abrides|pechades|abris|abrireis|abrira|abriran)\\b|'
    + 'a que hora (?:abri|abre|abren|cerr|cierr)|cuando puedo (?:ir|pasar|venir)|hora de (?:apertura|cierre)|cierre|apertura)\\b',
  ),
  address: /\b(?:direccion|ubicacion|localizacion|ubicad[oa]s?|donde (?:estais|esta|estan|queda|se encuentra|os encontrais|es|se llega|estades|queda)|onde (?:estades|queda|estan)|como (?:llegar|llego|se llega|ir)|en que (?:calle|zona|barrio)|que calle|mapa|como os encuentro|por donde|calle|aparcamiento|parking|aparcar|estacionamiento|transporte|autobus|cerca de)\b/,
  phone: /\b(?:contactar|telefono|tlf|tfno|llamaros|llamar(?:os|les)?|puedo llamar|numero(?: de (?:contacto|telefono|movil))?|movil|whatsapp|wasap|correo|email|e-mail|mail|contactar(?:os)?|contacto|como (?:os )?contacto|chamar|telefonar)\b/,
  price: /\b(?:cuanto (?:cuesta|cuestan|vale|valen|es|sale|salen|cobrais|cobras|costaria|me cuesta|me sale|cobran)|a cuanto|precio|precios|tarifa|tarifas|cuesta|cuestan|costo|costes?|prezo|prezos|canto (?:custa|valen|e)|que (?:cuesta|vale|precio)|presupuesto)\b/,
  menu: /\b(?:carta|menu|menus|que (?:tenei?s|teneis|haceis|servis|ofreceis|ponen|hay|tienen|sirven|hacen|ofrecen|podemos pedir|puedo pedir|servicios|productos|se puede pedir|hay para (?:comer|cenar|desayunar|merendar|beber|tomar))|opciones|ofrecen|productos|servicios|catalogo|lista de|que se puede|que carta|que (?:cosas )?haceis|que tratamientos|que (?:tipos|clase)|que ofrece|especialidad(?:es)?|recomend\w+|sugerenci\w+)\b/,
};

// Todos los temas que toca un mensaje, en orden de aparición («¿dónde estáis y a qué hora abrís?»).
export function detectTopics(text) {
  const t = normalize(text);
  const found = [];
  for (const [name, re] of Object.entries(TOPICS)) {
    const m = t.match(re);
    if (m) found.push({ name, at: m.index ?? 0 });
  }
  return found.sort((x, y) => x.at - y.at).map((f) => f.name);
}

// Una segunda pregunta pegada a la primera («...y se puede ir con perro?»): el modelo la completa.
export function hasExtraQuestion(norm, raw = '') {
  return (raw.match(/\?/g) ?? []).length >= 2
    || /\by (?:tambien |ademas )?(?:se puede|puedo|podemos|teneis|tienen|hay|aceptais|admiten|permiten|haceis|hacen|ofreceis|es posible|como|donde|cuando)\b/.test(norm);
}

// ----------------------------------------------------------------------------------- análisis

const clean = (s) => normalize(s).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// -> señales del mensaje. `state` aporta lo que se estaba preguntando (`awaiting`).
export function analyze(text, { biz, catalog, state = {}, now = new Date() }) {
  const raw = String(text ?? '');
  const scrubbed = scrub(raw);
  const t = clean(scrubbed.text);
  const lang = detectLang(raw, state.lang ?? 'es');
  const caps = new Set(biz.capabilities);
  const awaiting = state.awaiting ?? null;

  const words = t ? t.split(' ') : [];
  const short = words.length <= 5;
  const items = findItems(scrubbed.text, catalog);
  const when = parseWhenBiz(scrubbed.text, {
    biz,
    now,
    ymdHint: state.booking?.ymd ?? state.order?.ymd ?? null,
    bare: ['time', 'pickup', 'pick_slot'].includes(awaiting),
  });

  const hasItems = items.lines.length > 0 || items.ambiguous.length > 0;
  // Un negocio que solo informa no reserva ni pide: ahí «mesa» es una palabra normal.
  const transactional = caps.has('booking') || caps.has('order');
  const bookingKw = transactional && R.booking.test(t);
  // «¿qué puedo pedir?» pregunta por las opciones: no es un pedido.
  const asksOptions = /\bque (?:puedo|podemos|se puede|me|nos)\s*(?:\w+ )?(?:pedir|tomar|comer|beber|recomiendas|recomendais|aconsejas)\b|\brecomend\w+|\bque pido\b/.test(t);
  const wantKw = R.want.test(t);
  const asking = R.question.test(raw) || R.question.test(t);
  // «¿cuánta antelación hay que...?», «¿cómo se encarga?»: pregunta por el proceso, no pide nada.
  const processQuestion = asking && !wantKw
    && /\b(?:cuanta|cuanto|cuantos|cuantas|como|cuando|donde|cual|cuales|por que|hay que|hace falta|se puede|se pueden|es posible|que (?:antelacion|plazo|tiempo))\b/.test(t)
    && !/\b(?:ponme|dame|me pones|me das|preparame|apuntame)\b/.test(t);
  const orderKw = transactional && R.orderStrong.test(t) && !asksOptions && !processQuestion;
  const refusal = refusalFor(scrubbed.text, biz, scrubbed.flags);
  const diet = detectDiet(scrubbed.text);
  const topics = detectTopics(scrubbed.text);
  const topic = topics[0] ?? null;

  const signals = {
    raw,
    text: scrubbed.text,
    norm: t,
    lang,
    flags: scrubbed.flags,
    short,
    greet: R.greet.test(t) && short,
    thanks: R.thanks.test(t) && short,
    bye: R.bye.test(t),
    yes: R.yes.test(t) && short,
    no: R.no.test(t) && short,
    cancel: R.cancel.test(t),
    change: R.change.test(t),
    handoff: R.handoff.test(t) || (biz.handoff_topics ?? []).some((k) => t.includes(normalize(k).trim())),
    asap: R.asap.test(t) || when.asap,
    anyone: R.anyone.test(t),
    no_notes: R.noNotes.test(t),
    offtopic: R.offtopic.test(t),
    question: asking,
    booking_kw: bookingKw,
    order_kw: orderKw,
    want_kw: wantKw,
    asks_options: asksOptions,
    process_question: processQuestion,
    has_items: hasItems,
    items,
    when,
    party: extractParty(scrubbed.text, { expecting: awaiting === 'party' }),
    resource: extractResource(scrubbed.text, biz),
    name: extractName(scrubbed.text, { expecting: awaiting === 'name' }) ?? null,
    phone: extractPhone(scrubbed.text),
    email: extractEmail(scrubbed.text),
    diet,
    topic,
    topics,
    refusal,
  };

  // Intención principal.
  let primary = 'info';
  if (refusal) primary = 'refuse';
  else if (signals.handoff) primary = 'handoff';
  else if (signals.cancel && !hasItems) primary = 'cancel';
  else if (awaiting && (signals.yes || signals.no) && short) primary = signals.yes ? 'yes' : 'no';
  else if (bookingKw && (caps.has('booking') || !caps.has('order'))) primary = 'booking';
  else if ((orderKw || (hasItems && (wantKw || !asking))) && caps.has('order') && !processQuestion && !(bookingKw && !hasItems)) primary = 'order';
  else if (bookingKw) primary = 'booking_unsupported';
  else if ((orderKw || (hasItems && wantKw)) && !caps.has('order') && biz.booking?.mode !== 'staff') primary = 'order_unsupported';
  else if (signals.thanks) primary = 'thanks';
  else if (signals.bye) primary = 'bye';
  else if (signals.greet) primary = 'greet';
  else if (signals.offtopic) primary = 'offtopic';
  else if (hasItems && biz.booking?.mode === 'staff' && (signals.want_kw || !signals.question)) primary = 'booking';
  else if (signals.yes) primary = 'yes';
  else if (signals.no) primary = 'no';
  signals.primary = primary;
  return signals;
}

