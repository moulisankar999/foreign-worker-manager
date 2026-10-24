#!/bin/bash
# Builds the signed FW Worker Android release APK + AAB into release/.
# Same needs as scripts/build-android.sh (JDK 21, Android SDK, .secrets.env with FWM_KEYSTORE* values — never committed).
# Usage: npm run worker:android:apk   (builds the worker app for native, syncs Capacitor, then runs this)
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-$HOME/opt/jdk21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/opt/android-sdk}"
set -a; . ./.secrets.env; set +a
[ -f "$FWM_KEYSTORE" ] || { echo "Keystore not found (see README → Android)"; exit 1; }
VERSION=$(node -p "require('./worker/package.json').version")
(cd worker/android && ./gradlew --no-daemon -q assembleRelease bundleRelease)
mkdir -p release
cp worker/android/app/build/outputs/apk/release/app-release.apk release/FW-Worker.apk
cp worker/android/app/build/outputs/bundle/release/app-release.aab "release/FW-Worker-$VERSION.aab"
ls -lh release/
