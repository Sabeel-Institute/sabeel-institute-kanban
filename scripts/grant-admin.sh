#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Convenience wrapper: point grant-admin.mjs at the local emulators.
#
#   npm run grant-admin -- you@oursabeel.com
#
# For PRODUCTION, do not use this wrapper — call the script directly with real
# credentials, so pointing at production is always a deliberate act:
#   GCLOUD_PROJECT=<real-id> node scripts/grant-admin.mjs you@oursabeel.com

if [ $# -lt 1 ]; then
  echo "usage: npm run grant-admin -- <email@oursabeel.com>" >&2
  exit 1
fi

# The emulators' project and ports, from ci-tools.json through ci-tools.
GCLOUD_PROJECT=$(node -p "require('./ci-tools.json').emulators.project")
FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx --no sabeel-ci ports firestore)
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:$(npx --no sabeel-ci ports auth)
export GCLOUD_PROJECT FIRESTORE_EMULATOR_HOST FIREBASE_AUTH_EMULATOR_HOST

exec node scripts/grant-admin.mjs "$@"
