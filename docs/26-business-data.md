---
title: Datos del negocio
---

# Datos del negocio

El asistente no sabe nada de pastelerías. Todo lo que sabe del obrador está en `datasets/pasteleria/`, y el motor lo carga al arrancar. Cambiar un precio es editar un JSON; adaptarlo a otro negocio es escribir otra carpeta.

```
datasets/pasteleria/
├─ business.json     identidad, horario, reglas y tono
├─ catalog.json      categorías, opciones y productos
└─ kb/*.md           conocimiento
```

El nombre de la carpeta es el `slug` del negocio, y tiene que coincidir con el de `business.json`.

## `business.json`

| Campo            | Obligatorio | Para                                                               |
| ---------------- | ----------- | ------------------------------------------------------------------ |
| `slug`           | Sí          | Identificador en las rutas                                         |
| `name`, `label`  | Sí          | «Obrador Mel», «Pastelería»                                        |
| `kind`, `tagline` | Sí         | Tipo y lema                                                        |
| `city`, `address`, `phone`, `email` | Sí | Datos de contacto, que salen en respuestas y en la web       |
| `capabilities`   | Sí          | `info` siempre, más `order` o `booking`                            |
| `hours`          | Sí          | Tramos por día; un día sin tramos cierra                           |
| `closed_dates`   | No          | Festivos en `YYYY-MM-DD`                                           |
| `hour_bias`      | No          | `am` o `pm`: cómo leer una hora ambigua                            |
| `assistant`      | Sí          | Tono, saludo, sugerencias y accesos rápidos                        |
| `order`          | Con `order` | Reglas de los pedidos                                              |
| `booking`        | Con `booking` | Reglas de las reservas. Ver [Reservas](./22-booking.md)          |
| `handoff_topics` | No          | Palabras que pasan directamente a una persona                      |
| `refusals`       | No          | Reglas de rechazo propias del negocio                              |

```json
"hours": {
  "mon": [],
  "tue": [["09:00", "14:00"], ["16:30", "20:00"]],
  "sun": [["09:30", "14:00"]]
}
```

### `order`

| Campo           | Obrador | Para                                                           |
| --------------- | ------- | -------------------------------------------------------------- |
| `prep_minutes`  | 15      | Preparación mínima                                             |
| `slot_minutes`  | 30      | Cada cuánto hay un hueco de recogida                           |
| `max_per_slot`  | 6       | Pedidos por hueco                                              |
| `horizon_days`  | 30      | Antelación máxima                                              |
| `need_phone`    | `true`  | Pedir teléfono                                                 |
| `ask_notes`     | `true`  | Preguntar por notas                                            |
| `max_items`     | 30      | Unidades por el chat; más lo lleva una persona                 |
| `notes_prompt`  |         | Cómo se piden las notas, en cada idioma                        |
| `items_prompt`  |         | Cómo se pregunta qué quiere, en cada idioma                    |
| `pay`           |         | Cómo se paga, en cada idioma                                   |
| `load`          |         | Ocupación de fondo: `default` y `overrides`                    |

### Reglas de rechazo

El obrador no necesita ninguna, pero un negocio con riesgos propios puede añadirlas. Por ejemplo, una clínica:

```json
"refusals": [{
  "id": "urgency",
  "pattern": "dolor en el pecho|no puedo respirar",
  "reply": { "es": "Llama al 112 ahora.", "gl": "Chama ao 112 agora." },
  "handoff": false
}]
```

El patrón se compara con el texto normalizado, sin tildes.

## `catalog.json`

### Producto

```json
{
  "id": "tarta-queso",
  "category": "tartas",
  "name": "Tarta de queso",
  "aliases": ["tarta de queso", "cheesecake", "tarta queso"],
  "price": 22,
  "description": "Cremosa, al horno, con base de galleta y mermelada de arándanos.",
  "tags": ["vegetariano"],
  "contains": ["gluten", "lacteos", "huevos"],
  "options": ["raciones"],
  "lead_hours": 48,
  "popular": true
}
```

| Campo        | Para                                                                 |
| ------------ | -------------------------------------------------------------------- |
| `aliases`    | Todas las formas de pedirlo. Es lo que más mejora el asistente       |
| `price`      | En euros; el motor lo pasa a céntimos                                |
| `price_from` | Precio «desde», para lo que depende del diseño                       |
| `tags`       | `vegano`, `vegetariano`, `sin_gluten`, `sin_lactosa`, `sin_azucar`   |
| `contains`   | De los 14 alérgenos: `gluten`, `lacteos`, `huevos`, `frutos_secos`…  |
| `options`    | Grupos de opciones que admite                                        |
| `lead_hours` | Plazo de encargo                                                     |
| `popular`    | Sale en las sugerencias y con la marca *Favorito*                    |
| `duration`   | Minutos, para servicios con cita                                     |

### Opciones

```json
"raciones": {
  "name": "Raciones",
  "required": true,
  "question": { "es": "¿Para cuántas raciones?", "gl": "¿Para cantas racións?" },
  "choices": [
    { "id": "8", "name": "8 raciones", "aliases": ["8 raciones", "para 8", "8 personas"], "delta": 0 },
    { "id": "12", "name": "12 raciones", "aliases": ["12 raciones", "para 12", "12 personas"], "delta": 8 }
  ]
}
```

Con `required`, el asistente no sigue hasta tenerla. Si no es obligatoria, necesita un `default`. `delta` es el suplemento en euros.

### Ambigüedades

Las palabras que no bastan para elegir, y entre qué productos preguntar. Ver [Pedidos](./20-ordering.md#ambigüedad).

## `kb/*.md`

Cada `## sección` es un trozo que se puede citar, con su título. Lo que importa al escribirlas:

- **Una idea por sección.** «Congelar» y «Transporte» por separado, no «Consejos».
- **El título con las palabras del cliente.** «Sin lactosa», no «Intolerancias alimentarias».
- **Las cifras, escritas.** Si el modelo tiene que decir «48 horas», tiene que estar en el texto; si no, la respuesta se descarta.
- **Lo que no se hace, también.** «No hacemos envíos» es una respuesta, y evita pasarle la pregunta a una persona.

Las subcarpetas de `kb/` también se leen.

## Validar

`store.mjs` comprueba todo al cargar. Un negocio con errores no se carga y `GET /biz/problems` dice por qué:

```json
{ "problemas": ["pasteleria/catalog: tarta-queso: alérgeno desconocido «arena»"] }
```

`npm --prefix engine test` falla con cualquier problema en los datos, así que un error en la carta no llega a publicarse.

Comprueba, entre otras cosas: que `slug` coincida con la carpeta, que los horarios sean válidos y no estén al revés, que haya al menos un día abierto, que cada producto tenga una categoría que exista, que los alérgenos y las etiquetas sean de la lista, que las opciones existan, y que haya saludo en los dos idiomas.

## Después de cambiar algo

El motor detecta los cambios en `datasets/` y los recarga solo. Lo que no se actualiza solo son los vectores:

```bash
./scripts/ingest.sh
```

## Añadir otro negocio

1. Crea `datasets/<slug>/` con sus tres partes.
2. Pasa los tests: `npm --prefix engine test`. El test del dataset único (`allSlugs`) habrá que ampliarlo.
3. Ingiere el conocimiento: `./scripts/ingest.sh`.
4. En la web, crea `web/src/app/negocios/sites/<slug>.{ts,html,scss}` heredando de `SiteBase`, y añade su ruta.

La web de cada negocio es un componente propio, con su diseño y su copy. Lo común (`BizFrame`, `BizChat`, `BizStaff`, `BizMenu`) se tiñe con sus variables CSS. Ver [Diseño](./27-design.md).
