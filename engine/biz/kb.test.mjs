import test from 'node:test';
import assert from 'node:assert/strict';
import { chunksOf, collectionOf, factsText } from './kb.mjs';
import { getBusiness, parseMarkdown } from './store.mjs';

const { business } = getBusiness('pasteleria');
const chunks = chunksOf('pasteleria');
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
