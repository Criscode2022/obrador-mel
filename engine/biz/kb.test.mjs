import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerFromKb, chunksOf, collectionOf, factsText, lexical, unsupportedFacts,
} from './kb.mjs';
import { getBusiness, parseMarkdown } from './store.mjs';

const { business } = getBusiness('pasteleria');
const NOW = new Date('2026-10-15T08:00:00Z');
const chunks = chunksOf('pasteleria');
const ranked = (query) => {
  const scores = lexical('pasteleria', chunks, query);
  return chunks.map((c, i) => [c.heading, scores[i]]).sort((a, b) => b[1] - a[1]).map(([heading]) => heading);
};
const top = (query) => ranked(query)[0];
const HIT = { kind: 'doc', title: 'Encargos y plazos', heading: 'Plazos de encargo', source: 'encargos-y-plazos.md', text: 'Las tartas clásicas se encargan con 48 horas de antelación. La de Santiago, con 24.', score: 0.8 };
const ask = (content) => async () => ({ model: 'prueba', content, tokens_in: 10, tokens_out: 5, ms: 1 });
const answer = (complete, hits = [HIT]) => answerFromKb({ biz: business, slug: 'pasteleria', text: '¿qué plazo hay?', hits, now: NOW, complete });

test('cada sección de un .md es un trozo citable', () => {
  const doc = parseMarkdown('kb/plazos.md', '# Encargos\n\nIntro.\n\n## Plazos\nCon 48 horas.\n\n## Recogida\nEn el obrador.\n');
  assert.equal(doc.title, 'Encargos');
  assert.deepEqual(doc.sections.map((s) => s.heading), ['Encargos', 'Plazos', 'Recogida']);
});

test('un ## dentro de un bloque de código no abre sección', () => {
  const doc = parseMarkdown('kb/a.md', '## Uno\n```\n## no es sección\n```\n');
  assert.equal(doc.sections.length, 1);
});

test('una sección larga se parte por párrafos', () => {
  const para = 'palabra '.repeat(120).trim();
  const doc = parseMarkdown('kb/a.md', `## Largo\n${para}\n\n${para}\n\n${para}\n`);
  assert.equal(doc.sections.length, 3);
  assert.match(doc.sections[0].heading, /\(1\/3\)$/);
});

test('el negocio se trocea en perfil, documentos y catálogo', () => {
  const kinds = new Set(chunks.map((c) => c.kind));
  assert.deepEqual([...kinds].sort(), ['doc', 'item', 'perfil']);
  assert.equal(chunks.filter((c) => c.kind === 'item').length, 19);
  assert.equal(new Set(chunks.map((c) => c.id)).size, chunks.length, 'ids estables y sin repetir');
});

test('los datos del local van en una sola frase para la búsqueda', () => {
  assert.match(factsText(business), /Obrador Mel \(Pastelería\).*Rúa do Franco 27.*lunes: cerrado/);
});

test('la colección se nombra por negocio', () => {
  assert.equal(collectionOf('pasteleria'), 'kb_pasteleria');
  assert.equal(collectionOf('mi-negocio'), 'kb_mi_negocio');
});

test('la búsqueda por palabras encuentra la sección correcta', () => {
  assert.equal(top('¿dónde puedo aparcar?'), 'Aparcamiento');
  assert.equal(top('¿cómo conservo una tarta en la nevera?'), 'Cómo conservar una tarta');
  assert.equal(top('¿hacéis envíos a domicilio?'), 'Recogida');
  assert.equal(top('¿se pueden congelar las tartas?'), 'Congelar');
});

test('los sinónimos acercan las palabras del cliente a las del negocio', () => {
  assert.equal(top('¿tengo sitio para aparcar el coche?'), 'Aparcamiento');
});

test('cifras: lo que no está en el contexto es invención', () => {
  const ctx = 'Las tartas clásicas cuestan 22 € y se encargan con 48 horas. Abrimos a las 9:00.';
  assert.deepEqual(unsupportedFacts('Cuestan 22 euros.', ctx), []);
  assert.deepEqual(unsupportedFacts('Cuestan 25 €.', ctx), ['25 €']);
  assert.deepEqual(unsupportedFacts('Con 48 horas de antelación.', ctx), []);
  assert.deepEqual(unsupportedFacts('Con 72 horas de antelación.', ctx), ['72 hora']);
  assert.deepEqual(unsupportedFacts('Abrimos a las 09:00.', ctx), []);
  assert.deepEqual(unsupportedFacts('Abrimos a las 10:30.', ctx), ['10:30']);
});

test('cifras: un plazo escrito con letra se compara con el mismo plazo en cifra', () => {
  assert.deepEqual(unsupportedFacts('Necesita dos días.', 'Necesita 2 días.'), []);
});

test('respuesta: sin contexto suficiente no se llama al modelo', async () => {
  let called = false;
  const out = await answer(async () => { called = true; return {}; }, [{ ...HIT, score: 0.05 }]);
  assert.equal(out.no_data, true);
  assert.equal(called, false);
});

test('respuesta: la del modelo, si sus cifras están en el contexto', async () => {
  const out = await answer(ask('Las clásicas, con 48 horas de antelación.'));
  assert.equal(out.fallback, false);
  assert.equal(out.text, 'Las clásicas, con 48 horas de antelación.');
});

test('respuesta: si el modelo inventa una cifra se usa el texto de la fuente', async () => {
  const out = await answer(ask('Las clásicas, con 72 horas de antelación.'));
  assert.equal(out.fallback, true);
  assert.match(out.text, /48 horas/);
  assert.deepEqual(out.unsupported, ['72 hora']);
});

test('respuesta: si el modelo falla se usa el texto de la fuente', async () => {
  const out = await answer(async () => { throw new Error('sin respuesta'); });
  assert.equal(out.fallback, true);
  assert.match(out.text, /48 horas/);
});

test('respuesta: NO_DATA o una disculpa del modelo pasan a una persona', async () => {
  assert.equal((await answer(ask('NO_DATA'))).no_data, true);
  assert.equal((await answer(ask('Lo siento, no tengo datos sobre eso.'))).no_data, true);
  assert.equal((await answer(ask(''))).no_data, true);
});

test('respuesta: se limpian el razonamiento y el markdown del modelo', async () => {
  const out = await answer(ask('<think>a ver</think>**Respuesta:** Con 48 horas.'));
  assert.equal(out.text, 'Respuesta: Con 48 horas.');
});
