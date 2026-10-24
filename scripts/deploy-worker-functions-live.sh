#!/bin/bash
# Deploys the FW Worker edge functions (worker-auth, worker-access) to the LIVE project and sets WORKER_PIN_PEPPER.
# The pepper is generated once (never printed) and kept in .secrets.env as WORKER_PIN_PEPPER — losing it invalidates every worker PIN.
# Needs SUPABASE_ACCESS_TOKEN in the environment. Run only after migration 030 is applied on live.
set -euo pipefail
cd "$(dirname "$0")/.."
LIVE=gnepquxtwkyffjmoydnv
set -a; . ./.secrets.env; set +a
[ "${SUPABASE_PROJECT_REF:-}" = "$LIVE" ] || { echo "SUPABASE_PROJECT_REF is not the live project"; exit 1; }
if [ -z "${WORKER_PIN_PEPPER:-}" ]; then
  P=$(openssl rand -hex 32)
  printf '\n# FW Worker PIN pepper (LIVE). KEEP SAFE: changing/losing it invalidates every worker PIN.\nWORKER_PIN_PEPPER=%s\n' "$P" >> .secrets.env
  WORKER_PIN_PEPPER=$P; unset P
  echo "generated a new WORKER_PIN_PEPPER and saved it in .secrets.env"
fi
[ ${#WORKER_PIN_PEPPER} -ge 32 ] || { echo "WORKER_PIN_PEPPER too short"; exit 1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/supabase/functions"
cp -r supabase/functions/worker-auth supabase/functions/worker-access "$T/supabase/functions/"
# secrets first, so the functions never run without the pepper
(cd "$T" && npx --yes supabase secrets set --project-ref "$LIVE" WORKER_PIN_PEPPER="$WORKER_PIN_PEPPER" >/dev/null)
for f in worker-auth worker-access; do (cd "$T" && npx --yes supabase functions deploy $f --project-ref "$LIVE" --use-api --no-verify-jwt >/dev/null); echo "deployed $f"; done
echo "worker functions live"
