---
title: API del motor
---

# API del motor

El motor escucha en `127.0.0.1:8790` y habla JSON. No lleva autenticación porque no se expone: lo público es `web/serve.mjs`, que traduce `/api/...` a `/biz/...` y solo deja pasar la lista de abajo. Los errores siempre son `{ "error": "mensaje" }`.

| Ruta del motor                        | Pública como                          | Para                                   |
| ------------------------------------- | ------------------------------------- | -------------------------------------- |
| `GET /health`                         | No                                    | Estado del motor y de Postgres         |
| `POST /admin/ingest`                  | No                                    | Embeber el conocimiento en Qdrant      |
| `GET /biz`                            | No                                    | Lista de negocios                      |
| `GET /biz/problems`                   | No                                    | Errores de validación de los datos     |
| `POST /biz/warm`                      | `POST /api/warm`                      | Cargar los modelos en memoria          |
| `GET /biz/:slug`                      | `GET /api/:slug`                      | Perfil público                         |
| `GET /biz/:slug/slots`                | `GET /api/:slug/slots`                | Huecos libres de un día                |
| `POST /biz/:slug/chat`                | `POST /api/:slug/chat`                | Un turno de conversación               |
| `GET /biz/:slug/conversation`         | `GET /api/:slug/conversation`         | Mensajes y estado                      |
| `GET /biz/:slug/staff`                | `GET /api/:slug/staff`                | Lo que ve el panel del local           |
| `GET /biz/:slug/agenda`               | `GET /api/:slug/agenda`               | Ocupación de un día                    |
| `POST /biz/:slug/staff/act`           | `POST /api/:slug/staff/act`           | Decisión de una persona                |

## `POST /biz/:slug/chat`

Un turno: un mensaje de texto o un botón.

```json
{
  "session": "9f3c…32 caracteres hexadecimales",
  "case_id": "EXP-20261031-c5f32b",
  "text": "Quiero una tarta de queso para 12 personas para el sábado a las 11"
}
```

| Campo     | Tipo     | Notas                                                            |
| --------- | -------- | ---------------------------------------------------------------- |
| `session` | string   | Obligatorio: 32 caracteres hexadecimales                         |
| `case_id` | string   | Opcional: el expediente en curso. Sin él se abre otro            |
| `text`    | string   | El mensaje; se corta a 500 caracteres                            |
| `action`  | objeto   | En lugar de `text`, un botón pulsado                             |
| `label`   | string   | Lo que se enseña como mensaje del cliente al pulsar un botón     |

Respuesta:

```json
{
  "case_id": "EXP-20261031-c5f32b",
  "mode": "new",
  "state": "propose",
  "lang": "es",
  "user": { "id": "msg-…", "at": "2026-10-31T12:41:03.120Z" },
  "replies": [
    {
      "id": "msg-…",
      "role": "assistant",
      "text": "Apunto: 1 × Tarta de queso (12 raciones). Total 30,00 €.",
      "meta": { "cards": [{ "type": "order", "status": "draft", "total_cents": 3000 }] },
      "at": "2026-10-31T12:41:03.140Z"
    },
    { "id": "msg-…", "role": "assistant", "text": "¿A nombre de quién lo preparo?", "meta": null, "at": "…" }
  ],
  "request": { "id": "req-…", "kind": "order", "status": "collecting", "total_cents": null },
  "trace": [{ "step": "pickup", "ok": true, "detail": "hueco de recogida libre 2026-11-07 11:00" }]
}
```

`mode` dice qué ha hecho el motor con el mensaje:

| Modo       | Cuándo                                                                        |
| ---------- | ----------------------------------------------------------------------------- |
| `new`      | No había expediente, ya estaba cerrado o es un pedido nuevo mientras otro espera |
| `continue` | Sigue la conversación                                                         |
| `aside`    | Una pregunta mientras el pedido espera al local: no lo toca                   |
| `human`    | Ya lo lleva una persona: se apunta y se le avisa                              |
| `change`   | El cliente acepta o rechaza la hora que propone el local                      |

`meta` puede traer `chips` (botones), `cards` (tarjetas de horario, carta, pedido o reserva), `cites` (fuentes) y `evidence` (lo comprobado).

### Botones

Cada botón es una acción con una lista fija de campos. Cualquier otro tipo es un 400, y los campos que no estén en la lista se ignoran.

| Tipo                            | Campos                       | Efecto                                     |
| ------------------------------- | ---------------------------- | ------------------------------------------ |
| `start`                         | `intent`                     | Empezar un pedido o una reserva            |
| `add`                           | `item_id`                    | Añadir un producto                         |
| `pick`                          | `item_id`                    | Elegir en una ambigüedad                   |
| `option`                        | `item_id`, `group`, `choice` | Elegir una opción, como las raciones       |
| `qty`                           | `index`, `delta`             | Cambiar una cantidad                       |
| `set`                           | `field`, `value`, `resource` | Fijar día, hora, personas o servicio       |
| `asap`                          | —                            | Lo antes posible                           |
| `notes`                         | `value`                      | Sin notas, o una nota                      |
| `reset`                         | `field`                      | Volver a preguntar ese dato                |
| `confirm`, `edit`, `more`       | —                            | Enviar, cambiar o añadir algo más          |
| `menu`                          | `category`                   | Enseñar una categoría                      |
| `handoff`                       | —                            | Avisar a una persona                       |
| `change_accept`, `change_reject` | —                           | Responder a la hora que propone el local   |

## `GET /biz/:slug/conversation`

`?session=…&case=…`. Sin `case`, la última conversación del visitante. Es lo que consulta el chat mientras espera al local.

```json
{
  "case_id": "EXP-20261031-c5f32b",
  "state": "emit",
  "lang": "es",
  "messages": [{ "id": "msg-…", "role": "staff", "text": "Pedido confirmado: …", "meta": null, "at": "…" }],
  "request": { "kind": "order", "status": "confirmed" },
  "asides": []
}
```

Si el expediente no es de esa sesión, responde como si no existiera.

## `GET /biz/:slug/slots`

`?date=2026-11-07`. Solo la ocupación de fondo, sin sesión.

```json
{ "ok": true, "reason": null, "slots": [{ "time": "09:00", "min": 540, "left": 3 }] }
```

Cuando no hay huecos, `ok` es `false` y `reason` dice por qué: `past`, `closed`, `too_far` o `full`. En un negocio con reservas acepta `party`, `services` y `resource`.

## `GET /biz/:slug/staff`

`?session=…`. Las solicitudes del visitante, las últimas 60.

```json
{
  "requests": [{
    "id": "req-…",
    "kind": "order",
    "status": "pending",
    "customer_text": "Quiero una tarta de queso…",
    "thread": [{ "role": "user", "text": "…", "at": "…" }],
    "evidence": [{ "step": "pickup", "ok": true, "detail": "hueco de recogida libre 2026-11-07 11:00" }],
    "citations": []
  }],
  "counts": { "pending": 1, "review": 0, "done": 0 }
}
```

## `POST /biz/:slug/staff/act`

```json
{ "session": "…", "request_id": "req-…", "action": "change", "date": "2026-11-07", "time": "11:30", "message": "" }
```

| Acción    | Sobre                               | Efecto                                                     |
| --------- | ----------------------------------- | ---------------------------------------------------------- |
| `accept`  | Pedido o reserva pendiente          | Aprueba, cierra el expediente y avisa al cliente           |
| `deny`    | Pendiente o con cambio propuesto    | Rechaza con un motivo opcional                             |
| `change`  | Pedido o reserva pendiente          | Propone otra hora, que tiene que estar libre               |
| `message` | Cualquier solicitud                 | Escribe al cliente; en un aviso o pregunta, además, la cierra |
| `review`  | Respuesta del asistente             | La marca como revisada y cierra el expediente              |

```json
{ "ok": true, "status": "confirmed", "approval_id": "apr-…", "calendar": null, "message": "Pedido confirmado: …" }
```

## `POST /admin/ingest`

Embebe el conocimiento de todos los negocios. Es idempotente: los trozos tienen ids estables.

```json
{ "negocios": [{ "slug": "pasteleria", "collection": "kb_pasteleria", "chunks": 46, "dim": 768, "model": "nomic-embed-text" }], "problemas": [] }
```

## Errores

| Estado | Cuándo                                                                                 |
| ------ | -------------------------------------------------------------------------------------- |
| 400    | JSON roto, sesión inválida, mensaje vacío, botón desconocido, fecha mal escrita        |
| 404    | Negocio desconocido, o una solicitud que no es de esa sesión                           |
| 409    | Una solicitud ya decidida, o un hueco que ya no está libre                             |
| 413    | Cuerpo de más de 8 KB                                                                  |
| 429    | Demasiados mensajes, demasiadas conversaciones o demasiada gente a la vez              |
| 502    | Solo en `serve.mjs`: el motor no responde                                              |
| 503    | `GET /health` con Postgres caído                                                       |

## Límites

| Límite                                   | Valor                 | Dónde         |
| ---------------------------------------- | --------------------- | ------------- |
| Cuerpo de una petición                   | 8 KB                  | Web y motor   |
| Largo de un mensaje                      | 500 caracteres        | Motor y web   |
| Mensajes por minuto y dirección          | 40                    | Web           |
| Mensajes por minuto en total             | 150                   | Web           |
| Mensajes por minuto y sesión             | 40                    | Motor         |
| Conversaciones a la vez                  | 2; el resto espera 9 s | Motor        |
| Expedientes por sesión y día             | 60                    | Motor         |
| Carga de modelos                         | 1 cada 30 s           | Motor         |
