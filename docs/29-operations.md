---
title: Operación
---

# Operación

Cómo saber si todo va bien y qué hacer cuando no.

## Comprobar el estado

```bash
curl -s http://127.0.0.1:8790/health     # el motor y Postgres
curl -s http://127.0.0.1:56333/readyz    # Qdrant
curl -s http://127.0.0.1:11434/api/tags  # Ollama y sus modelos
curl -s http://127.0.0.1:8790/biz/problems   # errores en los datos
docker compose ps                        # los contenedores
```

## Problemas frecuentes

### `GET /health` devuelve 503, o el chat da error

Postgres no responde.

```bash
docker compose ps
./scripts/up.sh          # lo levanta y aplica las tablas; es idempotente
```

Si dice que falta una tabla, es que no se ha aplicado el esquema: `npm --prefix engine run schema`.

### El puerto está ocupado

Cambia el puerto en `.env`: `POSTGRES_PORT`, `QDRANT_PORT` (y `QDRANT_URL`), `ENGINE_PORT` o `WEB_PORT`. Si cambias `ENGINE_PORT` y usas `npm start` en la web, actualiza también `web/proxy.conf.json`.

### Las respuestas son el texto de una sección, no una frase redactada

Es el plan B: el modelo no contestó o inventó una cifra. *Cómo lo ha comprobado* dice cuál de las dos, y queda en `router_decisions`.

```bash
curl -s http://127.0.0.1:11434/api/tags
ollama pull qwen3.5:9b-mlx      # si falta el modelo
```

En Linux o en un Mac Intel, usa `qwen3.5:9b` y pon `OLLAMA_CHAT_MODEL=qwen3.5:9b` en `.env`.

### La búsqueda encuentra peor, y en *Cómo lo ha comprobado* pone «búsqueda por palabras»

Qdrant o los embeddings no responden.

```bash
curl -s http://127.0.0.1:56333/readyz
ollama pull nomic-embed-text
./scripts/ingest.sh
```

### La primera pregunta tarda mucho

El modelo se estaba cargando. Se queda en memoria 10 minutos desde la última petición. Abrir el chat lo carga, pero en una máquina lenta puede no llegar a tiempo. Si el modelo pasa de 14 segundos, se usa el plan B y el motor no se queda colgado.

### He cambiado la carta y el asistente sigue con lo de antes

Los datos se recargan solos en un par de segundos, pero los vectores no: `./scripts/ingest.sh`.

Si un cambio deja de cargarse, seguramente tiene un error:

```bash
curl -s http://127.0.0.1:8790/biz/problems
```

### «Hay mucha gente probando a la vez»

Dos conversaciones están usando el motor y otra ha esperado 9 segundos. Es el límite de `routes.mjs`, para no saturar el modelo.

### «Demasiados mensajes seguidos»

El límite de 40 por minuto. Si estás detrás de un proxy y salta enseguida, falta `TRUST_PROXY=1`: todos los visitantes cuentan como una sola dirección.

### `ng serve` no llega al motor

`web/proxy.conf.json` apunta a `127.0.0.1:8790`. Si lo cambias, hay que reiniciar `ng serve`.

### Las conversaciones fallan en un horario concreto

Las conversaciones usan la fecha real. `{{pickup}}` busca un día con hueco, pero una conversación nueva que diga «para mañana» depende de qué día sea. Escribe esas expectativas para cualquier día.

## Empezar de cero

```bash
docker compose down -v      # borra Postgres y Qdrant
./scripts/up.sh
npm --prefix engine start
./scripts/ingest.sh
```

## Consultar un expediente

No hay una pantalla de administración, pero el rastro está en Postgres.

```bash
docker compose exec postgres psql -U obrador -d obrador
```

```sql
-- Los últimos expedientes
SELECT id, state, lang, pii_level, left(summary, 60) FROM cases ORDER BY created_at DESC LIMIT 10;

-- Qué pasó en uno
SELECT at, type, payload FROM events WHERE case_id = 'EXP-…' ORDER BY at;

-- Por qué se hizo cada paso
SELECT step, route, model, reason, tokens_in, tokens_out FROM router_decisions WHERE case_id = 'EXP-…' ORDER BY created_at;

-- Lo que comprobó el motor
SELECT seq, tool, ok, result->>'detalle' FROM tool_calls WHERE case_id = 'EXP-…' ORDER BY seq;
```

## Registros

El motor escribe una línea por petición en la salida estándar, con la ruta sin parámetros, el estado y lo que tardó:

```
2026-10-31T12:29:44.446Z POST /biz/pasteleria/chat 200 776ms
```

Los errores salen con su traza. `serve.mjs` hace lo mismo, y ninguno escribe el contenido de los mensajes.

## Los datos

| Dónde              | Qué                                | Si se pierde                     |
| ------------------ | ---------------------------------- | -------------------------------- |
| Volumen de Postgres | Expedientes, mensajes y su rastro | Se pierde el historial           |
| Volumen de Qdrant  | Vectores                           | `./scripts/ingest.sh` los rehace |
| `output/`          | Markdown de cierre                 | También está en `artifacts`      |
| `datasets/`        | El negocio                         | Está en el repositorio           |
