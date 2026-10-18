#!/usr/bin/env bash
set -euo pipefail
CONVERTER_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONVERTER_PYTHON="${CONVERTER_PYTHON:-python3}"

"$CONVERTER_PYTHON" -c 'import sys; assert sys.version_info[:2] == (3, 14), "The converter requires Python 3.14; set CONVERTER_PYTHON to its executable."'
if [[ ! -x "$CONVERTER_REPO_DIR/converter/.venv/bin/python" ]]; then
  "$CONVERTER_PYTHON" -m venv "$CONVERTER_REPO_DIR/converter/.venv"
fi
"$CONVERTER_REPO_DIR/converter/.venv/bin/python" -m pip install --disable-pip-version-check --no-cache-dir -r "$CONVERTER_REPO_DIR/converter/requirements.lock"

if ! command -v tesseract >/dev/null 2>&1; then
  if [[ "${1:-}" == "--install-native" ]] && [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install tesseract
  else
    echo 'Tesseract is required. On macOS: brew install tesseract. On Debian/Ubuntu: apt-get install tesseract-ocr tesseract-ocr-eng.' >&2
    exit 1
  fi
fi
if [[ -z "${SOFFICE_PATH:-}" ]] && ! command -v soffice >/dev/null 2>&1 && ! command -v libreoffice >/dev/null 2>&1; then
  echo 'LibreOffice is required. Install it or set SOFFICE_PATH to its soffice executable.' >&2
  exit 1
fi
cd "$CONVERTER_REPO_DIR"
export CONVERTER_MODEL_DIR="${CONVERTER_MODEL_DIR:-$CONVERTER_REPO_DIR/.sites-runtime/docling-models}"
converter/.venv/bin/python -m converter.models
echo 'Converter dependencies are ready. Run bash scripts/converter-run.sh with CONVERTER_SECRET set.'
