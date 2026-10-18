#!/usr/bin/env bash
set -euo pipefail
CONVERTER_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CONVERTER_REPO_DIR"
if [[ -z "${CONVERTER_SECRET:-}" ]]; then
  echo 'Set CONVERTER_SECRET before starting the private converter.' >&2
  exit 1
fi
if [[ ! -x converter/.venv/bin/python ]]; then
  echo 'Run bash scripts/converter-setup.sh first.' >&2
  exit 1
fi
export CONVERTER_MODEL_DIR="${CONVERTER_MODEL_DIR:-$CONVERTER_REPO_DIR/.sites-runtime/docling-models}"
converter/.venv/bin/python -m converter.models --verify
export OCR_LANGUAGES="${OCR_LANGUAGES:-eng}"
exec converter/.venv/bin/python -m uvicorn converter.app:app --host 127.0.0.1 --port 8001 --workers 1 --no-server-header
