---
title: Puesta en marcha y despliegue
---

# Puesta en marcha y despliegue

## Requisitos

| Herramienta      | Para                                                       | Obligatorio |
| ---------------- | ---------------------------------------------------------- | ----------- |
| Node 24          | El motor y la web                                          | Sí          |
| Docker           | Postgres y Qdrant                                          | Sí          |
| Ollama           | El modelo y los embeddings                                 | No: sin él, la búsqueda va por palabras |

## Arrancar

```bash
git clone https://github.com/Criscode2022/obrador-mel.git
cd obrador-mel

./scripts/up.sh                # Postgres, Qdrant, dependencias del motor y tablas
npm --prefix engine start      # el motor, en :8790
```

En otra terminal:

```bash
npm --prefix web ci
npm --prefix web start         # la web, en http://127.0.0.1:4210
```

Con eso ya funciona todo menos las respuestas del modelo. Para tenerlas:

```bash
ollama pull qwen3.5:9b-mlx     # en Linux o Intel: qwen3.5:9b, y cámbialo en .env
ollama pull nomic-embed-text
./scripts/ingest.sh            # embebe el conocimiento; solo hace falta una vez
```

La ingesta también se hace sola en la primera pregunta que la necesita, pero esa primera pregunta tarda más.

## Comprobar que funciona

```bash
curl -s http://127.0.0.1:8790/health
# {"ok":true,"db":true,"service":"obrador-mel-engine"}

./scripts/eval.sh              # 32 conversaciones de extremo a extremo
```

## Variables

Todas tienen un valor por defecto y están en `.env.example`. `scripts/up.sh` crea `.env` a partir de él si no existe. Las variables del entorno del proceso ganan a las de `.env`.

| Variable             | Por defecto                | Para                                            |
| -------------------- | -------------------------- | ----------------------------------------------- |
| `POSTGRES_HOST`      | `127.0.0.1`                | Servidor de Postgres                            |
| `POSTGRES_PORT`      | `55432`                    | Puerto de Postgres                              |
| `POSTGRES_USER`      | `obrador`                  | Usuario                                         |
| `POSTGRES_PASSWORD`  | `obrador`                  | Contraseña. Cámbiala fuera de tu máquina        |
| `POSTGRES_DB`        | `obrador`                  | Base de datos                                   |
| `QDRANT_PORT`        | `56333`                    | Puerto que publica Docker                       |
| `QDRANT_URL`         | `http://127.0.0.1:56333`   | Dónde busca el motor                            |
| `OLLAMA_BASE_URL`    | `http://127.0.0.1:11434`   | Dónde está Ollama                               |
| `OLLAMA_CHAT_MODEL`  | `qwen3.5:9b-mlx`           | Modelo de las respuestas                        |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text`         | Modelo de los embeddings                        |
| `ENGINE_PORT`        | `8790`                     | Puerto del motor                                |
| `ENGINE_HOST`        | `127.0.0.1`                | Dirección en la que escucha el motor            |
| `OUTPUT_DIR`         | `output/`                  | Carpeta del markdown de cierre                  |
| `WEB_PORT`           | `4310`                     | Puerto de `serve.mjs`                           |
| `WEB_DIST`           | `web/dist/…/browser`       | Carpeta de estáticos de `serve.mjs`             |
| `TRUST_PROXY`        | `0`                        | `1` si hay un proxy de confianza delante        |

## Producción

Este repositorio no tiene un despliegue publicado: la demo se ejecuta en local. Lo que sigue es cómo se pondría en marcha en una máquina propia, y es lo que hace falta porque el modelo corre en esa misma máquina.

```bash
./scripts/up.sh
npm --prefix web ci && npm --prefix web run build

npm --prefix engine start      # el motor, solo en 127.0.0.1
npm --prefix web run serve     # la web y la API cerrada, en 127.0.0.1:4310
```

Falta lo que publique `127.0.0.1:4310` a Internet con HTTPS: un proxy inverso o un túnel. `serve.mjs` no habla HTTPS ni escucha fuera de esa dirección a propósito.

Antes de abrirlo:

- Pon `TRUST_PROXY=1`. Sin eso, todo el tráfico que llega por el proxy cuenta como una sola dirección y el límite de 40 mensajes por minuto salta enseguida. Sin proxy, déjalo en `0`, porque un cliente podría inventarse la cabecera `X-Forwarded-For`.
- Cambia `POSTGRES_PASSWORD`.
- Ten en cuenta que los mensajes de los visitantes se guardan. Tarjetas y DNI se tapan antes, pero el resto no se purga.
- Si el proxy corta las peticiones largas, deja margen: una respuesta con el modelo en frío tarda varios segundos.

## Memoria

`qwen3.5:9b-mlx` ocupa 8,9 GB en disco y unos 12 GB cargado; `nomic-embed-text`, unos 300 MB. En una máquina justa se puede usar un modelo más pequeño con `OLLAMA_CHAT_MODEL=llama3.2:3b` (2 GB en disco), a cambio de peor castellano.

Los modelos se quedan cargados 10 minutos desde la última petición. Cuando alguien abre el chat, la web pide cargarlos (`POST /api/warm`) para que la primera pregunta no pague el arranque en frío.

## Parar y limpiar

```bash
docker compose down            # para Postgres y Qdrant, conserva los datos
docker compose down -v         # además borra los datos
```

Ver [Operación](./29-operations.md) para los problemas más comunes.
