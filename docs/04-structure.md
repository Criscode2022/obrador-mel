---
title: Estructura del proyecto
---

# Estructura

Un repositorio con dos paquetes independientes, `engine/` y `web/`, sin herramientas de monorepo. Cada uno tiene su `package.json`, su lockfile y sus pruebas.

```
obrador-mel/
├─ engine/              el motor de conversación
│  ├─ server.mjs        servidor HTTP
│  ├─ config.mjs        raíz del repo y variables de .env
│  ├─ db.mjs            conexión a Postgres e identificadores
│  ├─ apply-schema.mjs  crea las tablas
│  ├─ llm.mjs           cliente de Ollama
│  ├─ pii.mjs           datos personales: tapar y clasificar
│  ├─ when.mjs          días en texto libre y fechas en hora de Madrid
│  ├─ calendar.mjs      doble del calendario
│  ├─ biz/              el asistente
│  └─ test/             integración contra Postgres y negocios de prueba
├─ web/                 la web en Angular
│  ├─ serve.mjs         servidor de producción
│  ├─ public/           favicon
│  └─ src/app/negocios/ el asistente, el panel y la página
├─ datasets/pasteleria/ el negocio: perfil, carta y conocimiento
├─ prompts/negocio.md   instrucciones del modelo
├─ db/schema.sql        tablas
├─ evals/               conversaciones de extremo a extremo
├─ scripts/             arrancar, ingerir y pasar las conversaciones
├─ compose.yaml         Postgres y Qdrant
└─ docs/                esta documentación
```

## El motor (`engine/biz/`)

| Fichero        | Líneas | Responsabilidad                                                              |
| -------------- | ------ | ---------------------------------------------------------------------------- |
| `store.mjs`    | 353    | Cargar y validar `datasets/`; el perfil público                               |
| `text.mjs`     | 61     | Normalizar, números escritos, parecido entre palabras, generador con semilla  |
| `dates.mjs`    | 190    | Día y hora de un mensaje, con el horario del negocio                          |
| `orders.mjs`   | 410    | Del texto a líneas de pedido; carrito, precio y alérgenos                     |
| `nlu.mjs`      | 334    | Idioma, intención, temas, dietas, datos de contacto, rechazos                 |
| `avail.mjs`    | 326    | Horario, ocupación de fondo, huecos de recogida, mesas y citas, agenda        |
| `format.mjs`   | 58     | Importes, fechas y horario en cada idioma                                     |
| `info.mjs`     | 413    | Respuestas calculadas: horario, precios, carta, alérgenos                     |
| `ctx.mjs`      | 81     | El contexto de un turno y las señales vacías                                  |
| `ordering.mjs` | 466    | El flujo de un pedido                                                         |
| `booking.mjs`  | 491    | El flujo de una reserva de mesa o una cita                                    |
| `dialog.mjs`   | 488    | Un turno: enruta, y atiende rechazos, avisos e información                    |
| `kb.mjs`       | 345    | Trozos, ingesta, búsqueda híbrida y respuesta con el modelo                   |
| `flow.mjs`     | 476    | La conversación como expediente: modos, persistencia, estados                 |
| `persist.mjs`  | 88     | Escribir estados, eventos, decisiones, mensajes y fuentes                     |
| `staff.mjs`    | 333    | El panel: leer, confirmar, rechazar, proponer hora, cerrar                    |
| `routes.mjs`   | 140    | Las rutas `/biz/...`, con límites                                             |

Las pruebas unitarias viven junto a cada módulo como `*.test.mjs`. Las de integración, en `engine/test/`.

## La web (`web/src/app/`)

| Fichero                   | Responsabilidad                                                     |
| ------------------------- | ------------------------------------------------------------------- |
| `app.config.ts`           | Zoneless, `HttpClient` y el router con desplazamiento a las anclas   |
| `app.routes.ts`           | Una ruta, cargada aparte                                            |
| `shell.ts`                | Raíz: solo el `router-outlet`                                       |
| `icon.ts`                 | Iconos de trazo propios, un `path` por nombre                       |
| `negocios/biz-types.ts`   | Los contratos con el motor                                          |
| `negocios/biz-api.ts`     | Las llamadas al servidor y la sesión del navegador                  |
| `negocios/biz-format.ts`  | Importes, fechas, horario y cómo se cuenta cada estado              |
| `negocios/biz-ui.ts`      | Estado compartido entre la página, el chat y el panel               |
| `negocios/site-base.ts`   | Lo común a una web de negocio: cargar el perfil                     |
| `negocios/frame.ts`       | Barra de demostración, asistente y panel                            |
| `negocios/chat.*`         | El asistente                                                        |
| `negocios/staff.*`        | El panel del local                                                  |
| `negocios/menu.*`         | La carta por categorías                                             |
| `negocios/art.ts`         | Ilustraciones en SVG                                                |
| `negocios/sites/pasteleria.*` | La página de la pastelería: diseño, copy y datos                |

La separación entre `negocios/` y `negocios/sites/` no es casual: todo lo de fuera de `sites/` sirve para cualquier negocio, y se tiñe con las variables CSS que fija cada web. Ver [Diseño](./27-design.md).

## Datos (`datasets/pasteleria/`)

| Fichero          | Contenido                                                      |
| ---------------- | -------------------------------------------------------------- |
| `business.json`  | Identidad, horario, reglas del pedido, tono y textos del asistente |
| `catalog.json`   | Categorías, opciones, ambigüedades y los 19 productos          |
| `kb/*.md`        | Conocimiento: cada `## sección` es un trozo citable            |

Ver [Datos del negocio](./26-business-data.md).

## Puertos

Todos escuchan solo en `127.0.0.1` y están elegidos para no chocar con un Postgres o un Qdrant ya instalados.

| Servicio           | Puerto |
| ------------------ | ------ |
| Web en desarrollo  | 4210   |
| Web en producción  | 4310   |
| Motor              | 8790   |
| Postgres           | 55432  |
| Qdrant             | 56333  |
| Ollama             | 11434  |

## Scripts

| Comando                      | Qué hace                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| `./scripts/up.sh`            | Levanta Postgres y Qdrant, instala el motor y crea las tablas  |
| `./scripts/ingest.sh`        | Embebe el conocimiento en Qdrant                               |
| `./scripts/eval.sh [filtro]` | Pasa las conversaciones de extremo a extremo                   |
| `npm --prefix engine start`  | Arranca el motor                                               |
| `npm --prefix engine test`   | Tests unitarios                                                |
| `npm --prefix web start`     | Web en desarrollo, con proxy hacia el motor                    |
| `npm --prefix web run build` | Build de producción                                            |
| `npm --prefix web run serve` | Sirve el build                                                 |

Todos los scripts son idempotentes y usan `set -euo pipefail`.
