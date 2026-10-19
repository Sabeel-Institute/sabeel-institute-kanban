#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

APP_REPO="Sabeel-Institute/sabeel-institute-kanban"
MANUAL_PDF="docs/USER-MANUAL.pdf"

CHECK_ONLY="${SK_CHECK:-0}"
args=()
for argument in "$@"; do
  if [ "$argument" = "--check" ]; then CHECK_ONLY=1; else args+=("$argument"); fi
done
set -- ${args[@]+"${args[@]}"}

APK="${1:-app/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk}"

[ -f "$APK" ] || { echo "APK not found: $APK — build a release first." >&2; exit 1; }
node scripts/check-version.mjs
VERSION="$(node -p "require('./app/app.json').expo.version")"

apksigner=""
for cand in "${ANDROID_HOME:-$HOME/opt/Android/Sdk}"/build-tools/*/apksigner; do
  [ -x "$cand" ] && apksigner="$cand"
done
if [ -z "$apksigner" ]; then
  echo "apksigner not found — cannot verify the signature of what is about to be published." >&2
  echo "Set ANDROID_HOME, or install build-tools." >&2
  exit 1
fi
signer_dn="$("$apksigner" verify --print-certs "$APK" | sed -n 's/^Signer #1 certificate DN: //p')"
case "$signer_dn" in
  *"CN=Android Debug"*)
    echo "REFUSING TO PUBLISH: $APK is signed with the DEBUG key ($signer_dn)." >&2
    echo "Restore the EXISTING upload keystore and app/android/keystore.properties" >&2
    echo "from the vault (never generate a new one), then rebuild. See docs/SECRETS.md." >&2
    exit 1 ;;
esac
echo "signature ok (${signer_dn})"

[ -f "$MANUAL_PDF" ] || { echo "No $MANUAL_PDF — run python3 docs/render-manual.py" >&2; exit 1; }
stale=""
for src in docs/USER-MANUAL.md docs/manual/img/*.png; do
  [ "$src" -nt "$MANUAL_PDF" ] && stale="$stale $src"
done
if [ -n "$stale" ]; then
  echo "The PDF is older than its source —$stale" >&2
  echo "Run: python3 docs/render-manual.py" >&2
  exit 1
fi

for abi in arm64-v8a armeabi-v7a universal x86_64; do
  split="$(dirname "$APK")/app-${abi}-release.apk"
  [ -f "$split" ] || { echo "missing ABI split $split — build all four (npm run build:apk)" >&2; exit 1; }
done

if [ "$CHECK_ONLY" = "1" ]; then
  echo "--check: all gates passed; nothing published."
  exit 0
fi

RELDIR="$(dirname "$APK")"
astage="$(mktemp -d)"
trap 'rm -rf "$astage"' EXIT
assets=()
for abi in arm64-v8a armeabi-v7a universal x86_64; do
  src="$RELDIR/app-${abi}-release.apk"
  [ -f "$src" ] || { echo "missing ABI split $src — build all four (npm run build:apk)" >&2; exit 1; }
  cp "$src" "$astage/sabeel-kanban-${abi}.apk"
  assets+=("$astage/sabeel-kanban-${abi}.apk")
done
assets+=("$MANUAL_PDF")
title="$(node scripts/deploy-notes.mjs "$VERSION" --title 2>/dev/null || echo "v${VERSION}")"
node scripts/deploy-notes.mjs "$VERSION" > "$astage/notes.md" 2>/dev/null || echo "Release v${VERSION}." > "$astage/notes.md"
if gh release view "v$VERSION" --repo "$APP_REPO" >/dev/null 2>&1; then
  gh release edit "v$VERSION" --repo "$APP_REPO" --title "$title" --notes-file "$astage/notes.md"
  gh release upload "v$VERSION" "${assets[@]}" --clobber --repo "$APP_REPO"
else
  gh release create "v$VERSION" "${assets[@]}" --repo "$APP_REPO" \
    --title "$title" --notes-file "$astage/notes.md" --target "$(git rev-parse HEAD)"
fi
echo "Cut $APP_REPO release v$VERSION (APKs and manual)."

echo "Published kanban v${VERSION}."
