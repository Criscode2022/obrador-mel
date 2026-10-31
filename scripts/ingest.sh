#!/usr/bin/env bash
# Embebe el conocimiento del negocio en Qdrant. Idempotente: los trozos tienen ids estables.
set -euo pipefail
PORT="${ENGINE_PORT:-8790}"
curl -sf -X POST "http://127.0.0.1:${PORT}/admin/ingest"
echo
