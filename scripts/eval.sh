#!/usr/bin/env bash
# Conversaciones de extremo a extremo (evals/conversations.jsonl) contra el motor en marcha.
#   ./scripts/eval.sh          todas
#   ./scripts/eval.sh tarta    solo las que llevan «tarta» en el id
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${ENGINE_PORT:-8790}"
curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null || { echo "El motor no responde en :${PORT}: npm --prefix engine start"; exit 1; }
curl -sf -X POST "http://127.0.0.1:${PORT}/admin/ingest" >/dev/null || echo "aviso: sin Ollama o Qdrant, la búsqueda irá solo por palabras"
exec node "$ROOT/evals/run.mjs" "${1:-}"
