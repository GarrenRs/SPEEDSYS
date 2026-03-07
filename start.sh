#!/usr/bin/env bash
set -euo pipefail

# Ensure SQLite parent directory exists on Render persistent disk when using DATABASE_PATH.
if [[ -n "${DATABASE_PATH:-}" ]]; then
  mkdir -p "$(dirname "$DATABASE_PATH")"
elif [[ "${DATABASE_URL:-}" == sqlite:///* ]]; then
  sqlite_path="${DATABASE_URL#sqlite:///}"
  mkdir -p "$(dirname "$sqlite_path")"
fi

# Run migrations against the runtime database before booting API.
(cd backend && alembic upgrade head)

exec python -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-8122}" --app-dir backend
