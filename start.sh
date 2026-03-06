#!/usr/bin/env bash
set -euo pipefail

exec python -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-8122}" --app-dir backend
