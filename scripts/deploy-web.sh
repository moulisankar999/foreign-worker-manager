#!/bin/bash
# Builds FW Manager (/) and FW Worker (/worker/) for the LIVE backend and publishes both to the gh-pages branch
# (served at https://fw.sunrisebayumas.com/ and https://fw.sunrisebayumas.com/worker/). Same publish method as README → Deploy.
# Usage: bash scripts/deploy-web.sh            (add --dry-run to build + check without publishing)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/opt/node22/bin:$PATH"
[ -n "${VITE_SUPABASE_URL:-}${VITE_SUPABASE_ANON_KEY:-}" ] && { echo "Refusing: VITE_SUPABASE_* is set (deploy must use the live backend)"; exit 1; }
rm -rf dist dist-worker
npm run build
npx vite build --config vite.worker.config.ts
mkdir -p dist/worker && cp -R dist-worker/. dist/worker/
# sanity checks
for f in dist/index.html dist/CNAME dist/sw.js dist/worker/index.html dist/worker/sw.js dist/worker/manifest.webmanifest; do [ -f "$f" ] || { echo "missing $f"; exit 1; }; done
grep -q 'gnepquxtwkyffjmoydnv' dist/worker/assets/*.js || { echo "worker bundle is not pointed at the live project"; exit 1; }
grep -q "'worker/'" dist/sw.js || { echo "manager service worker does not skip /worker/"; exit 1; }
echo "Built: manager $(node -p "require('./package.json').version"), worker $(node -p "require('./worker/package.json').version")"
[ "${1:-}" = "--dry-run" ] && { echo "dry run: not published"; exit 0; }
cd dist && touch .nojekyll && rm -rf .git && git init -q -b gh-pages && git add -A && git commit -qm "deploy: manager + worker" \
  && git push -f https://github.com/moulisankar999/foreign-worker-manager.git gh-pages
echo "Published to gh-pages."
