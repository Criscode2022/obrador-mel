---
title: Modelo de datos
---

# Modelo de datos

Postgres 16. Todo está en `db/schema.sql`, que es idempotente y se aplica con `npm --prefix engine run schema`.

La unidad de trabajo es el **expediente** (`cases`): una conversación con su cliente, lo que se dijo, lo que se comprobó y lo que decidió una persona. Dentro de cada expediente hay una **solicitud** (`biz_requests`): el pedido, la reserva, la pregunta o el aviso.

```
cases ─┬─ messages          lo que se dijo
       ├─ biz_requests      lo que se pide, con el estado de la conversación
       ├─ events            la historia, solo se añade
       ├─ router_decisions  por qué se hizo cada paso
       ├─ citations         las fuentes de una respuesta
       ├─ tool_calls        lo que comprobó el motor
       ├─ proposals ── approvals   lo que se deja preparado y quién lo decidió
       └─ artifacts         el markdown de cierre
```

## `cases`

| Columna       | Tipo        | Notas                                          |
| ------------- | ----------- | ---------------------------------------------- |
| `id`          | text PK     | `EXP-20261031-c5f32b`: fecha y 3 bytes aleatorios |
| `channel`     | text        | `web`                                          |
| `lang`        | text        | `es` o `gl`                                    |
| `state`       | text        | Ver [estados](#estados-del-expediente)         |
| `pii_level`   | text        | El dato personal más sensible del mensaje      |
| `route`       | text        | `local` o `refuse`                             |
| `summary`     | text        | Resumen con los datos personales tapados       |
| `business`    | text        | `pasteleria`                                   |
| `session_id`  | text        | El visitante                                   |
| `created_at`, `updated_at` | timestamptz |                                   |

## `messages`

| Columna    | Notas                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| `role`     | `user` (cliente), `assistant` o `staff` (el local)                     |
| `content`  | El texto, ya sin tarjetas ni DNI                                       |
| `meta`     | JSON con lo que acompaña al texto: `chips`, `cards`, `cites`, `evidence` |

## `biz_requests`

| Columna        | Notas                                                                   |
| -------------- | ----------------------------------------------------------------------- |
| `kind`         | `inquiry`, `info`, `order`, `booking`, `question` o `handoff`           |
| `status`       | Ver [estados de una solicitud](#estados-de-una-solicitud)               |
| `data`         | JSON con lo recogido: líneas, fecha, hora, nombre, teléfono, notas      |
| `dialog`       | JSON con el estado de la conversación. Solo en la fila principal        |
| `parent_id`    | Las preguntas hechas mientras se espera al local cuelgan de la principal |
| `slot_start`, `slot_end` | El hueco con su huso                                          |
| `total_cents`  | El total en céntimos                                                    |

`dialog` es lo que permite que el motor no guarde nada en memoria. Tiene esta forma:

```json
{
  "v": 1,
  "lang": "es",
  "intent": "order",
  "awaiting": "phone",
  "clarify": null,
  "queue": [],
  "booking": {},
  "order": {
    "lines": [{ "item_id": "tarta-queso", "qty": 1, "options": { "raciones": "12" } }],
    "ymd": "2026-11-07",
    "min": 660,
    "name": "Laura"
  },
  "last": { "topic": null },
  "done": false
}
```

Las horas van en minutos desde medianoche y las fechas como `YYYY-MM-DD` en hora de Madrid. Son más fáciles de comparar que un timestamp, y el huso solo importa al guardar `slot_start`.

## `events`

La historia del expediente: cada cambio de estado y cada decisión, con su `payload`. **Solo se añade.** Un disparador impide cambiarla o borrarla:

```sql
CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW
  EXECUTE FUNCTION events_append_only();
```

Así, lo que pasó no se puede reescribir después, ni por un error del código.

## El rastro de una respuesta

| Tabla              | Qué guarda                                                                     |
| ------------------ | ------------------------------------------------------------------------------ |
| `router_decisions` | Cada paso: qué regla o modelo actuó, por qué, con cuántos tokens y a qué ruta  |
| `citations`        | Las fuentes de una respuesta: fichero, sección, cita y puntuación              |
| `tool_calls`       | Lo que comprobó el motor por su cuenta: huecos, plazos, alérgenos              |

Con eso se puede contestar a «¿por qué dijo esto?» sin repetir la conversación. El panel enseña parte de ese rastro en *Lo que comprobó el asistente*.

## Lo que decide una persona

| Tabla       | Qué guarda                                                                   |
| ----------- | ---------------------------------------------------------------------------- |
| `proposals` | Lo que el asistente deja preparado, con su lista de comprobación             |
| `approvals` | Cada decisión: `approve`, `deny`, `propose_change`, `answer` o `review`, con su autor y su nota |
| `artifacts` | El markdown de cierre, con su texto completo                                 |

No se escribe un `artifact` sin un `approval` antes: `emit` recibe el `approval_id` y `finishConfirmed` se niega a seguir sin él.

## Estados del expediente

```
intake ─► enrich ─► route ─► retrieve ─► propose ─┬─► await_approval ─┬─► emit
                                                  │                   └─► refused
                                                  ├─► handoff ─► emit
                                                  ├─► refused
                                                  └─► emit
```

Cada turno repite el tramo de `enrich` a `propose`, y `retrieve` solo aparece si hizo falta buscar. Una respuesta del asistente se queda en `propose` hasta que el local la revisa, y entonces pasa a `emit`.

| Estado           | Significa                                                     |
| ---------------- | ------------------------------------------------------------- |
| `intake`         | Se acaba de abrir                                             |
| `enrich`         | Se ha leído el mensaje: idioma, intención                     |
| `route`          | Se ha decidido el camino: local o rechazo                     |
| `retrieve`       | Se ha buscado en el conocimiento (solo si hacía falta)        |
| `propose`        | El asistente ha contestado; la conversación sigue abierta     |
| `await_approval` | Hay un pedido o reserva esperando a una persona               |
| `handoff`        | Lo tiene que atender una persona                              |
| `refused`        | Rechazado, por el motor o por el local                        |
| `emit`           | Cerrado: una persona lo aprobó y hay markdown de cierre       |

## Estados de una solicitud

```
collecting ─► pending ─┬─► confirmed
                       ├─► denied
                       └─► change_proposed ─┬─► confirmed
                                            └─► pending

inquiry/collecting ─► info/answered ─► reviewed
question/pending  ─► answered
handoff/pending   ─► answered
```

`collecting` es que se están recogiendo datos: el local no lo ve. Ver [Una persona confirma](./24-human-in-the-loop.md).

## Dinero y tiempo

- Los importes son enteros en céntimos. Los decimales solo aparecen al enseñarlos, así que las sumas son exactas.
- Las fechas de las columnas son `timestamptz`. Dentro de `data` y `dialog` van en hora de pared de Madrid, porque «las 11:00» de un encargo no cambia con el horario de verano.
