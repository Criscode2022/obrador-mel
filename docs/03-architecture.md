---
title: Arquitectura
---

# Arquitectura

## Diagrama lógico

```
Navegador (Angular 22)
    │  GET  /                       la web y sus ficheros
    │  POST /api/pasteleria/chat    un mensaje o un botón
    │  GET  /api/pasteleria/staff   el panel del local
    ▼
web/serve.mjs (127.0.0.1:4310)
    │  estáticos de dist/ y cabeceras de seguridad
    │  lista cerrada de rutas, límites de ritmo y de tamaño
    │  /api/...  ──►  /biz/...
    ▼
engine/server.mjs (127.0.0.1:8790)
    ├─ biz/routes.mjs     HTTP: validar, limitar, dos turnos a la vez
    ├─ biz/flow.mjs       el expediente: modo, persistencia, estados
    ├─ biz/dialog.mjs     un turno: qué toca hacer (sin base de datos)
    │    ├─ nlu.mjs, dates.mjs, orders.mjs    leer el mensaje
    │    ├─ ordering.mjs, booking.mjs         recoger un pedido o una reserva
    │    └─ info.mjs                          contestar con los datos
    ├─ biz/kb.mjs         búsqueda y respuesta con el modelo
    └─ biz/staff.mjs      el panel: confirmar, rechazar, cerrar
         │                    │                    │
         ▼                    ▼                    ▼
      Postgres              Qdrant               Ollama
      expedientes           vectores             embeddings y respuestas
```

Todo corre en una máquina. Ningún dato sale a un servicio externo: el modelo y los embeddings son locales.

## El viaje de un mensaje

Con «Quiero una tarta de queso para 12 personas para el sábado a las 11»:

1. **Web.** `BizChat` pinta el mensaje al momento y hace `POST /api/pasteleria/chat` con la sesión del navegador y el expediente abierto.
2. **`serve.mjs`.** Comprueba que la ruta está en la lista, que el cuerpo no pasa de 8 KB y que esa dirección no supera 40 mensajes por minuto. Reenvía a `/biz/pasteleria/chat` sin cookies ni cabeceras del cliente.
3. **`routes.mjs`.** Lee el JSON, valida la sesión, limita a 40 mensajes por minuto y sesión, y deja pasar dos conversaciones a la vez.
4. **`flow.mjs`.** Tapa tarjetas y DNI, carga el expediente y decide el modo: seguir, abrir uno nuevo, avisar al local o pregunta aparte. Guarda el mensaje del cliente.
5. **`dialog.mjs`.** `analyze` saca las señales del texto: idioma, intención `order`, la tarta, las 12 raciones, el sábado y las 11:00. `orderStep` las aplica al pedido, calcula el precio, comprueba el plazo y el hueco, y pregunta lo siguiente que falta.
6. **`flow.mjs`.** Guarda el estado de la conversación, cada decisión, lo comprobado y la respuesta, y avanza el estado del expediente.
7. **Web.** Pinta el texto, la tarjeta del pedido y los botones.

Del paso 3 al 6 pasan unos 25 ms. El modelo no ha intervenido.

Con «¿Se pueden congelar las tartas?» el paso 5 no encuentra respuesta en los datos y llama a `kb.mjs`: busca en Qdrant y por palabras, le da al modelo las mejores secciones y comprueba las cifras de lo que devuelve. Tarda entre 1 y 2,5 segundos.

## Dónde vive el estado

| Estado                          | Dónde                                     | Vida                                  |
| ------------------------------- | ----------------------------------------- | ------------------------------------- |
| Negocio: horario, carta, reglas | `datasets/pasteleria/`, en memoria        | Se recarga si cambian los ficheros    |
| Conversación en curso           | `biz_requests.dialog`, JSON en Postgres   | Lo que dure el expediente             |
| Mensajes y rastro               | Postgres                                  | Permanente                            |
| Vectores                        | Qdrant                                    | Regenerables desde `datasets/`        |
| Sesión del visitante            | `localStorage` del navegador              | La del navegador                      |
| Expediente abierto              | `localStorage`, por negocio               | Hasta que empieza otra conversación   |
| Ocupación de otros clientes     | No se guarda: se calcula con una semilla  | Siempre la misma para un día y hora   |

El proceso del motor no guarda nada de una conversación entre turnos: cada turno lee el estado de Postgres y lo escribe al terminar. Se puede reiniciar a mitad de un pedido sin perderlo.

## Capas del motor

| Capa          | Módulos                                                       | Toca la red                   |
| ------------- | ------------------------------------------------------------- | ----------------------------- |
| Datos         | `store.mjs`                                                   | Disco                         |
| Lectura       | `text`, `when`, `dates`, `nlu`, `orders`, `pii`               | No                            |
| Cálculo       | `avail`, `format`, `info`                                     | No                            |
| Conversación  | `ctx`, `dialog`, `ordering`, `booking`                        | No: el conocimiento se inyecta |
| Conocimiento  | `kb`, `llm`                                                   | Qdrant y Ollama               |
| Expediente    | `flow`, `persist`, `staff`, `calendar`                        | Postgres                      |
| HTTP          | `routes`, `server`                                            | Escucha                       |

Lo más importante de esta tabla es la columna de la derecha. `turn()`, la función que decide un turno, no toca base de datos ni red: recibe el estado, el mensaje y una función para consultar el conocimiento, y devuelve lo que hay que decir. Por eso se puede probar una conversación entera en milisegundos, sin levantar nada.

## Degradación

| Si cae    | Qué pasa                                                                                 |
| --------- | ---------------------------------------------------------------------------------------- |
| Ollama    | La búsqueda sigue por palabras y la respuesta es el texto de la mejor sección            |
| Qdrant    | La búsqueda sigue por palabras; el modelo sigue redactando                               |
| Postgres  | No hay servicio: `GET /health` devuelve 503 y el chat, un error                          |
| El motor  | La web sigue en pie; el chat dice que no hay conexión y ofrece reintentar                 |

Los encargos y las preguntas de horario, precio y alérgenos no dependen ni de Ollama ni de Qdrant. La integración continua lo aprovecha: corre 31 de las 32 conversaciones sin modelo.

## La web

Angular sin Zone.js. Una sola ruta que carga la página de la pastelería en un fragmento aparte.

```
Shell (router-outlet)
└─ PasteleriaSite                la página, carga el perfil del negocio
   └─ BizFrame                   barra de demostración y botón del panel
      ├─ (contenido de la web)
      │   ├─ BizArt              ilustraciones en SVG
      │   └─ BizMenu             carta por categorías
      ├─ BizChat                 el asistente
      └─ BizStaff                el panel del local
```

`BizUi` es el estado compartido: si el chat está abierto, cuántos pendientes hay, y la petición que manda una parte de la web al asistente («Encargar: Tarta de queso»). `BizApi` es la única que habla con el servidor. Ver [Angular](./11-angular-skill.md).

## Sin tiempo real

El chat no usa WebSockets. Mientras hay una solicitud pendiente, pregunta cada 2,5 segundos si hay novedades, y el panel cada 3. Para una demo y para un negocio pequeño es más simple y no tiene conexiones que mantener. Ver [Decisiones](./09-decisions.md).
