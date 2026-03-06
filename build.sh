#!/usr/bin/env bash
set -euo pipefail

python -m pip install --upgrade pip
pip install -r backend/requirements.txt

cd backend
alembic upgrade head
