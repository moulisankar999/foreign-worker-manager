#!/bin/bash
# Builds the signed Android release APK + AAB into release/.
# Needs: JDK 21, Android SDK (ANDROID_HOME), and .secrets.env with FWM_KEYSTORE* values (never committed).
# Usage: npm run android:apk   (builds the web app for native, syncs Capacitor, then runs this)
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-$HOME/opt/jdk21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/opt/android-sdk}"
set -a; . ./.secrets.env; set +a
[ -f "$FWM_KEYSTORE" ] || { echo "Keystore not found (see README → Android)"; exit 1; }
VERSION=$(node -p "require('./package.json').version")
(cd android && ./gradlew --no-daemon -q assembleRelease bundleRelease)
mkdir -p release
cp android/app/build/outputs/apk/release/app-release.apk release/FW-Manager.apk
cp android/app/build/outputs/bundle/release/app-release.aab "release/FW-Manager-$VERSION.aab"
ls -lh release/
