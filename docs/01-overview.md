---
title: Visión general
---

# Visión general · Obrador Mel

**Obrador Mel** es la web de una pastelería ficticia de Santiago de Compostela con un asistente de chat que lleva encargos de verdad. Lee lo que le escribe el cliente en castellano o en gallego, calcula el precio, comprueba plazos y huecos de recogida y deja el pedido preparado. Hasta que una persona del obrador lo confirma, no hay pedido.

> Soy un asistente; una persona lo confirmará.

Esa frase es la regla del proyecto y la promesa que el asistente repite. El asistente **propone**; una persona **decide**. Solo entonces hay un efecto fuera del chat.

Tiene tres partes:

- **La web** (`web/`): la pastelería en Angular 22, con sus tartas, sus plazos, la carta del día y el horario.
- **El motor** (`engine/`): el asistente, escrito en JavaScript sin frameworks. Una sola dependencia: el cliente de Postgres.
- **El panel del local**: lo que vería una persona del obrador. Se abre desde la propia web para que quien pruebe la demo vea los dos lados.

## Qué lo hace distinto

El asistente no es un envoltorio de un modelo de lenguaje. La mayoría de los turnos se resuelven sin modelo, con código determinista, en menos de 30 ms: entender el mensaje, decidir qué toca, calcular precios, comprobar huecos. El modelo local solo entra para contestar con el conocimiento del negocio lo que los datos no resuelven, y su respuesta se comprueba antes de enseñarla: si trae un precio, un plazo o una hora que no está en las fuentes, se descarta y se responde con el texto de la fuente.

| Lo decide                    | Qué                                                                 |
| ---------------------------- | ------------------------------------------------------------------- |
| El motor, con reglas         | Intención, idioma, productos, cantidades, fechas, horas              |
| El motor, con los datos      | Precios, horario, alérgenos, plazos, huecos de recogida             |
| El modelo, dentro de un marco | Redactar una respuesta a partir de las fuentes que le da el motor   |
| Una persona                  | Confirmar, rechazar o proponer otra hora; contestar lo que no se sepa |

Si el modelo o la base de vectores se caen, la demo sigue funcionando: la búsqueda pasa a ser por palabras y la respuesta es el texto de la propia fuente. Solo Postgres es imprescindible.

## Enlaces

- **GitHub:** [Criscode2022/obrador-mel](https://github.com/Criscode2022/obrador-mel)
- **Nombre en el código:** el negocio se llama `pasteleria` en las rutas y en `datasets/`. La marca es **Obrador Mel**.

## Stack

| Capa        | Tecnología                                                                        |
| ----------- | --------------------------------------------------------------------------------- |
| Web         | Angular 22.2 sin Zone.js, signals, SCSS propio, sin librería de componentes       |
| Motor       | Node 24 con módulos ES y `node:http`; una dependencia, `pg`                       |
| Datos       | Postgres 16: expedientes, mensajes, solicitudes y su rastro                       |
| Búsqueda    | Qdrant 1.19 para los vectores, más búsqueda por palabras en el propio motor       |
| Modelo      | Ollama en local: `qwen3.5:9b-mlx` para responder, `nomic-embed-text` para embeber |
| Servidor web | `web/serve.mjs`, Node sin dependencias: estáticos y una API de lista cerrada     |
| Pruebas     | `node --test`, sin librerías de testing                                           |
| CI          | GitHub Actions con un Postgres de servicio                                        |

## En cifras

|                                  |                                                       |
| -------------------------------- | ----------------------------------------------------- |
| Productos                        | 19, en 4 categorías                                   |
| Idiomas del asistente            | Castellano y gallego                                  |
| Trozos de conocimiento           | 46: 26 secciones, 19 productos y la ficha del local   |
| Tests unitarios                  | 139 en 12 ficheros, en menos de medio segundo         |
| Tests de integración             | 26 contra Postgres                                    |
| Tests del servidor web           | 10 contra el proceso real                             |
| Conversaciones de extremo a extremo | 32, por HTTP                                       |
| Un turno sin modelo              | Entre 5 y 30 ms                                       |
| Un turno con modelo              | Entre 1 y 2,5 s con el modelo cargado                 |
| Bundle inicial                   | 268 kB (76 kB transferidos)                           |
| Dependencias del motor           | 1                                                     |

Los tiempos se midieron en un Mac mini con Apple Silicon y 24 GB de memoria.

## Cómo leer esta documentación

| Documento                                          | Para                                                |
| -------------------------------------------------- | --------------------------------------------------- |
| [Producto y features](./02-product.md)             | Qué hace y para quién                               |
| [Arquitectura](./03-architecture.md)               | Cómo viaja un mensaje y dónde vive el estado        |
| [Estructura](./04-structure.md)                    | Dónde está cada cosa                                |
| [API del motor](./05-api.md)                       | Las rutas, con ejemplos                             |
| [Sesiones y acceso](./06-auth.md)                  | Por qué no hay cuentas y cómo se separan los visitantes |
| [Modelo de datos](./07-data-model.md)              | Las tablas y los estados                            |
| [Puesta en marcha](./08-deploy.md)                 | Cómo arrancarlo y cómo se publicaría                |
| [Decisiones](./09-decisions.md)                    | Por qué está hecho así                              |
| [Retos y resultados](./10-challenges-results.md)   | Lo que costó y lo que quedó                         |
| [Angular](./11-angular-skill.md)                   | Qué APIs de Angular usa                             |

La parte de testing empieza en [Testing · visión](./12-testing.md). El funcionamiento interno del motor, pieza a pieza, empieza en [El motor de conversación](./17-conversation-engine.md).
