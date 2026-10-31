---
title: Reservas
---

# Reservas

El obrador no reserva: su `business.json` declara `"capabilities": ["info", "order"]`. Pero el motor sí sabe, y es una de las razones de que esté separado de los datos: **lo que hace el asistente depende de lo que declara cada negocio**.

La web de esta demo no enseña las reservas. Están en `engine/biz/booking.mjs`, y se prueban con dos negocios inventados en `engine/test/fixtures/`, que solo existen para eso.

## Dos modos

| Modo     | Negocio tipo | Se reserva                       | Se elige                     |
| -------- | ------------ | -------------------------------- | ---------------------------- |
| `tables` | Restaurante  | Una mesa para N personas         | Día, hora y personas         |
| `staff`  | Peluquería   | Un servicio con un profesional   | Servicios, día, hora y con quién |

El flujo es el mismo que el de un pedido: se aplica lo que traiga el mensaje y se pregunta lo primero que falte, de uno en uno, hasta dejar una solicitud `pending`.

```js
function nextNeed(c) {
  const b = c.state.booking;
  if (isStaff(c)) {
    if (!b.services?.length) return 'service';
  } else if (!b.party) return 'party';
  if (!b.ymd) return 'date';
  if (b.min == null) return 'time';
  if (!b.name) return 'name';
  // ...teléfono y notas
  return 'confirm';
}
```

## Mesas

```json
"booking": {
  "mode": "tables",
  "slot_minutes": 30,
  "duration_minutes": { "default": 90, "long": 120, "long_from": 6 },
  "party": { "min": 1, "max": 12, "handoff_over": 8 },
  "lead_minutes": 90,
  "horizon_days": 60,
  "last_seating_before_close_minutes": 60,
  "tables": [{ "seats": 2, "count": 6 }, { "seats": 4, "count": 8 }, { "seats": 8, "count": 1 }]
}
```

`tableAvailability` recorre cada franja y, para cada tamaño de mesa donde quepa el grupo, comprueba que siga libre durante toda la comida, no solo al sentarse. Asigna la mesa más pequeña que sirva. La ocupación de fondo sale del mismo generador con semilla que en los pedidos.

Un grupo por encima de `handoff_over` no sigue: pasa a una persona, porque hay que preparar mesas y menú.

## Citas con profesional

```json
"resources": [
  { "id": "marta", "name": "Marta", "services": "all", "hours": { "tue": [["10:00", "20:00"]] } },
  { "id": "iago", "name": "Iago", "services": ["corte-hombre", "barba"], "hours": { "tue": [["10:00", "20:00"]] } }
]
```

- Cada profesional tiene su horario y sus servicios.
- La duración es la suma de los servicios pedidos.
- `eligibleResources` deja solo a quien hace **todos** los servicios: si alguien pide corte de mujer y tinte, Iago no aparece.
- `seededBusy` genera citas de fondo para cada profesional, de 30 a 90 minutos.
- Se puede pedir a alguien («con Marta») o no («me da igual»).

## Después de confirmar

Una reserva tiene un paso más que un pedido: al aprobarla, se crea un evento de calendario.

```js
export function createCalendarEvent({ approvalId }) {
  if (!approvalId) return { ok: false, created: false, error: 'approval_id required' };
  return { ok: true, created: true, event_id: `cal-${String(approvalId).slice(0, 48)}` };
}
```

Es un doble: no hay ninguna cuenta de calendario detrás. Pero conserva la regla que importa: sin una aprobación guardada no se crea nada, y un test lo vigila.

## Por qué se queda

Es código que la web de la demo no ejecuta, y eso tiene un coste. Se queda porque es lo que convierte esto en un motor y no en el chat de una pastelería: otro negocio usa el mismo asistente con otros datos. La [guía de datos](./26-business-data.md) explica cómo añadir uno.

## Un negocio que no reserva

Si alguien pide reservar en el obrador, `analyze` lo marca como `booking_unsupported`:

```
Cliente:    quiero reservar una mesa para cuatro el sábado
Asistente:  Aquí no gestiono reservas. Puedes llamar al 981 000 404 y te atienden.
```

Si solo lo pregunta («¿hacéis reservas?»), contesta lo que diga el conocimiento del negocio.
