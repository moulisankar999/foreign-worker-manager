#!/bin/bash
# Copies the app's alert rules into the Edge Function so phone alerts use the exact same logic as the app.
set -e
cd "$(dirname "$0")/.."
D=supabase/functions/daily-alerts/lib
mkdir -p $D
for f in calc types util; do
  sed -E "s#from '\./(calc|types|util)'#from './\1.ts'#g" src/lib/$f.ts > $D/$f.ts
done
# server runs in UTC: compute "today" in Malaysia time (UTC+8)
python3 - "$D/util.ts" <<'PY'
import sys; p=sys.argv[1]; s=open(p).read()
s=s.replace("export function todayISO() {\n  const d = new Date()\n","export function todayISO() {\n  const d = new Date(Date.now() + 8 * 3600 * 1000) // Malaysia time (server clock is UTC)\n")
assert 'Malaysia time' in s
open(p,'w').write("// AUTO-COPIED from src/lib by scripts/prepare-function.sh — edit the original, not this file\n"+s)
PY
for f in calc types; do sed -i '1i // AUTO-COPIED from src/lib by scripts/prepare-function.sh — edit the original, not this file' $D/$f.ts; done
echo "prepared $D"
