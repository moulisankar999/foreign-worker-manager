#!/bin/bash
# Deploys notify-dispatch + the mock provider to the TEST project and points the dispatcher at the mock.
# Refuses to run against the live project.
set -e
cd "$(dirname "$0")/.."
set -a; . ./.secrets.env; set +a
LIVE=gnepquxtwkyffjmoydnv
[ -n "$TEST_PROJECT_REF" ] && [ "$TEST_PROJECT_REF" != "$LIVE" ] || { echo "refusing: TEST_PROJECT_REF missing or live"; exit 1; }
T=$(mktemp -d); trap 'rm -rf $T' EXIT
mkdir -p $T/supabase/functions/mock-provider && cp tests/mock-provider/index.ts $T/supabase/functions/mock-provider/
cp -r supabase/functions/notify-dispatch supabase/functions/whatsapp-webhook supabase/functions/wa-admin supabase/functions/_shared $T/supabase/functions/
cd $T
npx supabase functions deploy mock-provider --project-ref $TEST_PROJECT_REF --use-api --no-verify-jwt >/dev/null
for f in notify-dispatch whatsapp-webhook wa-admin; do npx supabase functions deploy $f --project-ref $TEST_PROJECT_REF --use-api --no-verify-jwt >/dev/null; done
M=https://$TEST_PROJECT_REF.supabase.co/functions/v1/mock-provider
npx supabase secrets set --project-ref $TEST_PROJECT_REF \
  CRON_SECRET="$TEST_CRON_SECRET" ONEWAYSMS_MT_URL="$M/sms" ONEWAYSMS_USER=mock-user ONEWAYSMS_PASS=mock-pass ONEWAYSMS_SENDER=MOCK \
  BREVO_API_KEY=mock-brevo-key BREVO_API_URL="$M/email" EMAIL_FROM=noreply@example.com EMAIL_FROM_NAME="FWM Test" \
  WA_GRAPH_URL="$M/graph" WA_PHONE_NUMBER_ID=mock-phone WA_BUSINESS_ACCOUNT_ID=mock-waba WA_ACCESS_TOKEN=mock-wa-token \
  WA_VERIFY_TOKEN=mock-verify WA_APP_SECRET=mock-app-secret >/dev/null
echo "deployed to test project"
