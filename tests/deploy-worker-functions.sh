#!/bin/bash
# Deploys the FW Worker edge functions (worker-auth, worker-access) + their secrets to the TEST project only.
set -e
cd "$(dirname "$0")/.."
set -a; . ./.secrets.env; set +a
LIVE=gnepquxtwkyffjmoydnv
[ -n "$TEST_PROJECT_REF" ] && [ "$TEST_PROJECT_REF" != "$LIVE" ] || { echo "refusing: TEST_PROJECT_REF missing or live"; exit 1; }
[ ${#TEST_WORKER_PIN_PEPPER} -ge 32 ] || { echo "TEST_WORKER_PIN_PEPPER missing"; exit 1; }
T=$(mktemp -d); trap 'rm -rf $T' EXIT
mkdir -p $T/supabase/functions
cp -r supabase/functions/worker-auth supabase/functions/worker-access $T/supabase/functions/
cd $T
for f in worker-auth worker-access; do npx --yes supabase functions deploy $f --project-ref $TEST_PROJECT_REF --use-api --no-verify-jwt >/dev/null; done
# example.com keeps the other test suites' "only @example.com users" guard happy
npx --yes supabase secrets set --project-ref $TEST_PROJECT_REF WORKER_PIN_PEPPER="$TEST_WORKER_PIN_PEPPER" WORKER_EMAIL_DOMAIN=example.com >/dev/null
echo "worker functions deployed to test project"
