import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyToCart, findItems, lineAllergens, mergeLines, optionLabel, priceLine, priceOrder,
} from './orders.mjs';
import { getBusiness } from './store.mjs';

const { catalog } = getBusiness('pasteleria');
const ids = (text) => findItems(text, catalog).lines.map((l) => [l.item_id, l.qty]);

test('cantidades en cifra, en letra, por docenas y por pares', () => {
  assert.deepEqual(ids('dos palmeras'), [['palmera', 2]]);
  assert.deepEqual(ids('3 brownies'), [['brownie', 3]]);
  assert.deepEqual(ids('media docena de palmeras'), [['palmera', 6]]);
  assert.deepEqual(ids('una docena de palmeras'), [['palmera', 12]]);
  assert.deepEqual(ids('un par de milhojas'), [['milhojas', 2]]);
  assert.deepEqual(ids('palmera x3'), [['palmera', 3]]);
});

test('el sabor sin repetir el nombre: «2 tartas de santiago y 1 de limón»', () => {
  assert.deepEqual(ids('quiero 2 tartas de santiago y 1 de limón para recoger mañana'), [['tarta-santiago', 2], ['tarta-limon', 1]]);
  assert.deepEqual(ids('una tarta de santiago y otra de limón'), [['tarta-santiago', 1], ['tarta-limon', 1]]);
  assert.deepEqual(ids('2 de santiago y 1 de limón'), [['tarta-santiago', 2], ['tarta-limon', 1]]);
  assert.deepEqual(ids('2 tartas de santiago, 1 de limón y 1 de queso'), [['tarta-santiago', 2], ['tarta-limon', 1], ['tarta-queso', 1]]);
  assert.deepEqual(ids('una tarta de santiago y una tarta de limón'), [['tarta-santiago', 1], ['tarta-limon', 1]]);
});

test('producto ambiguo: «una tarta» no se decide sola', () => {
  const found = findItems('una tarta', catalog);
  assert.equal(found.lines.length, 0);
  assert.equal(found.ambiguous[0].key, 'tarta');
  assert.equal(found.ambiguous[0].candidates.length, 6);
});

test('erratas en productos de una palabra', () => {
  assert.equal(findItems('una tartaletta', catalog).lines[0].item_id, 'tartaleta');
  assert.equal(findItems('una tartaletta', catalog).lines[0].fuzzy, true);
});

test('lo que no está en la carta se nombra', () => {
  assert.deepEqual(findItems('una pizza y una palmera', catalog).unknown, ['pizza']);
});

test('opciones: las raciones se leen del texto', () => {
  const [line] = findItems('una tarta de queso para 12 personas', catalog).lines;
  assert.equal(line.options.raciones, '12');
  assert.equal(optionLabel(catalog, line), '12 raciones');
});

test('una opción sin producto queda suelta para lo que ya esté en el pedido', () => {
  assert.deepEqual(findItems('12 raciones', catalog).strayOptions, [{ group: 'raciones', choice: '12' }]);
});

test('modos: añadir, fijar y quitar', () => {
  assert.equal(findItems('dos palmeras', catalog).mode, 'add');
  assert.equal(findItems('mejor tres palmeras', catalog).mode, 'set');
  assert.equal(findItems('quita la palmera', catalog).mode, 'remove');
});

test('el carrito fusiona lo igual y distingue opciones distintas', () => {
  const a = { item_id: 'tarta-queso', qty: 1, options: { raciones: '8' } };
  const b = { item_id: 'tarta-queso', qty: 2, options: { raciones: '8' } };
  const c = { item_id: 'tarta-queso', qty: 1, options: { raciones: '12' } };
  assert.deepEqual(mergeLines([a, b, c]).map((l) => l.qty), [3, 1]);
});

test('fijar cambia la cantidad y quitar elimina la línea', () => {
  const cart = applyToCart([], findItems('dos palmeras y un brownie', catalog)).lines;
  assert.equal(cart.reduce((n, l) => n + l.qty, 0), 3);
  const fixed = applyToCart(cart, findItems('mejor cinco palmeras', catalog));
  assert.equal(fixed.lines.find((l) => l.item_id === 'palmera').qty, 5);
  const removed = applyToCart(cart, findItems('quita el brownie', catalog));
  assert.deepEqual(removed.removed, ['brownie']);
  assert.equal(removed.lines.length, 1);
});

test('el precio lo calcula el motor, opciones incluidas, en céntimos', () => {
  assert.equal(priceLine(catalog, { item_id: 'tarta-queso', qty: 1, options: { raciones: '8' } }).total_cents, 2200);
  assert.equal(priceLine(catalog, { item_id: 'tarta-queso', qty: 1, options: { raciones: '12' } }).total_cents, 3000);
  assert.equal(priceLine(catalog, { item_id: 'tarta-queso', qty: 2, options: { raciones: '20' } }).total_cents, 8000);
  const order = priceOrder(catalog, applyToCart([], findItems('dos palmeras y una tarta de queso de 12 raciones', catalog)).lines);
  assert.equal(order.total_cents, 2 * 220 + 3000);
  assert.equal(order.count, 3);
});

test('los importes con decimales no acumulan error', () => {
  assert.equal(priceLine(catalog, { item_id: 'eclair', qty: 3, options: {} }).total_cents, 960);
});

test('un producto que ya no existe no entra en la cuenta', () => {
  assert.equal(priceOrder(catalog, [{ item_id: 'desaparecido', qty: 1, options: {} }]).total_cents, 0);
});

test('alérgenos de una línea', () => {
  assert.deepEqual(lineAllergens(catalog, { item_id: 'brownie', options: {} }).sort(), ['frutos_secos', 'huevos', 'lacteos']);
  assert.deepEqual(lineAllergens(catalog, { item_id: 'nada', options: {} }), []);
});
