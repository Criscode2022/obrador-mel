---
title: Fechas y horas
---

# Fechas y horas

«El sábado a las nueve y media», «mañá pola tarde», «dentro de dos semanas». Leer fechas en texto libre, en dos idiomas, en la zona horaria de Madrid, es lo que más casos raros tiene del motor. Está repartido en dos ficheros:

| Fichero         | Lee                                                     | Depende del negocio |
| --------------- | ------------------------------------------------------- | ------------------- |
| `when.mjs`      | El día, y las fechas en hora de Madrid                  | No                  |
| `biz/dates.mjs` | La hora y las expresiones relativas                     | Sí, de su horario   |

## El día

`findDay` busca todas las expresiones de día del mensaje, con su posición.

| Tipo         | Ejemplos                                                  |
| ------------ | --------------------------------------------------------- |
| Fecha escrita | «el 15 de octubre», «o 2 de outubro»                     |
| Fecha numérica | «el 15/10», «15-10-2026»                                |
| Día del mes  | «el día 3»                                                |
| Relativo     | «hoy», «mañana», «pasado mañana», «hoxe», «mañá»          |
| A N días     | «dentro de 10 días», «en dos semanas», «dentro de un mes» |
| Semana       | «la semana que viene»                                     |
| Día de la semana | «el viernes», «o xoves»                               |

### Cuando hay varios días

Si hay más de uno, hay que elegir bien. Quien escribe «¿puedo cambiar del viernes al lunes?» quiere el lunes.

| Mensaje                                                       | Día      |
| ------------------------------------------------------------- | -------- |
| Tenía cita el viernes. ¿Me la podéis pasar al martes a las 11? | martes  |
| ¿Puedo cambiar mi cita del viernes al lunes?                  | lunes    |
| Quiero cambiar la cita al lunes porque el viernes no puedo    | lunes    |
| Cita el lunes o el martes                                     | lunes    |
| Hoy me llegó la notificación; quiero cita el jueves a las 17  | jueves   |

La regla: primero descarta los días de un aviso («me notificaron el 22»), después prefiere el que va detrás de una palabra de reserva, luego el que va justo delante, y si no, el último si está pidiendo un cambio o el primero en otro caso.

### De la expresión a la fecha

`resolveDay` convierte lo encontrado en una fecha real, con algunas decisiones:

- El mismo día de la semana que hoy es el de la semana que viene: el miércoles, dicho en miércoles, es dentro de siete días.
- Una fecha que ya pasó este año es la del año que viene: «el 3 de marzo» dicho en octubre.
- «El día 3» ya pasado este mes es el del mes siguiente.
- Una fecha que no existe, como «31 de febrero», se marca como inválida y no se corrige por su cuenta.

## «Mañana» y «por la mañana»

Es la misma palabra para dos cosas, y sin tildes el gallego «mañá» queda en `mana`:

```js
// «Por la mañana», «pola mañá», «esta mañá»: es la parte del día, no el día de mañana.
export const MORNING_RE = /\b(?:por|pola|de|na|en|esta) (?:la |a )?(?:manana|mana)\b/g;
```

Antes de buscar el día se quita la parte del día, y así «mañá pola mañá» es mañana por la mañana.

## La hora

`parseTime` lee, por orden:

| Forma              | Ejemplos                                         |
| ------------------ | ------------------------------------------------ |
| Relativa           | «en 20 minutos», «dentro de media hora»          |
| Lo antes posible   | «ahora», «cuanto antes», «canto antes»           |
| De reloj           | «11:30», «11.30», «11h30»                        |
| Con letra `h`      | «18h», «18 horas»                                |
| Con artículo       | «a las 9», «a las nueve y media», «ás oito», «a las ocho menos cuarto» |
| Mediodía           | «a mediodía»                                     |
| Número suelto      | «11», solo si se acaba de preguntar la hora      |

Antes de leer se quitan los teléfonos y los «4 personas», para que no se tomen por una hora.

### La hora ambigua

«A las 9» puede ser por la mañana o por la noche. `to24` lo resuelve con lo que sabe:

1. Una hora de 13 en adelante no es ambigua.
2. Si la frase lo dice («de la tarde», «por la mañana»), manda la frase.
3. Si solo una de las dos lecturas cae dentro del horario, esa.
4. Si caen las dos, la costumbre del negocio (`hour_bias`).
5. Si no cae ninguna, por la tarde hasta las 7, porque nadie encarga de madrugada.

| Mensaje              | Obrador | Restaurante |
| -------------------- | ------- | ----------- |
| a las 9              | 09:00   | 21:00       |
| a las 8              | 08:00   | 20:00       |
| a las 7              | 19:00   | 19:00       |
| a las 5              | 17:00   | 17:00       |
| a las 3              | 15:00   | 15:00       |
| a las 9 de la mañana | 09:00   | 09:00       |

Una lectura fuera de horario no es un error: la hora se comprueba después, y el asistente ofrece las más cercanas.

## Ambigüedades de día

«Este finde» o «la semana que viene» no son un día. `parseDay` las marca como `ambiguous`, y el flujo pregunta qué día exactamente, con botones de los días con hueco.

## Horas relativas

«Dentro de 20 minutos» devuelve `relMin: 20`. El flujo busca el primer hueco a partir de ese momento. Con «lo antes posible» hace lo mismo desde ahora.

## La zona horaria

Todo el motor razona en hora de pared de Madrid, sin importar dónde corra el servidor.

```js
madridParts(new Date('2026-10-15T06:30:00Z'))
// { year: 2026, month: 10, day: 15, hour: 8, minute: 30, ... }

madridIso(2026, 10, 24, 10, 0) // '2026-10-24T10:00:00+02:00'
madridIso(2026, 10, 26, 10, 0) // '2026-10-26T10:00:00+01:00'
```

`madridIso` obtiene el desfase por aproximación, preguntándole a `Intl.DateTimeFormat` qué hora de pared corresponde a cada instante. Así funciona a ambos lados del cambio de hora sin tablas ni librerías.

Dentro del motor, un día es `2026-11-07` y una hora, los minutos desde medianoche (`660` son las 11:00). Solo `slot_start` y `slot_end` llevan huso.
