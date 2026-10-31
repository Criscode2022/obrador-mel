// Conocimiento de cada negocio: trozos del catálogo y de kb/*.md en Qdrant (colección
// kb_<slug>), búsqueda híbrida (embeddings + palabras) y respuesta con el modelo local
// sin salirse del contexto. Si el modelo falla, se pasa de contexto o inventa un precio o una
// hora, se responde con el texto del propio trozo: la respuesta nunca vale más que sus fuentes.
import { createHash } from 'node:crypto';
import { readEnv } from '../config.mjs';
import { embedModel, ollamaEmbed } from '../llm.mjs';
import { rangesLabel } from './avail.mjs';
import { getBusiness } from './store.mjs';
import { normalize, singular } from './text.mjs';

const QDRANT = () => (readEnv().QDRANT_URL || 'http://127.0.0.1:56333').replace(/\/$/, '');
export const collectionOf = (slug) => `kb_${String(slug).replace(/-/g, '_')}`;
const DAY_ES = { mon: 'lunes', tue: 'martes', wed: 'miércoles', thu: 'jueves', fri: 'viernes', sat: 'sábado', sun: 'domingo' };
const ALLERGEN_ES = {
  gluten: 'gluten', crustaceos: 'crustáceos', huevos: 'huevo', pescado: 'pescado', cacahuetes: 'cacahuetes', soja: 'soja',
  lacteos: 'lácteos', frutos_secos: 'frutos secos', apio: 'apio', mostaza: 'mostaza', sesamo: 'sésamo', sulfitos: 'sulfitos',
  altramuces: 'altramuces', moluscos: 'moluscos',
};

const STOP = new Set(('de la el en y a los se del las un por con no una su para es al lo como mas pero sus le ya o este si '
  + 'porque esta entre cuando muy sin sobre ser tiene tambien me hasta hay donde quien desde todo nos durante todos uno les ni '
  + 'contra otros ese eso ante ellos e esto mi antes algunos unos yo otro otras otra tanto esa estos mucho quienes nada muchos '
  + 'cual poco ella estar estas algunas algo nosotros hola buenas gracias favor quiero queria puedo podeis teneis tienen vuestro '
  + 'vuestra que qué cuanto cuantos cuanta como donde cuando abris vale cuesta tenemos vuestros vuestras os vosotros ustedes '
  + 'podria podrian saber dime decirme digame ola grazas quero teñen').split(' '));

// Palabras que el cliente usa y el local no escribe: se añaden a la consulta para la búsqueda por palabras.
const SYNONYMS = {
  mascota: ['perro'], gato: ['perro', 'mascota'], animal: ['perro'], nino: ['trona', 'infantil'], bebe: ['trona'], pequeno: ['trona'],
  pagar: ['pago', 'tarjeta', 'bizum'], efectivo: ['pago'], movil: ['bizum', 'pago'], contactless: ['pago'],
  coche: ['aparcamiento'], aparcar: ['aparcamiento'], parking: ['aparcamiento'], estacionar: ['aparcamiento'], bus: ['autobus'],
  enchufe: ['wifi'], ordenador: ['portatil', 'trabajar'], portatil: ['trabajar', 'wifi'], internet: ['wifi'],
  cumple: ['cumpleanos', 'celebracion'], cumpleanos: ['celebracion'], celebrar: ['celebracion'], fiesta: ['celebracion', 'evento'],
  regalo: ['tarjeta', 'regalo'], bono: ['bono'], empresa: ['catering', 'factura'], oficina: ['catering'],
  silla: ['accesibilidad', 'trona'], minusvalido: ['accesibilidad'], discapacidad: ['accesibilidad'], rampa: ['accesibilidad'],
  vegetariano: ['vegano'], intolerancia: ['alergeno'], alergia: ['alergeno'], alergico: ['alergeno'], celiaco: ['gluten'],
  cancelar: ['cancelacion'], anular: ['cancelacion'], devolver: ['devolucion'], propina: ['propina'], trabajo: ['empleo'],
  curriculum: ['empleo'], cv: ['empleo'], domicilio: ['envio'], envio: ['domicilio'], llevar: ['recoger'], encargo: ['encargos'],
  tarde: ['horario'], temprano: ['horario'], festivo: ['horario'], domingo: ['horario'], sabado: ['horario'],
};

const contentTokens = (text) => normalize(text).replace(/[^a-z0-9 ]+/g, ' ').split(' ')
  .filter((w) => w.length > 1 && !STOP.has(w)).map(singular);

function pointId(slug, source, heading) {
  const hex = createHash('sha256').update(`${slug}:${source}:${heading}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function factsText(business) {
  const week = Object.keys(DAY_ES).map((d) => {
    const label = rangesLabel((business.hours[d] ?? []).map(([a, b]) => [Number(a.slice(0, 2)) * 60 + Number(a.slice(3)), Number(b.slice(0, 2)) * 60 + Number(b.slice(3))]));
    return `${DAY_ES[d]}: ${label ?? 'cerrado'}`;
  }).join('; ');
  const where = business.address ? ` en ${business.address}` : '';
  const tel = business.phone ? ` Teléfono ${business.phone}.` : '';
  const mail = business.email ? ` Correo ${business.email}.` : '';
  const hours = Object.values(business.hours ?? {}).some((r) => r?.length) ? ` Horario: ${week}.` : '';
  return `${business.name} (${business.label})${where}.${tel}${mail}${hours}`;
}

// Todos los trozos de un negocio: perfil, documentos (una sección = un trozo) y catálogo.
export function chunksOf(slug) {
  const found = getBusiness(slug);
  if (!found) return [];
  const { business, catalog } = found;
  const chunks = [{
    id: pointId(slug, 'perfil', 'Datos del local'),
    source: 'perfil.json',
    title: 'Datos del local',
    heading: 'Datos del local',
    kind: 'perfil',
    text: factsText(business),
  }];
  for (const doc of business.kb) {
    for (const section of doc.sections) {
      chunks.push({
        id: pointId(slug, doc.file, section.heading),
        source: doc.file,
        title: doc.title,
        heading: section.heading,
        kind: 'doc',
        text: section.text,
      });
    }
  }
  for (const item of catalog.items) {
    const cat = catalog.categories.find((c) => c.id === item.category)?.name ?? '';
    const bits = [
      `${item.name} (${cat}).`,
      item.description ?? '',
      `Precio: ${(item.price_cents / 100).toFixed(2).replace('.', ',')} euros${item.price_from ? ' (desde)' : ''}.`,
      item.duration ? `Duración: ${item.duration} minutos.` : '',
      item.tags.length ? `Apto: ${item.tags.map((t) => t.replace(/_/g, ' ')).join(', ')}.` : '',
      item.contains.length ? `Alérgenos: ${item.contains.map((a) => ALLERGEN_ES[a] ?? a).join(', ')}.` : 'Alérgenos: ninguno declarado.',
      item.note ?? '',
    ].filter(Boolean);
    chunks.push({
      id: pointId(slug, 'catalogo.json', item.id),
      source: 'catalogo.json',
      title: 'Carta y catálogo',
      heading: item.name,
      kind: 'item',
      text: bits.join(' '),
    });
  }
  return chunks;
}

// ------------------------------------------------------------------------------ ingesta

async function qdrant(method, urlPath, body) {
  const res = await fetch(`${QDRANT()}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function ensureCollection(name, size) {
  const got = await qdrant('GET', `/collections/${name}`);
  if (got.ok) {
    const data = await got.json();
    const existing = data.result?.config?.params?.vectors?.size;
    if (existing === size) return;
    if (existing) await qdrant('DELETE', `/collections/${name}`);
  }
  const res = await qdrant('PUT', `/collections/${name}`, { vectors: { size, distance: 'Cosine' } });
  if (!res.ok) throw new Error(`qdrant create ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Embebe y guarda los trozos de un negocio. Idempotente (ids estables).
export async function ingestBusiness(slug) {
  const chunks = chunksOf(slug);
  if (!chunks.length) throw new Error(`negocio desconocido: ${slug}`);
  const points = [];
  let size = 0;
  for (const c of chunks) {
    const { vector } = await ollamaEmbed(`search_document: ${c.title} — ${c.heading}\n${c.text}`);
    size = vector.length;
    points.push({ id: c.id, vector, payload: { slug, source: c.source, title: c.title, heading: c.heading, kind: c.kind, text: c.text } });
  }
  const name = collectionOf(slug);
  await ensureCollection(name, size);
  const res = await qdrant('PUT', `/collections/${name}/points?wait=true`, { points });
  if (!res.ok) throw new Error(`qdrant upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { slug, collection: name, chunks: points.length, dim: size, model: embedModel() };
}

const ingested = new Map();
// Ingesta perezosa: la primera consulta a un negocio sin colección la crea (una sola vez a la vez).
export async function ensureIngested(slug) {
  const name = collectionOf(slug);
  if (ingested.get(slug) === true) return true;
  if (ingested.get(slug)?.then) return ingested.get(slug);
  const job = (async () => {
    try {
      const got = await qdrant('GET', `/collections/${name}`);
      if (got.ok) {
        const data = await got.json();
        if ((data.result?.points_count ?? 0) >= chunksOf(slug).length) {
          ingested.set(slug, true);
          return true;
        }
      }
      await ingestBusiness(slug);
      ingested.set(slug, true);
      return true;
    } catch {
      ingested.delete(slug);
      return false;
    }
  })();
  ingested.set(slug, job);
  return job;
}

// ---------------------------------------------------------------------------- búsqueda

const idfCache = new Map();
function idfFor(slug, chunks) {
  const key = `${slug}:${chunks.length}`;
  if (idfCache.has(key)) return idfCache.get(key);
  const df = new Map();
  const docs = chunks.map((c) => new Set(contentTokens(`${c.title} ${c.heading} ${c.heading} ${c.text}`)));
  for (const set of docs) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const n = chunks.length;
  const idf = (t) => Math.log(1 + n / (1 + (df.get(t) ?? 0)));
  const out = { idf, docs, max: Math.log(1 + n) };
  idfCache.set(key, out);
  return out;
}

export function lexical(slug, chunks, query) {
  const base = [...new Set(contentTokens(query))];
  const q = [...new Set([...base, ...base.flatMap((t) => (SYNONYMS[t] ?? []).flatMap(contentTokens))])];
  const { idf, docs, max } = idfFor(slug, chunks);
  const denom = base.reduce((s, t) => s + (docs.some((d) => d.has(t)) ? idf(t) : max), 0) || 1;
  return chunks.map((c, i) => {
    let hit = 0;
    for (const t of q) if (docs[i].has(t)) hit += idf(t);
    // Un token que aparece en el título de la sección pesa más.
    const head = new Set(contentTokens(c.heading));
    for (const t of q) if (head.has(t)) hit += idf(t) * 0.5;
    return Math.min(1, hit / denom);
  });
}

async function vectorHits(slug, query, limit = 8) {
  await ensureIngested(slug);
  const { vector } = await ollamaEmbed(`search_query: ${query}`);
  const name = collectionOf(slug);
  let res = await qdrant('POST', `/collections/${name}/points/query`, { query: vector, limit, with_payload: true });
  if (res.ok) return ((await res.json()).result?.points ?? []);
  res = await qdrant('POST', `/collections/${name}/points/search`, { vector, limit, with_payload: true });
  if (!res.ok) throw new Error(`qdrant search ${res.status}`);
  return ((await res.json()).result ?? []);
}

const COS_FLOOR = 0.42;
// -> { hits: [{ ...chunk, lexical, cosine, score }], degraded, ms }
export async function retrieve(slug, query, { k = 4 } = {}) {
  const t0 = Date.now();
  const chunks = chunksOf(slug);
  const lex = lexical(slug, chunks, query);
  const cos = new Map();
  let degraded = false;
  try {
    for (const p of await vectorHits(slug, query)) cos.set(p.id, Number(p.score || 0));
  } catch {
    degraded = true;
  }
  const hits = chunks.map((c, i) => {
    const cosine = cos.get(c.id) ?? 0;
    const cosN = Math.max(0, Math.min(1, (cosine - COS_FLOOR) / 0.33));
    const score = degraded ? lex[i] : 0.6 * lex[i] + 0.4 * cosN;
    return { ...c, lexical: Number(lex[i].toFixed(3)), cosine: Number(cosine.toFixed(3)), score: Number(score.toFixed(3)) };
  }).sort((a, b) => b.score - a.score).slice(0, k);
  return { hits, degraded, ms: Date.now() - t0 };
}
