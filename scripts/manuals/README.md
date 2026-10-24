# User manuals (PDF) and Help screenshots

All scripts use the TEST project only (they abort if `.secrets.env` points at live). Test data uses the `hlp-` prefix and fake people.

1. Build manager + worker against TEST and serve them on http://localhost:4190/ (worker at `/worker/`).
2. `RESEED=1 node --experimental-websocket scripts/manuals/shots.mjs` → `/workspace/manuals/shots/*.png` (annotated, phone + desktop). `ONLY=om,hrm` reruns some phases; `KEEP_DATA=1` keeps the TEST data.
3. `node scripts/manuals/build.mjs [ceo|gm|hra|hrm|om|worker]` → `/workspace/manuals/*.pdf` + `manifest.json` (needs Noto Sans + Noto Sans Tamil installed).
4. `node --experimental-websocket scripts/manuals/worker-help-check.mjs` → the FW Worker Help sheet never scrolls (all languages, 360x640 and 390x844).
5. `node --experimental-websocket scripts/manuals/upload-test.mjs` → uploads the PDFs to the private `manuals` bucket on TEST and checks who can get a signed URL.
6. `node --experimental-websocket scripts/manuals/test-env.mjs cleanup`.

At release: apply `supabase/migrations/033_help_manuals.sql` to live and upload the six PDFs to the live `manuals` bucket.
