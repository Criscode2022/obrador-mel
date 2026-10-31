---
title: Testing · unitarios
---

# Testing · unitarios

Funciones sin base de datos, sin red y sin procesos. 12 ficheros, 139 tests, menos de medio segundo.

| Fichero                 | Tests | Cubre                                                                          |
| ----------------------- | ----- | ------------------------------------------------------------------------------ |
| `biz/dialog.test.mjs`   | 38    | Turnos enteros: encargos, dudas a mitad, horario, rechazos, gallego y reservas |
| `biz/kb.test.mjs`       | 16    | Trozos, búsqueda por palabras, comprobación de cifras y respuestas del modelo  |
| `biz/orders.test.mjs`   | 14    | Cantidades, sabores sin repetir el nombre, erratas, carrito y precios          |
| `biz/avail.test.mjs`    | 13    | Horario, huecos, plazos, ocupación, mesas, citas y agenda                      |
| `when.test.mjs`         | 12    | Días en texto libre, en los dos idiomas, y husos de Madrid                     |
| `biz/nlu.test.mjs`      | 11    | Idioma, horas ambiguas, intención, temas, dietas y datos de contacto           |
| `biz/routes.test.mjs`   | 9     | Rutas por HTTP: validación, cuerpos enormes y JSON roto                        |
| `biz/store.test.mjs`    | 8     | Validación de los datos del negocio y perfil público                           |
| `pii.test.mjs`          | 6     | Tarjetas, DNI, resúmenes y nivel de datos personales                           |
| `biz/text.test.mjs`     | 6     | Normalización, números escritos y generador con semilla                        |
| `biz/format.test.mjs`   | 4     | Importes, fechas y horario semanal en cada idioma                              |
| `calendar.test.mjs`     | 2     | Sin `approval_id` no hay evento                                                |

`routes.test.mjs` levanta un servidor HTTP de verdad en un puerto libre, pero sus casos se rechazan antes de llegar a la base de datos.

## Un turno sin levantar nada

`turn()` no toca la base de datos, así que una conversación entera es un bucle. Es el test más valioso del proyecto: cuesta milisegundos y prueba lo mismo que un cliente.

```js
const noKb = async () => ({ no_data: true, reason: 'prueba' });

async function talk(steps, { now = NOW, kbAnswer = noKb, found = mel, own = [] } = {}) {
  const { business, catalog } = found;
  let state = null;
  const log = [];
  for (const step of steps) {
    const input = typeof step === 'string' ? { text: step } : { action: step };
    const out = await turn({ biz: business, catalog, state, input, now, own, kbAnswer });
    state = out.state;
    log.push(out);
  }
  return log;
}

test('encargo completo: queda PENDIENTE, con el total calculado y sin confirmar nada', async () => {
  const log = await talk(['una caja de macarons y dos palmeras para mañana a las 11', 'Iria', '655444333', 'no', { type: 'confirm' }]);
  assert.ok(log.slice(0, -1).every((o) => !o.request), 'nada se envía hasta confirmar');
  const last = log.at(-1);
  assert.equal(last.request.status, 'pending');
  assert.equal(last.request.total_cents, 1450 + 2 * 220);
});
```

## La misma pregunta de muchas formas

Una tabla de frases y lo que se espera de cada una. Si una regla nueva rompe una forma de preguntar, se ve aquí.

```js
const cases = [
  ['¿A qué hora abrís?', /Hoy abrimos de 09:00 a 14:00 y de 16:30 a 20:00/],
  ['¿Abrís el domingo?', /Sí, el domingo.*09:30 a 14:00/],
  ['¿El lunes estará abierto?', /No, el lunes.*cerramos/],
  ['¿Qué días abrís?', /Abrimos de martes a domingo. Cerramos el lunes/],
  ['¿Cerráis a mediodía?', /hay pausa a mediodía/],
  ['Cando abrides?', /abrimos de 09:00 a 14:00 e de 16:30 a 20:00/],
];
```

## El modelo, inyectado

`answerFromKb` recibe la función que llama al modelo, y las barreras se prueban con respuestas escritas a mano:

```js
const ask = (content) => async () => ({ model: 'prueba', content, tokens_in: 10, tokens_out: 5, ms: 1 });

test('respuesta: si el modelo inventa una cifra se usa el texto de la fuente', async () => {
  const out = await answer(ask('Las clásicas, con 72 horas de antelación.'));
  assert.equal(out.fallback, true);
  assert.equal(out.text, 'Las tartas clásicas se encargan con 48 horas de antelación. La de Santiago, con 24.');
  assert.deepEqual(out.unsupported, ['72 hora']);
});
```

## Las reservas, con negocios de prueba

El obrador no reserva, pero el motor sí. `engine/test/fixtures/` tiene un restaurante y una peluquería mínimos, que pasan la misma validación que el obrador:

```js
test('citas: solo los profesionales que hacen todos los servicios', () => {
  const { business, catalog } = pelu;
  const ids = ['corte-mujer', 'tinte-raiz'];
  const duration = ids.reduce((n, id) => n + catalog.byId.get(id).duration, 0);
  const av = staffAvailability(business, { ymd: '2026-10-21', duration, serviceIds: ids, now: NOW });
  assert.ok(av.slots.every((s) => s.resource.id === 'marta'), 'solo Marta hace corte de mujer y tinte');
});
```

## Los datos también se prueban

`store.test.mjs` falla si el dataset del obrador tiene un alérgeno desconocido, un horario al revés o una categoría que no existe. Editar la carta está cubierto por la misma suite que el código.
