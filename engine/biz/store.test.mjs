import test from 'node:test';
import assert from 'node:assert/strict';
import { peluqueria, restaurante } from '../test/fixtures/index.mjs';
import {
  allSlugs, datasetProblems, getBusiness, listBusinesses, publicProfile, toMin, validSlug, validateBusiness, validateCatalog,
} from './store.mjs';

test('el dataset del obrador es válido', () => {
  assert.deepEqual(datasetProblems(), []);
  assert.deepEqual(allSlugs(), ['pasteleria']);
});

test('los negocios de prueba también pasan la validación', () => {
  assert.deepEqual(restaurante().problems, []);
  assert.deepEqual(peluqueria().problems, []);
});

test('la lista pública enseña lo justo', () => {
  assert.deepEqual(listBusinesses(), [{
    slug: 'pasteleria', name: 'Obrador Mel', label: 'Pastelería', kind: 'pasteleria', tagline: getBusiness('pasteleria').business.tagline, city: 'Santiago de Compostela', capabilities: ['info', 'order'],
  }]);
});

test('el perfil público trae la carta con precios en céntimos y sin textos internos', () => {
  const p = publicProfile('pasteleria');
  assert.equal(p.catalog.items.find((i) => i.id === 'brownie').price_cents, 300);
  assert.equal(p.catalog.items.find((i) => i.id === 'macarons').price_cents, 1450);
  assert.equal(p.booking, null);
  assert.equal(p.order.prep_minutes, 15);
  assert.equal('kb' in p, false);
  assert.equal('handoff_topics' in p, false);
  assert.equal('phrases' in p.catalog.items[0], false);
});

test('un slug raro no llega al disco', () => {
  assert.equal(validSlug('../etc'), false);
  assert.equal(getBusiness('../etc'), null);
  assert.equal(getBusiness('nope'), null);
  assert.equal(publicProfile('nope'), null);
});

test('toMin pasa una hora a minutos', () => {
  assert.equal(toMin('16:30'), 990);
});

test('validación: un negocio incompleto dice qué le falta', () => {
  const { business } = getBusiness('pasteleria');
  const { kb, ...base } = business;
  assert.deepEqual(validateBusiness(structuredClone(base), 'pasteleria'), []);
  assert.match(validateBusiness({ ...base, name: '' }, 'pasteleria').join(), /falta «name»/);
  assert.match(validateBusiness({ ...base, capabilities: ['order'] }, 'pasteleria').join(), /incluir «info»/);
  assert.match(validateBusiness({ ...base, capabilities: ['info', 'magia'] }, 'pasteleria').join(), /capacidad desconocida/);
  assert.match(validateBusiness(base, 'otra-carpeta').join(), /no coincide con la carpeta/);
  assert.match(validateBusiness({ ...base, hours: { mon: [['14:00', '09:00']] } }, 'pasteleria').join(), /horario «mon» inválido/);
  assert.match(validateBusiness({ ...base, order: undefined }, 'pasteleria').join(), /falta el bloque «order»/);
});

test('validación: un catálogo incoherente dice dónde falla', () => {
  const b = { slug: 'x' };
  const base = { categories: [{ id: 'a', name: 'A' }], items: [{ id: 'i', name: 'I', category: 'a', price: 1 }] };
  assert.deepEqual(validateCatalog(base, b), []);
  const item = (extra) => ({ ...base, items: [{ ...base.items[0], ...extra }] });
  assert.match(validateCatalog(item({ category: 'z' }), b).join(), /categoría «z» no existe/);
  assert.match(validateCatalog(item({ price: -1 }), b).join(), /precio inválido/);
  assert.match(validateCatalog(item({ contains: ['arena'] }), b).join(), /alérgeno desconocido/);
  assert.match(validateCatalog(item({ tags: ['frito'] }), b).join(), /etiqueta desconocida/);
  assert.match(validateCatalog(item({ options: ['talla'] }), b).join(), /opción «talla» no existe/);
  assert.match(validateCatalog({ ...base, ambiguous: { a: { candidates: ['nada'] } } }, b).join(), /«nada» no existe/);
});
