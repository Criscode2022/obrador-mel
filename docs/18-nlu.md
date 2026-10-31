---
title: Entender el mensaje
---

# Entender el mensaje

`analyze()` en `engine/biz/nlu.mjs` convierte un mensaje en **señales**. No decide nada, no llama a ningún modelo y tarda microsegundos.

¿Por qué reglas y no un modelo? Porque el dominio es pequeño, los errores tienen que ser reproducibles y hace falta que corra en cada turno sin coste. Un modelo que se equivoca una de cada cien veces al leer «para 12» acaba en una tarta mal hecha. Una expresión regular que se equivoca se arregla con un test.

## Normalizar

Todo se compara sin tildes y en minúsculas:

```js
normalize('Mañá ÁS Cinco') // 'mana as cinco'
```

Para el texto de cliente hay un paso más, `clean`, que quita la puntuación. Los productos se comparan además en singular aproximado: `palmeras` y `palmera` son la misma palabra para el catálogo.

## Idioma

`detectLang` cuenta palabras que solo existen en uno de los dos idiomas.

```js
const GL_ONLY = /\b(?:ola|grazas|quero|teno|unha|onde|cando|hoxe|abrides|pechades|...)\b/g;
const ES_ONLY = /\b(?:hola|gracias|quiero|tengo|una|donde|cuando|hoy|abris|cerrais|...)\b/g;
```

Gana el que tenga más. Si empatan (por ejemplo, «vale»), se queda el idioma que ya llevaba la conversación. El idioma se reevalúa en cada mensaje, y todo lo que se dice desde el motor pasa por `c.t(es, gl)`.

## Las señales

```js
{
  raw, text, norm,               // el mensaje original, tapado y normalizado
  lang,                          // 'es' | 'gl'
  flags,                         // ['card', 'dni'] si se ha tapado algo
  short,                         // 5 palabras o menos
  greet, thanks, bye, yes, no,   // actos sueltos
  cancel, change, handoff, asap, // lo que se pide hacer
  anyone, no_notes, offtopic,
  question, order_kw, booking_kw, want_kw,
  asks_options, process_question,
  has_items, items,              // lo encontrado en la carta
  when,                          // día, hora, parte del día
  party, resource,               // personas y profesional
  name, phone, email,            // contacto
  diet,                          // alérgenos y dietas
  topic, topics,                 // horario, dirección, teléfono, precio, carta
  refusal,                       // si hay que rechazar
  primary,                       // la intención principal
}
```

## La intención principal

Se decide en orden, y gana la primera que encaje. El orden es parte del diseño: una tarjeta se rechaza aunque el mensaje también pida una tarta.

| Orden | Intención             | Cuándo                                                                |
| ----- | --------------------- | --------------------------------------------------------------------- |
| 1     | `refuse`              | Tarjeta, inyección, abuso o una regla del negocio                     |
| 2     | `handoff`             | Pide una persona, o toca un tema de `handoff_topics`                  |
| 3     | `cancel`              | Cancela y no menciona productos                                       |
| 4     | `yes`, `no`           | Se esperaba una respuesta y el mensaje es corto                       |
| 5     | `booking`             | Palabras de reserva, y el negocio reserva                             |
| 6     | `order`               | Palabras de pedido o productos, y no es una pregunta sobre el proceso |
| 7     | `booking_unsupported` | Palabras de reserva en un negocio que no reserva                      |
| 8     | `order_unsupported`   | Pide en un negocio que no vende                                       |
| 9     | `thanks`, `bye`, `greet` | Actos sueltos                                                      |
| 10    | `offtopic`            | Chistes, política, programación                                       |
| 11    | `info`                | Todo lo demás                                                         |

### Pedir o preguntar

Es la decisión más delicada. Las dos frases mencionan una tarta:

| Mensaje                                       | Intención |
| --------------------------------------------- | --------- |
| Quiero una tarta de queso                     | `order`   |
| ¿Cuánto cuesta la tarta de queso?             | `info`    |
| ¿Con cuánta antelación hay que encargar?      | `info`    |
| Dos palmeras y un brownie                     | `order`   |
| ¿Qué puedo pedir?                             | `info`    |

Hay dos señales para esto. `process_question` reconoce una pregunta sobre cómo funciona («¿cómo se encarga?»), y `asks_options` una que pide opciones («¿qué puedo pedir?»), aunque las dos lleven la palabra «pedir».

### Saludar

«Hola» es un saludo, pero «Hola, ¿a qué hora abrís?» es una pregunta. `onlyGreets` quita los saludos del principio y mira lo que queda: si no queda nada, o una palabra que no sea una pregunta, es un saludo.

## Temas

`TOPICS` tiene una familia de frases por tema: `hours`, `address`, `phone`, `price` y `menu`. `detectTopics` devuelve todos los temas de un mensaje en orden de aparición:

```js
detectTopics('¿dónde estáis y a qué hora abrís?') // ['address', 'hours']
```

Así un mensaje con dos preguntas se contesta entero.

## Dietas y alérgenos

`detectDiet` busca los 14 alérgenos de la Unión Europea con sus palabras cotidianas, y distingue «sin gluten» de «lleva gluten»:

```js
detectDiet('¿qué tenéis sin gluten?')  // { avoid: ['gluten'], tags: [], free: true }
detectDiet('soy celíaca')              // { avoid: ['gluten'], tags: [], free: true }
detectDiet('algo vegano')              // { avoid: [], tags: ['vegano'], free: false }
```

## Datos de contacto

| Función        | Lee                                                                       |
| -------------- | ------------------------------------------------------------------------- |
| `extractName`  | «a nombre de Xoán Pérez», «soy Iria», o una palabra suelta si se esperaba |
| `extractPhone` | Móviles y fijos españoles, con espacios, puntos o prefijo `+34`           |
| `extractEmail` | Un correo                                                                 |

«Soy celíaca» no es un nombre: tras «soy» solo vale una palabra con mayúscula. Y `NAME_STOP` evita que «hola» o «vale» se tomen por un nombre cuando se está esperando uno.

## Rechazos

`refusalFor` mira, en este orden: si se ha tapado una tarjeta, si es una inyección, si cumple una regla propia del negocio y si es un insulto.

```js
injection: /\b(?:ignore (?:all |any )?(?:previous|prior|above|your)|ignora (?:todas? )?(?:tus|las|lo|todo)|
             system prompt|prompt del sistema|tus instrucciones|actua como|modo desarrollador|...)\b/
```

Un negocio puede añadir sus propias reglas en `refusals`, con su patrón y su respuesta. Ver [Privacidad y seguridad](./25-privacy-and-safety.md).

## Lo que no entiende

Las reglas no leen ironía ni frases muy retorcidas. Cuando no reconocen nada, la intención es `info` y el mensaje va a la búsqueda. Si la búsqueda tampoco encuentra nada, pasa a una persona: el peor caso de una lectura floja es que alguien tenga que contestar, nunca que se confirme algo que no se pidió.
