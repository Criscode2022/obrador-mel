---
title: Disponibilidad
---

# Disponibilidad

`engine/biz/avail.mjs` decide qué huecos hay. Todo se calcula en el motor, y el modelo nunca interviene.

Hay tres fuentes:

1. **El horario y los cierres**, del `business.json`.
2. **La ocupación de fondo**, de un generador con semilla.
3. **Lo que ha pedido el propio visitante**, que se resta encima.

## Horario

`dayRanges(biz, ymd)` devuelve los tramos abiertos de un día en minutos, o nada si cierra.

```js
dayRanges(mel, '2026-10-15') // [[540, 840], [990, 1200]]  jueves: 9:00–14:00 y 16:30–20:00
dayRanges(mel, '2026-10-19') // []                          lunes
dayRanges(mel, '2026-12-25') // []                          festivo
```

Con eso se responde `isOpenAt` y `nextOpening`, que busca dos semanas por delante.

## Ocupación de fondo

Sin otros clientes, una demo enseñaría todos los huecos libres. En lugar de crear pedidos falsos, cada franja recibe una ocupación entre 0 y 1 calculada a partir del negocio, el día y la franja. Simplificado:

```js
export function backgroundLoad(biz, cfg, ymd, min) {
  const load = cfg.load ?? {};
  const key = `${weekdayKey(ymd)}_${dayPart(min)}`;         // 'sat_lunch'
  const base = load.overrides?.[key] ?? load.default ?? 0.3;
  const block = Math.floor(min / 30);
  const noise = (hash01(`${biz.slug}|${ymd}|${block}`) - 0.5) * 0.5;
  return clamp(base + noise, 0, 1);
}
```

| Parte     | Papel                                                                   |
| --------- | ----------------------------------------------------------------------- |
| `default` | Ocupación normal: 0,2 en el obrador                                     |
| `overrides` | Momentos concretos: `sat_lunch` 0,65, `sun_lunch` 0,7, `fri_dinner` 0,55 |
| `noise`   | Hasta ±0,25 por media hora, para que no todas las franjas sean iguales  |

`hash01` es un FNV-1a con una mezcla final: convierte un texto en un número entre 0 y 1, siempre el mismo para el mismo texto.

Así el resultado tiene las propiedades de unos datos reales sin serlo: es igual para todos los visitantes, no cambia al reiniciar y no ocupa nada en la base de datos.

## Huecos de recogida

`pickupAvailability(biz, { ymd, now, leadMinutes, own })`:

1. Rechaza un día pasado (`past`), demasiado lejano (`too_far`) o cerrado (`closed`).
2. Recorre cada tramo abierto de 30 en 30 minutos, hasta 15 minutos antes de cerrar.
3. Se salta lo que no llega al plazo: `ahora + leadMinutes`.
4. Calcula cuántos pedidos caben: `max_per_slot`, menos la ocupación, menos los del visitante.

```js
function pickupLeft(biz, cfg, ymd, min, own) {
  const max = cfg.max_per_slot ?? 5;
  const seeded = Math.round(max * backgroundLoad(biz, cfg, ymd, min));
  const mine = own.filter((o) => o.ymd === ymd && o.start === min).length;
  return Math.max(0, max - seeded - mine);
}
```

Devuelve `{ ok, reason, slots: [{ time, min, left }] }`.

## Lo que ha pedido el visitante

`ownBlocks` lee de Postgres sus solicitudes vivas (`pending`, `confirmed`, `change_proposed`) y las convierte en bloques que se restan. Si cambia la hora propuesta, el bloque usa la nueva.

Es por sesión: lo que pide un visitante solo le resta huecos a él. En una demo pública, eso evita que alguien pueda llenar la agenda de los demás.

## Las herramientas del flujo

| Función          | Para                                                          |
| ---------------- | ------------------------------------------------------------- |
| `firstPickup`    | El primer hueco desde ahora, hoy o el siguiente día abierto   |
| `nearestSlots`   | Las tres horas libres más cercanas a la pedida                |
| `windowProblem`  | Por qué un día queda fuera, en las reservas                   |

## La agenda

`agendaOf` prepara lo que ve el panel para un día. Para el obrador, una fila por hueco:

```json
{ "time": "11:00", "min": 660, "taken": 4, "mine": 1, "total": 6 }
```

El panel pinta `taken` en gris como *Otros clientes* y `mine` con el color de la marca como *Tus pruebas*, para que quede claro qué es de la demo y qué ha hecho el visitante.

## Comprobar dos veces

La disponibilidad se comprueba cuando el cliente elige la hora, al enviar el pedido y cuando el local propone otra hora. El hueco puede haber cambiado entre medias, y es el último momento antes de comprometerse.

Lo que no hay es una reserva del hueco mientras se habla: dos visitantes reales podrían pedir el último hueco a la vez. Una persona confirma los dos después, y es ella quien lo resolvería. Para un negocio real con mucho volumen haría falta un bloqueo.
