---
title: Glosario
---

# Glosario

Los términos del proyecto. Muchos están en castellano en el código porque el dominio es en castellano.

| Término                 | En el código             | Significa                                                                   |
| ----------------------- | ------------------------ | --------------------------------------------------------------------------- |
| Expediente              | `cases`, `case_id`       | Una conversación con todo lo que pasó en ella. Es la unidad de trabajo      |
| Solicitud               | `biz_requests`, `request` | Lo que se pide: pedido, reserva, pregunta o aviso                          |
| Turno                   | `turn()`                 | Un mensaje o un botón, y lo que el asistente responde                       |
| Señales                 | `signals`                | Todo lo que `analyze` lee de un mensaje                                     |
| Estado de la conversación | `state`, `dialog`      | Qué se ha recogido y qué se está preguntando                                |
| Intención               | `primary`                | Lo que quiere el mensaje: `order`, `info`, `handoff`...                     |
| Tema                    | `topic`                  | De qué pregunta: horario, dirección, teléfono, precio, carta                |
| Capacidad               | `capabilities`           | Lo que hace un negocio: `info`, `order`, `booking`                          |
| Encargo, pedido         | `order`                  | Lo que el cliente va a recoger                                              |
| Línea                   | `lines`                  | Un producto con su cantidad y sus opciones                                  |
| Opción                  | `options`                | Una variante de un producto, como las raciones                              |
| Plazo                   | `lead_hours`             | Antelación mínima de un producto                                            |
| Hueco                   | `slot`                   | Un momento en el que se puede recoger                                       |
| Ocupación de fondo      | `backgroundLoad`         | La de otros clientes imaginarios, calculada con una semilla                 |
| Trozo                   | `chunk`                  | Una sección del conocimiento o un producto, listos para buscar              |
| Conocimiento            | `kb`                     | Lo que el negocio ha escrito en `kb/*.md`                                   |
| Fuente, cita            | `cites`, `citations`     | De dónde sale una respuesta                                                 |
| Comprobación            | `evidence`, `tool_calls` | Lo que el motor verificó por su cuenta                                      |
| Tarjeta                 | `cards`                  | Un bloque con datos en el chat: horario, carta o pedido                     |
| Botón                   | `chips`                  | Una respuesta rápida: un texto o una acción                                 |
| Local, obrador          | `staff`                  | El negocio, la persona que confirma                                         |
| Panel del local         | `BizStaff`               | Lo que ve esa persona                                                       |
| Pregunta aparte         | `aside`                  | Una pregunta mientras el pedido espera: no lo toca                          |
| Pasar a una persona     | `handoff`                | El asistente deja de contestar y avisa al local                             |
| Aprobación              | `approvals`, `approval_id` | La decisión guardada de una persona. Sin ella no hay cierre               |
| Emitir                  | `emit`                   | Cerrar el expediente y escribir su markdown                                 |
| Tapar                   | `scrub`, `redact`        | Sustituir un dato por `[TARJETA]`, `[DNI]`, `[EMAIL]` o `[TEL]`             |
| Plan B                  | `fallback`, `excerpt`    | Responder con el texto de la fuente si el modelo falla o inventa            |
| Búsqueda degradada      | `degraded`               | Solo por palabras, sin vectores                                             |
| Calentar                | `warm`                   | Cargar los modelos en memoria antes de que hagan falta                      |
| Sesión                  | `session_id`             | Identificador anónimo del navegador                                         |
