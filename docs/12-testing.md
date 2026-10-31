---
title: Testing · visión
---

# Testing · visión

Obrador Mel tiene **175 tests y 32 conversaciones de extremo a extremo**, todos con `node --test`, sin librerías de testing. La suite unitaria tarda menos de medio segundo y no necesita nada levantado.

| Capa                                       | Ficheros | Pruebas | Qué cubre                                                                      |
| ------------------------------------------ | -------- | ------- | ------------------------------------------------------------------------------ |
| [Unitarios](./13-testing-unit.md)          | 12       | 139     | Lectura de mensajes, cálculo, un turno completo, validación de datos y rutas   |
| [Integración](./14-testing-integration.md) | 2        | 36      | El recorrido entero contra Postgres, y el servidor web como proceso real       |
| [Conversaciones](./15-testing-e2e.md)      | 1        | 32      | Conversaciones por HTTP contra el motor en marcha                              |
| [CI](./16-testing-ci.md)                   | —        | —       | Todo lo anterior en cada push, menos la conversación que necesita el modelo    |

## Comandos

```bash
npm --prefix engine test                     # unitarios: nada levantado
npm --prefix engine run test:integration     # necesita Postgres
npm --prefix web test                        # el servidor de producción
./scripts/eval.sh                            # necesita el motor en marcha
```

## Convenciones

- **El nombre del test es una frase del comportamiento**, escrita como lo diría el negocio: «un encargo solo se cierra cuando una persona lo confirma», «lo que no se sabe pasa a una persona en vez de inventarse».
- **El reloj se fija.** `turn`, `chatTurn` y `staffAct` reciben `now`, así que los tests no dependen del día en que corren. La mayoría usa el jueves 15 de octubre de 2026.
- **Sin mocks del dominio.** Los tests usan los datos reales del obrador, y la integración, un Postgres real.
- **Lo externo se sustituye en el borde.** El modelo se inyecta: `turn` recibe `kbAnswer` y `answerFromKb` recibe `complete`. Nada simula la base de datos.
- **Sin modelo a propósito.** La integración apunta Ollama y Qdrant a un puerto cerrado. Si el motor dependiera de ellos para algo importante, fallaría.
- **Negocios de prueba solo para lo que el obrador no usa.** Las reservas se prueban con un restaurante y una peluquería inventados en `engine/test/fixtures/`.
- **Un error, un test.** Cada error de los que aparecen en [Retos y resultados](./10-challenges-results.md) tiene el suyo.

## Qué no está cubierto

- La interfaz no tiene tests automáticos: componentes y plantillas se comprueban con el build de producción, que verifica los tipos de las plantillas, y a mano en el navegador.
- La calidad de lo que escribe el modelo no se puede fijar en un test. Las conversaciones comprueban que la respuesta contenga lo esperado, y las pruebas unitarias, que las barreras funcionan con un modelo simulado.
