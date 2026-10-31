---
title: Testing · CI
---

# Testing · CI

GitHub Actions corre en cada push a `main` y en cada pull request. El workflow es `.github/workflows/ci.yml` y tiene dos trabajos que no dependen entre sí.

## `engine`

Levanta un Postgres 16 como servicio en el mismo puerto que usa en local (55432), con los valores por defecto de `.env.example`, así que no hacen falta secretos.

| Paso                                   | Qué para                                                     |
| -------------------------------------- | ------------------------------------------------------------ |
| `npm ci`                               | Un lockfile desfasado                                        |
| `npm test`                             | Una regla rota, o datos del negocio inválidos                |
| `npm run schema`                       | Un error en `db/schema.sql`                                  |
| `npm run test:integration`             | Un fallo en el recorrido, en el aislamiento o en la privacidad |
| Conversaciones, sin modelo ni Qdrant   | Un fallo por HTTP, o algo que dependa del modelo sin deber    |

El último paso arranca el motor con Ollama y Qdrant apuntando a un puerto cerrado y pasa 31 de las 32 conversaciones. Que pasen sin modelo es parte de lo que se prueba: los encargos no pueden depender de la pieza que más puede fallar.

## `web`

| Paso            | Qué para                                                          |
| --------------- | ----------------------------------------------------------------- |
| `npm ci`        | Un lockfile desfasado                                             |
| `npm test`      | Una ruta que se abre de más en `serve.mjs`                        |
| `npm run build` | Un error de TypeScript o de plantilla, o superar el presupuesto de 1 MB |
| Sin scripts en línea | Un `<script>` en `index.html`, que la política de seguridad bloquearía |

## Lo que se queda fuera

- La respuesta del modelo: necesitaría un modelo de varios GB en cada ejecución. La conversación que lo necesita se pasa a mano con `./scripts/eval.sh`.
- Los recorridos en el navegador, que se comprueban a mano.

## El otro workflow

`.github/workflows/portfolio-docs.yml` no prueba nada. Cuando cambia `docs/` en `main`, avisa al portafolio para que se reconstruya, porque lee esta documentación al compilar. Si no está configurado el secreto `PORTFOLIO_BUILD_HOOK`, deja un aviso y termina bien.
