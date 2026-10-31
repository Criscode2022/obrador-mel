import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, hash01, normalize, pad2, similarity, singular, toNumber,
} from './text.mjs';

test('normalizar quita tildes y mayúsculas, también en gallego', () => {
  assert.equal(normalize('Mañá ÁS Cinco'), 'mana as cinco');
  assert.equal(normalize('  dos   palmeras '), ' dos palmeras ');
});

test('números escritos en castellano y en gallego', () => {
  assert.equal(toNumber('dos'), 2);
  assert.equal(toNumber('dúas'), 2);
  assert.equal(toNumber('catro'), 4);
  assert.equal(toNumber('12'), 12);
  assert.equal(toNumber('tarta'), null);
});

test('singular aproximado para comparar con la carta', () => {
  assert.equal(singular('palmeras'), 'palmera');
  assert.equal(singular('macarons'), 'macaron');
  assert.equal(singular('panes'), 'pan');
  assert.equal(singular('gas'), 'gas');
});

test('el parecido entre palabras sirve para las erratas', () => {
  assert.equal(similarity('tarta', 'tarta'), 1);
  assert.ok(similarity('tartaletta', 'tartaleta') > 0.74);
  assert.ok(similarity('pizza', 'brownie') < 0.2);
  assert.equal(similarity('', 'tarta') < 0.5, true);
});

test('el generador con semilla da siempre lo mismo y se reparte entre 0 y 1', () => {
  assert.equal(hash01('pasteleria|2026-10-17|22'), hash01('pasteleria|2026-10-17|22'));
  assert.notEqual(hash01('pasteleria|2026-10-17|22'), hash01('pasteleria|2026-10-17|23'));
  const sample = Array.from({ length: 2000 }, (_, i) => hash01(`x${i}`));
  assert.ok(sample.every((v) => v >= 0 && v < 1));
  const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
  assert.ok(Math.abs(mean - 0.5) < 0.03, `media ${mean}`);
});

test('pequeñas utilidades', () => {
  assert.equal(pad2(7), '07');
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-1, 0, 1), 0);
});
