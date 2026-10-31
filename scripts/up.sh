#!/usr/bin/env bash
# Levanta Postgres y Qdrant, y crea las tablas. Idempotente: se puede lanzar las veces que haga falta.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env
docker compose --env-file .env up -d --wait
[ -d engine/node_modules ] || npm --prefix engine ci --no-audit --no-fund
npm --prefix engine run --silent schema
echo "Listo. Ahora: npm --prefix engine start  y, en otra terminal, npm --prefix web start"
