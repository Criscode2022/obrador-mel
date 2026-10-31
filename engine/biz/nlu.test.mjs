import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLang, extractEmail, extractName, extractPhone,
} from './nlu.mjs';

test('idioma: gallego, castellano y, en la duda, el de antes', () => {
  assert.equal(detectLang('ola, quero unha tarta'), 'gl');
  assert.equal(detectLang('hola, quiero una tarta'), 'es');
  assert.equal(detectLang('mañá'), 'gl');
  assert.equal(detectLang('vale', 'gl'), 'gl');
  assert.equal(detectLang('vale', 'es'), 'es');
});

test('datos sueltos: nombre, teléfono, correo y comensales', () => {
  assert.equal(extractName('a nombre de Xoán Pérez'), 'Xoán Pérez');
  assert.equal(extractName('soy celíaca'), null);
  assert.equal(extractName('Iria', { expecting: true }), 'Iria');
  assert.equal(extractName('hola', { expecting: true }), null);
  assert.equal(extractPhone('llámame al 655 444 333'), '655444333');
  assert.equal(extractPhone('tengo 12 años'), null);
  assert.equal(extractEmail('mi correo es Iria@Example.com'), 'iria@example.com');
});
