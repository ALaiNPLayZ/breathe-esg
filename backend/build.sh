#!/usr/bin/env bash
# Render build script: installs dependencies, builds React, then runs Django setup.
set -e

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt

echo "=== Building React frontend ==="
cd ../frontend
npm ci
npm run build
# Copy build output so Django can serve it
mkdir -p ../backend/frontend_build
cp -r dist/. ../backend/frontend_build/
cd ../backend

echo "=== Django migrations ==="
python manage.py migrate --no-input

echo "=== Collecting static files ==="
python manage.py collectstatic --no-input

echo "=== Loading demo data ==="
python manage.py create_demo_data

echo "=== Build complete ==="
