---
title: Privacidad y seguridad
---

# Privacidad y seguridad

Un asistente abierto al público recibe de todo: datos personales que nadie pidió, intentos de manipularlo y preguntas sobre alergias que importan de verdad. Esto es lo que hace el proyecto con cada cosa, y dónde está probado.

## Datos personales

### Lo que nunca se guarda

`engine/pii.mjs` tapa tarjetas y DNI antes de que el mensaje toque la base de datos.

```js
scrub('mi tarjeta es 4111 1111 1111 1111')
// { text: 'mi tarjeta es [TARJETA]', flags: ['card'] }

scrub('mi dni es 12345678-Z')
// { text: 'mi dni es [DNI]', flags: ['dni'] }
```

Una tarjeta solo se tapa si pasa el dígito de control de Luhn, así que un número de pedido largo no se pierde. El DNI se reconoce con letra, con espacio o guion, y también el NIE.

### Todos los caminos

Una regla como «las tarjetas no se guardan» no se cumple tapando en un sitio, sino en todos los caminos por los que entra el dato:

| Camino                         | Cómo se protege                                                     |
| ------------------------------ | ------------------------------------------------------------------- |
| El mensaje del cliente         | `scrub` en `chatTurn`, antes de guardarlo                           |
| El resumen del expediente      | `classify` → `redact`, que pasa por `scrub` y tapa además correo y teléfono |
| Las notas del pedido           | Se leen del texto tapado, no del original                           |
| El aviso a una persona         | También del texto tapado                                            |
| La etiqueta y el valor de un botón | `actionLabel` y `cleanAction` pasan por `scrub`                 |
| Lo que recibe el modelo        | El texto tapado                                                     |

`engine/test/flow.test.mjs` lo comprueba de la única forma fiable: vuelca todo lo guardado de un expediente (resumen, mensajes, solicitudes, eventos, propuestas) y busca el número.

### Lo que sí se guarda

El nombre y el teléfono de un pedido, porque hacen falta para atenderlo. Los mensajes quedan en Postgres. Un negocio real necesitaría una política de retención, que esta demo no tiene.

### Clasificación

`classify` marca cada expediente con el dato más sensible que trae:

```
minor > health > dni > card > phone > email > none
```

Se calcula con el mensaje original, antes de tapar, para que un DNI cuente como DNI. Solo se guarda el nivel, en `cases.pii_level`.

### Nada sale de la máquina

El modelo y los embeddings corren en local con Ollama. No hay analítica, ni fuentes de terceros, ni scripts externos.

## Pagos

El asistente nunca pide una tarjeta. Si alguien la escribe:

```
Por seguridad, no escribas datos de tarjeta por aquí: no los necesito ni los guardo
(los he tapado en el chat). El pago se hace en el local.
```

## Alergias

Es el dato con más consecuencias. Las reglas son:

- La lista de alérgenos sale de `catalog.json`, no del modelo. Los 14 de la Unión Europea, validados al cargar.
- Toda respuesta sobre alérgenos añade que una persona lo confirma.
- El asistente dice «no consta» y no «no lleva», porque el obrador trabaja con todo en el mismo espacio.
- El prompt prohíbe afirmar que un producto es apto si el contexto no lo dice, y confirmar que algo es seguro para una alergia grave.

```
Brownie sin harina contiene frutos secos. Si es una alergia o intolerancia grave,
una persona del local lo confirma con cocina antes de preparar nada.
```

## Manipular al asistente

`refusalFor` detecta los intentos habituales de cambiarle las reglas, en castellano y en inglés («ignora tus instrucciones», «actúa como», «system prompt»).

```
No puedo cambiar mis reglas ni compartir mis instrucciones. Sí puedo ayudarte con
Obrador Mel: la carta, los horarios o dejarte algo preparado.
```

Pero esa lista no es la protección de verdad, porque siempre habrá una forma de decirlo que no esté. La protección es el diseño:

- **El modelo no tiene herramientas.** No puede tocar un pedido ni leer otros datos.
- **Solo ve las secciones del negocio** y la pregunta. No hay nada secreto que sacarle.
- **Lo que devuelve se comprueba.** Un precio inventado no llega al cliente.
- **Lo que compromete al negocio no pasa por él.** Una persona confirma.

Lo peor que puede conseguir alguien es una frase rara en su propio chat.

## La API

| Medida                     | Dónde                | Para                                                        |
| -------------------------- | -------------------- | ----------------------------------------------------------- |
| Lista cerrada de rutas     | `web/serve.mjs`      | Lo no previsto es un 404, sin llegar al motor               |
| Motor solo en `127.0.0.1`  | `engine/server.mjs`  | No se le puede llamar desde fuera                           |
| 40 mensajes/min por dirección y 150 en total | `web/serve.mjs` | Un visitante no acapara el modelo          |
| 40 mensajes/min por sesión | `routes.mjs`         | Lo mismo, si alguien llega directo                          |
| 2 conversaciones a la vez  | `routes.mjs`         | El modelo no se satura; el resto espera 9 s y recibe un 429 |
| 60 expedientes al día por sesión | `flow.mjs`     | Un bucle no llena la base de datos                          |
| Cuerpos de 8 KB            | Web y motor          | Sin cuerpos enormes                                         |
| Botones en lista cerrada   | `cleanAction`        | Un campo inventado se ignora                                |
| Consultas parametrizadas   | Todo el motor        | Sin inyección SQL                                           |
| Slugs validados            | `validSlug`          | `../etc` no llega al disco                                  |

`X-Forwarded-For` solo se tiene en cuenta con `TRUST_PROXY=1`. Si no, un cliente podría inventársela y saltarse el límite. Hay un test para eso.

## Cabeceras

`serve.mjs` las añade a todas las respuestas, también a los errores.

```
Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
                         base-uri 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```

La política no permite scripts en línea, y la integración continua comprueba que el build no traiga ninguno. `'unsafe-inline'` en estilos hace falta porque Angular inyecta los estilos de sus componentes en etiquetas `<style>`.

Al motor no le llegan cookies ni cabeceras del cliente: `serve.mjs` reenvía solo `content-type`, `content-length` y `accept`.

## Ficheros

`serve.mjs` solo sirve lo que esté dentro de `dist/`, y lo comprueba después de decodificar la ruta, así que `/..%2f` no sirve para salirse. Un fichero que no existe es un 404, no el HTML de la portada.

## Fuera de tema

El asistente solo habla del obrador. Lo que reconoce como fuera de tema (chistes, política, programación) se reconduce sin llamar al modelo:

```
Eso se me escapa: solo puedo ayudarte con Obrador Mel. Si quieres, te cuento la carta o los horarios.
```

## Lo que falta para un negocio real

- Un acceso de verdad para el panel. Ver [Sesiones y acceso](./06-auth.md).
- Una política de retención y borrado de mensajes.
- Un texto legal sobre el tratamiento de los datos.
- Bloquear el hueco mientras se habla, si hubiera mucho volumen. Ver [Disponibilidad](./21-availability.md).
