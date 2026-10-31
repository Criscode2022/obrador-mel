import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunksOf, collectionOf, factsText, lexical,
} from './kb.mjs';
import { getBusiness, parseMarkdown } from './store.mjs';

const { business } = getBusiness('pasteleria');
const chunks = chunksOf('pasteleria');
const ranked = (query) => {
  const scores = lexical('pasteleria', chunks, query);
  return chunks.map((c, i) => [c.heading, scores[i]]).sort((a, b) => b[1] - a[1]).map(([heading]) => heading);
};
const top = (query) => ranked(query)[0];
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
