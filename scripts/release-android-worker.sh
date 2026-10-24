#!/bin/bash
# Builds the signed FW Worker APK and publishes it as a GitHub release WITHOUT making it the repo's "Latest" release
# (FW Manager's https://github.com/<repo>/releases/latest/download/FW-Manager.apk link depends on that).
# Two releases get the APK:
#   worker-v<version>-android   (versioned, e.g. worker-v1.0.0-android)
#   worker-android-latest       (rolling; stable link .../releases/download/worker-android-latest/FW-Worker.apk)
# Needs: gh logged in, JDK 21, Android SDK, .secrets.env with FWM_KEYSTORE* (never committed). Version: worker/package.json.
# Usage: bash scripts/release-android-worker.sh [--skip-build]
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/opt/node22/bin:$PATH"
VERSION=$(node -p "require('./worker/package.json').version")
TAG="worker-v$VERSION-android"; ROLL="worker-android-latest"
[ -n "${VITE_SUPABASE_URL:-}" ] && { echo "Refusing: VITE_SUPABASE_URL is set (release builds must use the live backend)"; exit 1; }
[ "${1:-}" = "--skip-build" ] || npm run worker:android:apk
APK=release/FW-Worker.apk
"${ANDROID_HOME:-$HOME/opt/android-sdk}"/build-tools/*/apksigner verify "$APK" >/dev/null && echo "APK signature OK"
LATEST_BEFORE=$(gh release view --json tagName -q .tagName)
NOTES="FW Worker $VERSION for Android — the worker self-service app (sign in with passport number + 6-digit PIN from HR).
Install: download FW-Worker.apk on the phone and open it (allow installing from this source)."
if gh release view "$TAG" >/dev/null 2>&1; then gh release upload "$TAG" "$APK" --clobber
else gh release create "$TAG" "$APK" --title "FW Worker $VERSION (Android)" --notes "$NOTES" --latest=false; fi
if gh release view "$ROLL" >/dev/null 2>&1; then gh release upload "$ROLL" "$APK" --clobber
  gh release edit "$ROLL" --title "FW Worker (Android) — latest: $VERSION" --latest=false
else gh release create "$ROLL" "$APK" --title "FW Worker (Android) — latest: $VERSION" --notes "Always the newest FW Worker APK. $NOTES" --latest=false; fi
LATEST_AFTER=$(gh release view --json tagName -q .tagName)
echo "Repo 'Latest' release before: $LATEST_BEFORE  after: $LATEST_AFTER"
[ "$LATEST_BEFORE" = "$LATEST_AFTER" ] || { echo "WARNING: Latest release changed — restore with: gh release edit $LATEST_BEFORE --latest"; exit 1; }
