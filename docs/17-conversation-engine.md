---
title: El motor de conversación
---

# El motor de conversación

El asistente son dos funciones con papeles muy distintos:

| Función      | Fichero      | Hace                                                          | Efectos        |
| ------------ | ------------ | ------------------------------------------------------------- | -------------- |
| `chatTurn()` | `flow.mjs`   | Carga el expediente, decide el modo y guarda todo             | Postgres       |
| `turn()`     | `dialog.mjs` | Decide qué decir y qué hacer en este turno                    | Ninguno        |

Separarlas es la decisión de diseño más importante del motor. `turn()` recibe todo lo que necesita y devuelve un resultado:

```js
const out = await turn({
  biz, catalog,            // el negocio
  state,                   // el estado de la conversación
  input: { text },         // o { action }
  now, own, hasPending,    // la hora, lo ya pedido y si hay algo esperando
  kbAnswer, history,       // cómo consultar el conocimiento
});
// -> { state, replies, request, refused, redacted, trace, signals, kb }
```

Sin base de datos ni red, una conversación entera se prueba en milisegundos. `kbAnswer` se inyecta: en producción busca y llama al modelo, y en un test es una función de una línea.

## Un turno en `chatTurn`

1. **Validar.** Negocio, sesión y botón. El texto se corta a 500 caracteres.
2. **Tapar.** `scrub` quita tarjetas y DNI antes de hacer nada con el mensaje.
3. **Cargar** el expediente de esa sesión y su solicitud principal.
4. **Decidir el modo.**
5. **Guardar** el mensaje del cliente, ya tapado.
6. **Preparar** la historia reciente, lo que el visitante ya tiene pedido y si hay algo pendiente.
7. **Llamar a `turn()`.**
8. **Guardar el rastro:** estados `enrich` y `route`, decisiones, fuentes y comprobaciones.
9. **Actualizar la solicitud** y guardar las respuestas.
10. **Fijar el estado final** y devolver.

## Los modos

Antes de pensar en el mensaje, el motor decide qué relación tiene con el expediente.

| Situación                                                        | Modo       | Qué pasa                                                |
| ---------------------------------------------------------------- | ---------- | ------------------------------------------------------- |
| Sin expediente, o el anterior ya terminó                         | `new`      | Se abre otro                                            |
| Hay una conversación en marcha                                   | `continue` | Sigue                                                   |
| Lo está atendiendo una persona                                   | `human`    | Se guarda, se avisa y no se llama al asistente          |
| El pedido espera al local y llega una pregunta o un botón        | `aside`    | Se contesta sin tocar el pedido                         |
| El pedido espera al local y llega otro pedido                    | `new`      | Abre su propio expediente                               |
| El local propuso otra hora y el cliente responde con el botón    | `change`   | Se acepta o se rechaza; no pasa por `turn()`            |

El modo `aside` es el que permite preguntar «¿dónde estáis?» con un pedido esperando. La respuesta queda en una solicitud hija, y la principal no se entera.

## Un turno en `turn`

```
input ─┬─ botón ─► runAction ─────────────────────┐
       └─ texto ─► analyze ─► señales ─► route ───┤
                                                  ▼
                                   replies, state, request
```

Un botón no pasa por `analyze`: ya se sabe lo que significa. Un texto se convierte en **señales**, un objeto con todo lo que se ha leído, y `route` decide con ellas.

```js
if (s.primary === 'refuse') return refuse(c);
if (s.primary === 'handoff') return startHandoff(c, 'person');
if (s.primary === 'cancel') return cancel(c);

if (midFlow(c)) {
  if (feedsFlow(c)) return continueFlow(c);
  // ...una pregunta suelta, un saludo o algo que no se entiende
}

switch (s.primary) { /* greet, order, booking, info... */ }
```

### En mitad de un pedido

`feedsFlow` decide si el mensaje sirve para lo que se está haciendo. Si se ha preguntado el nombre y llega «Iria», sirve. Si llega «¿qué teléfono tenéis?», no.

En ese caso, el motor contesta y vuelve a preguntar lo que faltaba, sin perder nada:

```
Cliente:    dos palmeras
Asistente:  Apunto: 2 × Palmera de hojaldre. Total 4,40 €.
            ¿A qué hora lo recoges? Lo más pronto que puedo tenerlo listo es a las 10:30.
Cliente:    ¿qué teléfono tenéis?
Asistente:  Puedes llamar al 981 000 404 o escribir a encargos@obradormel.example.
            ¿A qué hora lo recoges? Lo más pronto que puedo tenerlo listo es a las 10:30.
```

`reprompt` hace esa segunda parte: vuelve a ejecutar el flujo con unas señales vacías (`neutralSignals`), de modo que pregunta lo mismo sin leer nada nuevo del mensaje.

## El contexto de un turno

`makeCtx` crea el objeto `c` que recorre todo el turno. Lo importante:

```js
c.say(reply)            // añade una respuesta
c.t(es, gl)             // elige el texto del idioma de la conversación
c.note(step, ok, detail) // apunta lo comprobado, que acaba en tool_calls
c.request = { ... }     // deja una solicitud para que la guarde flow.mjs
c.state                 // el estado de la conversación
```

## Una respuesta

```js
{
  text: 'Tenemos 3 productos sin gluten: ...',
  cards: [{ type: 'menu', title: 'Productos sin gluten', rows: [...] }],
  chips: [{ label: 'Hacer un pedido', text: 'Quiero hacer un pedido' }],
  cites: [{ title: 'Carta y alérgenos', source: 'catalog.json' }],
  evidence: [{ step: 'allergens', ok: true, detail: '3 de 19 productos cumplen: sin gluten' }],
}
```

| Campo      | Qué es                                                                      |
| ---------- | --------------------------------------------------------------------------- |
| `text`     | Lo que se le dice al cliente                                                |
| `cards`    | Tarjetas: `hours`, `menu`, `order`, `booking`                               |
| `chips`    | Botones: un texto que se envía (`text`) o una acción (`action`)             |
| `cites`    | De dónde sale                                                               |
| `evidence` | Qué se comprobó. El chat lo enseña en *Cómo lo ha comprobado*               |

## Lo que un turno puede dejar

`c.request` es la señal de que este turno ha producido algo para una persona.

| `kind`     | `status`  | Cuándo                                                       |
| ---------- | --------- | ------------------------------------------------------------ |
| `order`    | `pending` | El cliente ha enviado el pedido                              |
| `booking`  | `pending` | El cliente ha enviado la reserva                             |
| `question` | `pending` | No hay respuesta en los datos                                |
| `handoff`  | `pending` | Pide una persona, o es un tema que lleva una persona         |

Si un turno no deja solicitud, `flow.mjs` actualiza el estado de la conversación y sigue.

## Identidad

`identity(lang)` devuelve la frase que se repite en los momentos que importan: al enviar a una persona y al rechazar una inyección.

```js
identity('es') // 'Soy un asistente; una persona lo confirmará.'
identity('gl') // 'Son un asistente; unha persoa confirmará.'
```

## Siguiente

- [Entender el mensaje](./18-nlu.md): de dónde salen las señales.
- [Pedidos](./20-ordering.md): qué hace `orderStep`.
- [Una persona confirma](./24-human-in-the-loop.md): qué pasa después.
