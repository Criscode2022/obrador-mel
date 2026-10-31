---
title: Pedidos
---

# Pedidos

Del texto libre a un pedido pendiente, en dos partes: `orders.mjs` lee y calcula, `ordering.mjs` lleva la conversación. El precio, los plazos y los huecos los pone siempre el motor.

## Del texto a líneas de pedido

`findItems(text, catalog)` devuelve:

```js
{
  lines: [{ item_id: 'tarta-queso', qty: 1, options: { raciones: '12' } }],
  ambiguous: [],     // «una tarta»: ¿cuál?
  unknown: [],       // lo que pidió y no está en la carta
  mode: 'add',       // 'add' | 'set' | 'remove'
  strayOptions: [],  // una opción sin producto: «12 raciones»
}
```

Funciona en pasadas sobre las palabras del mensaje:

1. **Normalizar cantidades:** «media docena de» pasa a `6`, «una docena de» a `12`, «un par de» a `2`.
2. **Frases del catálogo:** nombres y alias, de la más larga a la más corta. «Tarta de queso» gana a «tarta», que es ambigua.
3. **Erratas:** una palabra de seis letras o más parecida a un producto de una sola palabra. Mide el coeficiente de Dice sobre trigramas y exige 0,74. Así «tartaletta» es «tartaleta».
4. **Sabores sin nombre:** la pasada de «2 tartas de santiago y 1 de limón».
5. **Cantidades:** justo delante del producto, o con `x2` detrás.
6. **Opciones:** «12 raciones», «para 8», para el producto que las admita.
7. **Lo desconocido:** una cantidad seguida de algo que no se reconoce, como «una pizza».
8. **El modo:** «quita», «sin el» y «ya no quiero» eliminan; «mejor» y «en vez de» fijan la cantidad.

### Los sabores sin repetir el nombre

```
quiero 2 tartas de santiago y 1 de limón
        └─ producto reconocido    └─ cantidad + «de» + palabra suelta
```

`fillEllipsis` busca tras cada producto un patrón de cantidad o «otra» seguido de una palabra sin usar, y prueba combinaciones con el nombre del producto anterior: `tarta de limon`, `tarta limon`, `limon`. Los productos de la misma categoría van primero, para que un sabor no salte a otra sección de la carta.

| Mensaje                                       | Resultado                                  |
| --------------------------------------------- | ------------------------------------------ |
| 2 tartas de santiago y 1 de limón             | Santiago × 2, limón × 1                    |
| una tarta de santiago y otra de limón         | Santiago × 1, limón × 1                    |
| 2 de santiago y 1 de limón                    | Santiago × 2, limón × 1                    |
| 2 tartas de santiago, 1 de limón y 1 de queso | Santiago × 2, limón × 1, queso × 1         |

### Ambigüedad

`catalog.json` declara qué palabras no bastan:

```json
"ambiguous": {
  "tarta": {
    "aliases": ["tarta", "tartas", "pastel", "pastel grande"],
    "name": "tarta",
    "candidates": ["tarta-queso", "tarta-santiago", "tarta-chocolate", "tarta-zanahoria", "tarta-limon", "tarta-personalizada"]
  }
}
```

«Una tarta» no elige sola: pregunta cuál, con el precio de cada una. Si hay varias ambigüedades, se atienden de una en una con la cola `state.queue`.

## Precio

`priceLine` calcula en céntimos a partir del catálogo: el precio del producto más el suplemento de cada opción, por la cantidad.

```js
priceLine(catalog, { item_id: 'tarta-queso', qty: 1, options: { raciones: '12' } })
// { unit_cents: 3000, total_cents: 3000, option_label: '12 raciones', allergens: [...], lead_hours: 48 }
```

El modelo no interviene, y un producto que ya no existe se queda fuera de la cuenta.

## El carrito

`applyToCart` aplica lo encontrado según el modo. Las líneas iguales se funden (mismo producto y mismas opciones), y dos tartas de raciones distintas son dos líneas.

## El flujo

`orderStep` corre en cada turno de un pedido y hace siempre lo mismo: aplica lo que traiga el mensaje y pregunta lo primero que falte. No hay una máquina de estados con pasos fijos, y por eso da igual en qué orden lleguen los datos.

| Paso | Qué hace                                                       | Si falta                         |
| ---- | -------------------------------------------------------------- | -------------------------------- |
| 1    | Aplica productos: añadir, quitar, opciones sueltas             |                                  |
| 2    | Fija hora y contacto                                           |                                  |
| 3    | Aclara ambigüedades                                            | «¿Qué tarta quieres?»            |
| 4    | Comprueba que haya algo                                        | «¿Qué te preparo?»               |
| 5    | Comprueba las opciones obligatorias                            | «¿Para cuántas raciones?»        |
| 6    | Comprueba día, hora, plazo y hueco                             | Explica y ofrece alternativas    |
| 7    | Nombre, teléfono y notas                                       | Pregunta cada uno                |
| 8    | Resumen con botones                                            | «Enviar pedido»                  |

Como cada paso mira el estado, un mensaje con todo de golpe se salta las preguntas:

```
Cliente:   Dos palmeras para el sábado a las 11 a nombre de Iria, teléfono 655444333
Asistente: Apunto: 2 × Palmera de hojaldre. Total 4,40 €.
           ¿Quieres una dedicatoria o alguna indicación (alergias, velas, caja)?
```

## Plazos

El plazo de un pedido es el mayor de sus productos, o la preparación mínima si ninguno tiene plazo.

```js
function leadMinutes(c) {
  const prep = c.biz.order.prep_minutes ?? 10;
  const lead = Math.max(0, ...lines.map((l) => (byId.get(l.item_id)?.lead_hours ?? 0) * 60));
  return Math.max(prep, lead);
}
```

Una bolsa de galletas y una tarta personalizada necesitan 120 horas, porque van en el mismo pedido. Con plazos de un día o más, el asistente pregunta primero el día y enseña solo los días con hueco.

## Comprobar la recogida

`verifyPickup` devuelve lo que falta o el problema:

| Resultado | Qué dice el asistente                                                 |
| --------- | --------------------------------------------------------------------- |
| `closed`  | «El lunes 19 de octubre no abrimos», y pregunta de nuevo              |
| `too_far` | «Solo puedo programar recogidas con poca antelación»                  |
| `lead`    | «Mañana no llego: este pedido necesita 48 horas», con los días libres |
| `full`    | «Ya no quedan huecos», con los días libres                            |
| `passed`  | «Las 09:00 de hoy ya pasaron», y ofrece esa hora mañana               |
| `taken`   | «A las 11:30 no puedo tenerlo listo», con las tres horas más cercanas |

## La tarjeta

`orderCard` construye la tarjeta del pedido, que aparece en cada resumen. En borrador tiene botones de más y menos en cada línea, que mandan una acción `qty`.

| Estado            | Aparece                                      |
| ----------------- | -------------------------------------------- |
| `draft`           | Mientras se prepara                          |
| `pending`         | Enviado, esperando al local                  |
| `confirmed`       | Confirmado, en el mensaje del local          |
| `denied`          | Rechazado                                    |

## Enviar

El botón *Enviar pedido* llama a `orderConfirm`, que comprueba otra vez el hueco, por si se ha ocupado, y `finalize` deja la solicitud:

```js
c.request = {
  kind: 'order',
  status: 'pending',
  slot_start: isoAt(o.ymd, o.min),
  slot_end: isoAt(o.ymd, o.min + 10),
  total_cents: p.total_cents,
  data: { lang, lines, count, ymd, time, min, name, phone, note },
};
```

Aquí termina el asistente. Ver [Una persona confirma](./24-human-in-the-loop.md).

## Un pedido grande

Con más de 30 unidades, el asistente no sigue: lo dice y ofrece avisar a una persona. Y una boda o una comunión ni siquiera llegan aquí, porque `handoff_topics` las envía directamente a una persona.
