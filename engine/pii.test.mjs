import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, luhn, redact, scrub } from './pii.mjs';

test('tarjeta: solo se tapa un número con dígito de control válido', () => {
  assert.equal(luhn('4111111111111111'), true);
  assert.equal(luhn('4111111111111112'), false);
  assert.deepEqual(scrub('mi tarjeta es 4111 1111 1111 1111'), { text: 'mi tarjeta es [TARJETA]', flags: ['card'] });
  assert.deepEqual(scrub('el pedido 4111 1111 1111 1112').flags, []);
});

test('DNI y NIE se tapan aunque lleven guion', () => {
  assert.deepEqual(scrub('mi dni es 12345678Z').text, 'mi dni es [DNI]');
  assert.deepEqual(scrub('nie X1234567L').flags, ['dni']);
  assert.deepEqual(scrub('12345678-Z').text, '[DNI]');
});

test('scrub da lo mismo si se llama dos veces seguidas', () => {
  assert.deepEqual(scrub('12345678Z').flags, ['dni']);
  assert.deepEqual(scrub('12345678Z').flags, ['dni']);
});

test('redact tapa también el correo y el teléfono', () => {
  assert.equal(redact('llamadme al 655444333'), 'llamadme al[TEL]');
  assert.equal(redact('escribid a iria@example.com'), 'escribid a [EMAIL]');
});

test('classify ordena de más a menos sensible', () => {
  assert.equal(classify('quiero una tarta').pii_level, 'none');
  assert.equal(classify('teléfono 655444333').pii_level, 'phone');
  assert.equal(classify('mi dni es 12345678Z y mi móvil 655444333').pii_level, 'dni');
  assert.equal(classify('tengo una enfermedad y mi correo es a@b.es').pii_level, 'health');
  assert.equal(classify('es para mi hija de 7 años').pii_level, 'minor');
});
