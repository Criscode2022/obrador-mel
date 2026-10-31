---
title: Testing · conversaciones
---

# Testing · conversaciones de extremo a extremo

`evals/conversations.jsonl` guarda 32 conversaciones y `evals/run.mjs` las pasa contra el motor en marcha, por HTTP, igual que la web. Es la única prueba con el modelo y Qdrant de verdad.

```bash
./scripts/eval.sh            # todas
./scripts/eval.sh tarta      # solo las que llevan «tarta» en el id
```

```
PASS encargo-completo (623 ms)
PASS plazo-de-tarta (41 ms)
PASS conocimiento-congelar (3599 ms)
...
scored 32 pass 32 fail 0
```

## Formato

Cada línea es una conversación con sus pasos: lo que dice el cliente, un botón o una decisión del local, con lo que se espera.

```json
{"id":"encargo-completo","steps":[
  {"say":"Quiero una tarta de queso para 12 personas {{pickup}}","expect":{"reply":"30,00"}},
  {"say":"Laura"},
  {"say":"655444333"},
  {"say":"Feliz cumple Mateo"},
  {"action":{"type":"confirm"},"expect":{"request":{"kind":"order","status":"pending","total_cents":3000}}},
  {"staff":"accept","expect":{"status":"confirmed"}}
]}
```

| Expectativa   | Comprueba                                                    |
| ------------- | ------------------------------------------------------------ |
| `reply`       | Expresión regular sobre todas las respuestas del turno       |
| `card`        | Que haya una tarjeta de ese tipo                             |
| `chips_min`   | Número mínimo de botones                                     |
| `request`     | Campos de la solicitud                                       |
| `no_request`  | Que no se haya abierto nada                                  |
| `no_order`    | Que no se haya abierto un pedido                             |
| `refused`     | Que el expediente haya quedado rechazado                     |
| `status`      | Resultado de una decisión del local                          |

Además, si una conversación se confirma, el runner comprueba que el expediente quedó en `emit` y que el cliente recibió el aviso del local.

`{{pickup}}` se sustituye por un día con plazo de sobra y las 11:00 libres. Se le pregunta al propio motor, porque la ocupación depende del día en que corre la prueba.

## Qué cubren

| Grupo          | Conversaciones | Ejemplos                                                          |
| -------------- | -------------- | ----------------------------------------------------------------- |
| Encargos       | 8              | Completo, otra hora, rechazado, plazos, dos tartas, ambigüedad    |
| A una persona  | 2              | Boda, «quiero hablar con una persona»                             |
| Información    | 12             | Horario, dirección, precio, varias preguntas, alérgenos           |
| Conocimiento   | 4              | Congelar, aparcar, envíos, llevar la tarta en el coche            |
| Gallego        | 2              | Horario y pedido                                                  |
| Límites        | 4              | Tarjeta, inyección, fuera de tema, reservar sin reservas          |

## Sin modelo

Con `EVAL_NO_MODEL=1` se saltan las conversaciones marcadas con `"model": true`, y el resto pasan con Ollama y Qdrant apagados. Solo una necesita de verdad el modelo: «¿Puedo llevar una tarta en el coche una hora?», porque la mejor sección por palabras es la de aparcar, y hay que leer el contexto para contestar bien.

Esas 31 conversaciones son las que corren en la integración continua.

## La interfaz

No hay pruebas automáticas de navegador en el repositorio. Los cambios de interfaz se comprueban recorriendo un encargo completo en el navegador, de la web al panel y de vuelta al chat, en escritorio y en móvil, sin errores del navegador.
