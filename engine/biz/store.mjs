// Carga de los negocios desde datasets/<slug>/:
//   business.json  identidad, horario, reglas de reserva o pedido y tono del asistente
//   catalog.json   carta, servicios o productos (precios en euros, alérgenos, opciones)
//   kb/*.md        conocimiento del negocio; cada «## sección» es un trozo que se puede citar
// Son datos de demostración, no cuentas: no hay multi-inquilino ni credenciales por negocio.
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../config.mjs';
import { normalize, singular } from './text.mjs';

export const DATA_DIR = path.join(root, 'datasets');
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const ALLERGENS = [
  'gluten', 'crustaceos', 'huevos', 'pescado', 'cacahuetes', 'soja', 'lacteos', 'frutos_secos',
  'apio', 'mostaza', 'sesamo', 'sulfitos', 'altramuces', 'moluscos',
];
export const TAGS = ['vegano', 'vegetariano', 'sin_gluten', 'sin_lactosa', 'sin_azucar'];
const CAPABILITIES = new Set(['info', 'booking', 'order']);
const MODES = new Set(['tables', 'staff']);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const MAX_SECTION = 1400;

// Parte un texto largo por párrafos en trozos de ~1400 caracteres.
function splitLong(text) {
  if (text.length <= MAX_SECTION) return [text];
  const out = [];
  let cur = '';
  for (const para of text.split(/\n{2,}/)) {
    if (cur && cur.length + para.length > MAX_SECTION) {
      out.push(cur.trim());
      cur = '';
    }
    cur += `${para}\n\n`;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Cada «## sección» de un .md es un trozo con su título y su texto (lo que hay antes del primer ## también).
// Un .md en una subcarpeta lleva el nombre de la carpeta en el título para que el trozo se entienda suelto.
export function parseMarkdown(file, body, root = null) {
  const lines = String(body).replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  let title = path.basename(file, '.md');
  const sections = [];
  let current = null;
  let fenced = false;
  for (const line of lines) {
    if (/^```/.test(line)) fenced = !fenced;
    const h1 = !fenced && line.match(/^#\s+(.+)$/);
    const h2 = !fenced && line.match(/^##\s+(.+)$/);
    if (h1 && !sections.length && !current) {
      title = h1[1].trim();
      current = { heading: title, text: '' };
      sections.push(current);
    } else if (h2) {
      current = { heading: h2[1].trim(), text: '' };
      sections.push(current);
    } else if (current) {
      current.text += `${line}\n`;
    }
  }
  const folder = root ? path.relative(root, path.dirname(file)) : '';
  const prefix = folder ? `${folder.split(path.sep).join(' / ')} — ` : '';
  const parts = [];
  for (const sec of sections) {
    const text = sec.text.trim();
    if (!text) continue;
    const chunks = splitLong(text);
    chunks.forEach((chunk, i) => parts.push({ heading: chunks.length > 1 ? `${sec.heading} (${i + 1}/${chunks.length})` : sec.heading, text: chunk }));
  }
  return { file: root ? path.relative(root, file).split(path.sep).join('/') : path.basename(file), title: `${prefix}${title}`, sections: parts };
}

// Todos los .md de kb/, también en subcarpetas (kb/proyectos/<proyecto>/01-resumen.md), en orden estable.
function markdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(p));
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

export function validateBusiness(b, dirName = b?.slug) {
  const problems = [];
  const bad = (msg) => problems.push(`${dirName}: ${msg}`);
  if (!b || typeof b !== 'object') return [`${dirName}: business.json vacío`];
  if (b.slug !== dirName) bad(`slug «${b.slug}» no coincide con la carpeta`);
  if (!/^[a-z0-9-]+$/.test(String(b.slug))) bad('slug inválido');
  for (const k of ['name', 'kind', 'label', 'tagline', 'city', 'address', 'phone', 'email']) {
    if (!b[k] || typeof b[k] !== 'string') bad(`falta «${k}»`);
  }
  if (!Array.isArray(b.capabilities) || !b.capabilities.includes('info')) bad('capabilities debe incluir «info»');
  for (const c of b.capabilities ?? []) if (!CAPABILITIES.has(c)) bad(`capacidad desconocida «${c}»`);

  for (const day of DAYS) {
    for (const range of b.hours?.[day] ?? []) {
      if (!HHMM.test(range?.[0]) || !HHMM.test(range?.[1]) || toMin(range[0]) >= toMin(range[1])) {
        bad(`horario «${day}» inválido: ${JSON.stringify(range)}`);
      }
    }
  }
  if (!DAYS.some((d) => b.hours?.[d]?.length)) bad('el horario no tiene ningún día abierto');
  for (const d of b.closed_dates ?? []) if (!YMD.test(d)) bad(`fecha de cierre inválida «${d}»`);

  const g = b.assistant?.greeting;
  if (!g?.es || !g?.gl) bad('assistant.greeting necesita es y gl');
  if (!Array.isArray(b.assistant?.suggestions) || !b.assistant.suggestions.length) bad('faltan assistant.suggestions');

  if (b.capabilities?.includes('booking')) {
    const k = b.booking;
    if (!k || !MODES.has(k.mode)) bad('booking.mode debe ser tables o staff');
    else if (k.mode === 'tables') {
      if (!Array.isArray(k.tables) || !k.tables.length) bad('booking.tables vacío');
      if (!k.party?.max) bad('booking.party.max falta');
    } else {
      if (!Array.isArray(k.resources) || !k.resources.length) bad('booking.resources vacío');
      for (const r of k.resources ?? []) {
        if (!r.id || !r.name) bad('un recurso necesita id y name');
        for (const day of DAYS) {
          for (const range of r.hours?.[day] ?? []) {
            if (!HHMM.test(range?.[0]) || !HHMM.test(range?.[1])) bad(`recurso ${r.id}: horario «${day}» inválido`);
          }
        }
      }
    }
  }
  if (b.capabilities?.includes('order') && !b.order) bad('falta el bloque «order»');
  return problems;
}

export function validateCatalog(c, b) {
  const problems = [];
  const bad = (msg) => problems.push(`${b.slug}/catalog: ${msg}`);
  if (!Array.isArray(c?.categories) || !c.categories.length) return [`${b.slug}/catalog: sin categorías`];
  const cats = new Set();
  for (const cat of c.categories) {
    if (!cat.id || !cat.name) bad('categoría sin id o name');
    if (cats.has(cat.id)) bad(`categoría repetida «${cat.id}»`);
    cats.add(cat.id);
  }
  const options = c.options ?? {};
  for (const [id, opt] of Object.entries(options)) {
    const ids = new Set((opt.choices ?? []).map((x) => x.id));
    if (!ids.size) bad(`opción «${id}» sin choices`);
    if (!opt.required && !ids.has(opt.default)) bad(`opción «${id}»: el valor por defecto no existe`);
    if (opt.required && opt.default) bad(`opción «${id}»: obligatoria y con valor por defecto`);
  }
  const ids = new Set();
  for (const item of c.items ?? []) {
    if (!item.id || !item.name) { bad('elemento sin id o name'); continue; }
    if (ids.has(item.id)) bad(`id repetido «${item.id}»`);
    ids.add(item.id);
    if (!cats.has(item.category)) bad(`${item.id}: categoría «${item.category}» no existe`);
    if (typeof item.price !== 'number' || item.price < 0) bad(`${item.id}: precio inválido`);
    for (const a of item.contains ?? []) if (!ALLERGENS.includes(a)) bad(`${item.id}: alérgeno desconocido «${a}»`);
    for (const t of item.tags ?? []) if (!TAGS.includes(t)) bad(`${item.id}: etiqueta desconocida «${t}»`);
    for (const o of item.options ?? []) if (!options[o]) bad(`${item.id}: opción «${o}» no existe`);
    if (b.booking?.mode === 'staff' && item.category !== 'productos' && item.duration == null && !item.no_duration) {
      bad(`${item.id}: falta duration (minutos)`);
    }
  }
  for (const [key, amb] of Object.entries(c.ambiguous ?? {})) {
    for (const cand of amb.candidates ?? []) if (!ids.has(cand)) bad(`ambiguous «${key}»: «${cand}» no existe`);
  }
  if (b.booking?.mode === 'staff') {
    for (const r of b.booking.resources) {
      if (r.services === 'all' || r.services == null) continue;
      for (const s of r.services) if (!ids.has(s)) bad(`recurso ${r.id}: servicio «${s}» no existe`);
    }
  }
  return problems;
}

// Qué frases del cliente apuntan a cada elemento: nombre y alias, ya normalizados y en singular.
function phrasesOf(item) {
  const all = [item.name, ...(item.aliases ?? [])];
  const out = new Set();
  for (const text of all) {
    // «^con leche»: solo vale al empezar la frase o tras una cantidad («dos con leche»), no tras otro producto.
    const weak = String(text).startsWith('^');
    const norm = normalize(text).replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!norm.length) continue;
    out.add(`${weak ? '^' : ''}${norm.map(singular).join(' ')}`);
  }
  return [...out];
}

// Lee y comprueba un negocio de una carpeta. -> { business, catalog, problems }
export function loadBusiness(dir, slug = path.basename(dir)) {
  const business = readJson(path.join(dir, 'business.json'));
  const catalogFile = path.join(dir, 'catalog.json');
  const catalog = fs.existsSync(catalogFile) ? readJson(catalogFile) : { categories: [], items: [] };
  business.hours ??= {};
  const problems = [...validateBusiness(business, slug), ...validateCatalog(catalog, business)];
  const kbDir = path.join(dir, 'kb');
  const docs = fs.existsSync(kbDir)
    ? markdownFiles(kbDir).map((f) => parseMarkdown(f, fs.readFileSync(f, 'utf8'), kbDir))
    : [];
  if (!docs.length) problems.push(`${slug}: no hay documentos en kb/`);
  const byId = new Map();
  for (const item of catalog.items) {
    const price_cents = Math.round(item.price * 100);
    byId.set(item.id, { ...item, price_cents, phrases: phrasesOf(item), tags: item.tags ?? [], contains: item.contains ?? [], options: item.options ?? [] });
  }
  return {
    business: { ...business, kb: docs },
    catalog: { ...catalog, items: [...byId.values()], byId },
    problems,
  };
}

let cache = { at: 0, sig: '', list: new Map(), problems: [] };

function signature() {
  if (!fs.existsSync(DATA_DIR)) return 'none';
  const parts = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else parts.push(`${p}:${st.mtimeMs}`);
    }
  };
  walk(DATA_DIR);
  return parts.join('|');
}

function load(force = false) {
  const now = Date.now();
  if (!force && cache.sig && now - cache.at < 2000) return cache;
  const sig = signature();
  if (!force && sig === cache.sig) {
    cache.at = now;
    return cache;
  }
  const list = new Map();
  const problems = [];
  if (fs.existsSync(DATA_DIR)) {
    for (const entry of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const built = loadBusiness(path.join(DATA_DIR, entry.name), entry.name);
        if (built.problems.length) problems.push(...built.problems);
        else list.set(entry.name, built);
      } catch (err) {
        problems.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  cache = { at: now, sig, list, problems };
  return cache;
}

export function datasetProblems() {
  return load(true).problems;
}

export function validSlug(slug) {
  return /^[a-z0-9-]{2,40}$/.test(String(slug || ''));
}

// -> { business, catalog } o null. Los negocios con errores no se cargan: se ven en datasetProblems().
export function getBusiness(slug) {
  if (!validSlug(slug)) return null;
  const found = load().list.get(slug);
  return found ?? null;
}

export function allSlugs() {
  return [...load().list.keys()].sort();
}

export function listBusinesses() {
  const out = [];
  for (const { business } of load().list.values()) {
    out.push({
      slug: business.slug,
      name: business.name,
      label: business.label,
      kind: business.kind,
      tagline: business.tagline,
      city: business.city,
      capabilities: business.capabilities,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// Lo que ve la web pública: perfil, carta y reglas visibles. Sin los textos internos del motor.
export function publicProfile(slug) {
  const found = getBusiness(slug);
  if (!found) return null;
  const { business: b, catalog: c } = found;
  return {
    slug: b.slug,
    name: b.name,
    label: b.label,
    kind: b.kind,
    tagline: b.tagline,
    city: b.city,
    address: b.address,
    phone: b.phone,
    email: b.email,
    capabilities: b.capabilities,
    hours: b.hours,
    closed_dates: b.closed_dates ?? [],
    assistant: b.assistant,
    booking: b.booking
      ? {
        mode: b.booking.mode,
        party: b.booking.party ?? null,
        horizon_days: b.booking.horizon_days ?? null,
        resources: (b.booking.resources ?? []).map((r) => ({ id: r.id, name: r.name, role: r.role ?? '' })),
      }
      : null,
    order: b.order
      ? { prep_minutes: b.order.prep_minutes, horizon_days: b.order.horizon_days, pay: b.order.pay, need_phone: Boolean(b.order.need_phone) }
      : null,
    catalog: {
      categories: c.categories,
      options: c.options ?? {},
      items: c.items.map((i) => ({
        id: i.id,
        category: i.category,
        name: i.name,
        price_cents: i.price_cents,
        price_from: Boolean(i.price_from),
        description: i.description ?? '',
        tags: i.tags,
        contains: i.contains,
        options: i.options,
        duration: i.duration ?? null,
        popular: Boolean(i.popular),
        note: i.note ?? '',
        lead_hours: i.lead_hours ?? null,
      })),
    },
  };
}
