#!/usr/bin/env bash
# Publish the built Android APK for public download.
#
# The APK is a GitHub RELEASE ASSET on the public pages repo — NEVER committed to
# git. Committing binaries per release is what bloated the pages history and had
# to be rewritten out (see CLAUDE.md "Publishing the APK"). This script is the
# only supported way to publish, and it ends with a guardrail that FAILS if a
# binary ever lands in the pages history again.
#
# The asset lives on a fixed rolling tag (kanban-latest) and is replaced each
# build, so the download URL on the site never changes — only the version label
# on the page does.
#
#   scripts/publish-apk.sh [path/to/arm64-release.apk]
#   scripts/publish-apk.sh --check      # run every gate, publish nothing
#
# ALWAYS use --check to test the script itself. Without it the first thing that
# happens after the gates pass is an upload to the PUBLIC rolling download.
#
# It ALSO cuts the versioned GitHub Release on the app's OWN repo (all four ABI
# splits + notes from the deploy log) — the changelog/archive convention that
# lapsed after v0.1.10. A Release ASSET is not a git blob, so this does not bloat
# history the way a committed binary did; the guardrail above is about git blobs.
set -euo pipefail
cd "$(dirname "$0")/.."

# The developer's pre-release route, for one job Play cannot do.
#
# Android ships to the team through Google Play internal testing. But the
# developer needs to test a release build BEFORE the testers receive it, and
# from a phone, away from this machine. Play offers exactly one feature for
# that — internal app sharing — and it refuses this app: it requires the app to
# have been PUBLISHED, and internal-testing releases do not count. The app is
# still a Draft. See docs/DEPLOY.md.
#
# So this channel is the developer's pre-release route, not a second channel for
# the team. Play remains where testers get builds.
#
# WHY PUBLISHING HERE IS SAFE: the team installs from Play, so the only person
# holding a sideloaded build is the developer, who knows to uninstall first —
# Android refuses an install whose signature does not match, with only "App not
# installed" to explain it.
#
# THE SIGNATURE RULE STILL APPLIES, and always will: an APK from here is signed
# with the UPLOAD key, while a Play install is signed with GOOGLE'S app signing
# key. They cannot replace one another in either direction. Uninstall first.
# Nothing is lost — all state is in Firestore.

REPO="faisal-shah/faisal-shah.github.io"
APP_REPO="faisal-shah/sabeel-institute-kanban"
TAG="kanban-latest"
ASSET="sabeel-kanban-arm64-v8a.apk"
MANUAL_PDF="docs/USER-MANUAL.pdf"
MANUAL_ASSET="USER-MANUAL.pdf"
# Pull --check out of the arguments FIRST, so it is never mistaken for the APK
# path. Order matters: the APK default is assigned from $1 below.
CHECK_ONLY="${SK_CHECK:-0}"
args=()
for a in "$@"; do
  if [ "$a" = "--check" ]; then CHECK_ONLY=1; else args+=("$a"); fi
done
set -- ${args[@]+"${args[@]}"}

APK="${1:-app/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk}"
PAGES_DIR="${SK_PAGES_DIR:-../faisal-shah.github.io}"

[ -f "$APK" ] || { echo "APK not found: $APK — build a release first." >&2; exit 1; }
# Refuse to publish a version that would be illegal on a store. This is the last
# gate before a tag and a public download exist, and both are awkward to retract.
node scripts/check-version.mjs
VERSION="$(node -p "require('./app/app.json').expo.version")"

# Refuse to publish a DEBUG-SIGNED build.
#
# `release { signingConfig signingConfigs.debug }` was the scaffold default and
# it survived into production: every build up to v0.7.4 went out signed with the
# debug keystore that is committed to this PUBLIC repo, so anyone holding a
# clone could sign an update Android would accept as this app. Nothing caught it
# because a debug-signed APK installs and runs exactly like a real one — the
# signature is the only difference, and nobody looks at it.
#
# Checked here rather than in Gradle because this is the last point before a
# public download exists.
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

# The rolling tag must carry EXACTLY the assets it advertises, and nothing else.
#
# It quietly accumulated a `sabeel-kanban-0.7.4.aab` for twelve days. An AAB is
# not installable, and its filename names a version four releases old, so the
# release page offered a reader two files and named the wrong one. A GATE rather
# than a silent cleanup: deleting somebody's artifact is a judgement, and this
# script's job is to refuse to publish beside something it does not understand.
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  strays="$(gh release view "$TAG" --repo "$REPO" --json assets \
    --jq "[.assets[].name | select(. != \"$ASSET\" and . != \"$MANUAL_ASSET\")] | join(\", \")")"
  if [ -n "$strays" ]; then
    echo "REFUSING TO PUBLISH: $TAG carries assets beyond $ASSET and $MANUAL_ASSET:" >&2
    echo "  $strays" >&2
    echo "The rolling tag is those two files, replaced each build. Remove the rest:" >&2
    for s in ${strays//,/ }; do echo "  gh release delete-asset $TAG $s --repo $REPO --yes" >&2; done
    exit 1
  fi
fi

# --check runs every gate above and stops before anything leaves this machine.
#
# It exists because there was no way to ask "would this publish?" without
# publishing: running the script to watch the signature gate work uploaded a
# newly-signed APK over the rolling asset, which existing installs cannot
# update. The gates are exactly the part worth exercising, so make exercising
# them free.
if [ "$CHECK_ONLY" = "1" ]; then
  echo "--check: all gates passed; nothing published."
  exit 0
fi

# 1) Replace the rolling asset (constant URL across builds).
tmp="$(mktemp -d)/$ASSET"; cp "$APK" "$tmp"
gh release upload "$TAG" "$tmp" --clobber --repo "$REPO"
echo "Uploaded $ASSET to $REPO ($TAG)"

# 1b) THE MANUAL SHIPS WITH THE BUILD, as a release asset for the same reason the
# APK is one. The page has always linked to a manual PDF and nothing ever
# published it, so the one people downloaded sat nineteen days and several
# releases behind the app while docs/USER-MANUAL.pdf was current in the repo.
# Invisible from either side: both files existed and neither was wrong alone.
#
# NOT copied into the pages repo, though that is where it used to live and where
# fifteen copies of it already sit — about 30 MB of that repo's history. Same
# mistake as the APKs, just slower, and the rule is the whole repo not just
# `*.apk`. An asset keeps the URL constant and the history clean.
#
# Refuse a render older than what it was rendered FROM. Publishing a stale PDF
# would replace a manual that is visibly old with one that merely looks current,
# which is worse than not publishing at all.
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
gh release upload "$TAG" "$MANUAL_PDF" --clobber --repo "$REPO"
MANUAL_MB="$(( ( $(stat -c %s "$MANUAL_PDF") + 524288 ) / 1048576 ))"
echo "Uploaded USER-MANUAL.pdf to $REPO ($TAG), ${MANUAL_MB} MB"

# 2) Bump the version label and the published time — TEXT ONLY, no binary.
#
# The time matters more than it looks: the download URL is a ROLLING asset, so
# the page and the link look identical before and after a publish. Without a
# timestamp there is no way for anyone — including us — to tell whether the file
# behind that button is the build we just cut or last month's. "Did it actually
# publish?" is otherwise unanswerable from the page.
#
# Org timezone, PINNED rather than machine-local: a build cut from a laptop in
# another timezone must not silently change what the label means. The zone is
# spelled out because a bare "26/07 19:42" is ambiguous to a reader.
#
# Format and zone match the sibling time-tracker's page exactly, so the two
# download pages on the shared site read the same way. Both are pinned; do not
# "simplify" either back to a bare `date`.
PUBLISHED="$(TZ=America/Chicago date '+%-d %B %Y, %-I:%M %p %Z')"
# Computed ONCE, above the page block, because the release notes in step 2b use
# the same three values. Two places deriving "which build is this" separately is
# how they come to disagree.
SIZE_MB="$(( ( $(stat -c %s "$APK") + 524288 ) / 1048576 ))"
# Set if the download page fails to publish. NOT fatal on the spot: substantial
# release work follows this block (labelling the rolling release, then cutting
# the app-repo release with its ABI splits), and aborting midway would leave a
# half-published version — worse than the stale page label it was guarding
# against. Reported at the end instead, with a non-zero exit so nothing treats
# a partial publish as success.
PAGE_PUSH_FAILED=0

if [ -d "$PAGES_DIR/.git" ]; then
  sed -i -E "s#(Current build: <strong>)v[0-9][^<]*#\\1v${VERSION}#" \
    "$PAGES_DIR/sabeel-kanban/index.html"
  sed -i -E "s#(<span class=\"published\">)[^<]*#\\1${PUBLISHED}#" \
    "$PAGES_DIR/sabeel-kanban/index.html"
  # Both labels must actually be present, or the page silently keeps advertising
  # an older build while the asset underneath it changes.
  grep -q "Current build: <strong>v${VERSION}</strong>" \
    "$PAGES_DIR/sabeel-kanban/index.html" \
    || { echo "FAILED to update the version label on the download page" >&2; exit 1; }
  grep -q "<span class=\"published\">${PUBLISHED}</span>" \
    "$PAGES_DIR/sabeel-kanban/index.html" \
    || { echo "FAILED to update the published time on the download page" >&2; exit 1; }
  # The SIZE on the button, which drifted silently for four releases: the page
  # advertised 31 MB while the asset had grown to 37. Nobody edits a number they
  # are not looking at, so the script owns it now.
  sed -i -E "s#(Download for Android \()[0-9]+(&nbsp;MB\))#\1${SIZE_MB}\2#" \
    "$PAGES_DIR/sabeel-kanban/index.html"
  grep -q "Download for Android (${SIZE_MB}&nbsp;MB)" \
    "$PAGES_DIR/sabeel-kanban/index.html" \
    || { echo "FAILED to update the download size on the page" >&2; exit 1; }
  echo "Page labelled v${VERSION}, ${SIZE_MB} MB, published ${PUBLISHED}"
  # PATHSPEC on every git call below. The pages repo is SHARED with the
  # time-tracker publisher, and an unscoped `git commit` sweeps up whatever that
  # script has staged — so a concurrent publish commits the other project's page
  # under this project's message, or worse, ships it half-written.
  PAGE_REL="sabeel-kanban/index.html"
  git -C "$PAGES_DIR" add -- "$PAGE_REL"
  # Separated, not `commit && push || echo`. That chain reports "(page
  # unchanged)" when the PUSH fails, which is indistinguishable from nothing
  # having changed and leaves the team downloading a stale build. The sibling
  # repo hit exactly this and documented it; no changes is fine, a failed push
  # is not.
  if git -C "$PAGES_DIR" diff --cached --quiet -- "$PAGE_REL"; then
    echo "(page already current — nothing to commit)"
  elif git -C "$PAGES_DIR" commit -q -m "Kanban page: v${VERSION} (${PUBLISHED})" -- "$PAGE_REL" \
    && git -C "$PAGES_DIR" push -q; then
    echo "Download page committed and pushed."
  else
    PAGE_PUSH_FAILED=1
    echo "WARNING: the download page did not publish — continuing so the release" >&2
    echo "         itself completes; this is reported again at the end." >&2
  fi
else
  echo "NOTE: pages repo not at $PAGES_DIR — set SK_PAGES_DIR to update the version label." >&2
fi

# 2b) The same three values onto the ROLLING RELEASE itself.
#
# The tag never moves and its creation date is therefore the date it was first
# made — July, and GitHub shows that prominently. Its body was hand-written once
# and said "Current build: v0.1.10" for four months while the asset under it was
# replaced eleven times. Nobody is meant to land there (the download page links
# straight to the asset URL) but it is public, and it read as a build from
# another era.
#
# So the script owns this text exactly as it owns the page's, from the same
# variables, and asserts the result — the page's own labels were added for this
# reason and this surface was simply missed.
notes="$(cat <<EOF
Current build: **v${VERSION}** (${SIZE_MB} MB), published ${PUBLISHED}.

This is a **rolling** release: the APK asset is replaced on every build, so the
download link on the site never changes. The tag itself does not move — the
creation date GitHub shows below is not the build date, the line above is.

Most people should install from **Google Play**, where updates arrive on their
own. This build is the developer's pre-release route, published before a release
reaches Play. An APK from here is signed with the upload key and a Play install
with Google's app signing key, so **neither can install over the other** —
uninstall first. Nothing is lost; all state is online.
EOF
)"
gh release edit "$TAG" --repo "$REPO" \
  --title "Sabeel Kanban v${VERSION} — latest Android build" \
  --notes "$notes"
gh release view "$TAG" --repo "$REPO" --json body --jq .body \
  | grep -q "v${VERSION}" \
  || { echo "FAILED to update the rolling release notes to v${VERSION}" >&2; exit 1; }
echo "Rolling release labelled v${VERSION}, ${SIZE_MB} MB"

# 3) GUARDRAIL: the pages repo must never hold a binary. Verify the RESULT, not
#    the action — this is the check that was missing when binaries piled up.
#
#    TWO checks, because the two binaries are in different states. No apk has
#    ever survived in that history (they were rewritten out), so apks can be
#    asserted against ALL of history. The manual pdf cannot: fifteen copies are
#    already in there, roughly 30 MB, and rewriting a public pages history to
#    reclaim it is more disruption than the space is worth. So the pdf is
#    asserted against the WORKING TREE — no new copy is ever added, and the ones
#    behind us stay behind us. An accepted residual, not an oversight.
if [ -d "$PAGES_DIR/.git" ]; then
  n="$(git -C "$PAGES_DIR" rev-list --all --objects | grep -c '\.apk$' || true)"
  [ "$n" -eq 0 ] || {
    echo "GUARDRAIL FAILED: $n apk blob(s) in pages history — a binary was committed." >&2
    exit 1
  }
  if git -C "$PAGES_DIR" ls-files --error-unmatch "sabeel-kanban/$MANUAL_ASSET" >/dev/null 2>&1; then
    echo "GUARDRAIL FAILED: sabeel-kanban/$MANUAL_ASSET is tracked again." >&2
    echo "The manual is a release asset now. Remove it: git -C $PAGES_DIR rm --cached sabeel-kanban/$MANUAL_ASSET" >&2
    exit 1
  fi
fi

# 4) Cut the versioned Release on the APP repo (per-version changelog + archived
#    ABI splits). Idempotent: updates in place if v$VERSION already exists.
RELDIR="$(dirname "$APK")"
astage="$(mktemp -d)"
assets=()
for abi in arm64-v8a armeabi-v7a universal x86_64; do
  src="$RELDIR/app-${abi}-release.apk"
  [ -f "$src" ] || { echo "missing ABI split $src — build all four (npm run build:apk)" >&2; exit 1; }
  cp "$src" "$astage/sabeel-kanban-${abi}.apk"
  assets+=("$astage/sabeel-kanban-${abi}.apk")
done
title="$(node scripts/deploy-notes.mjs "$VERSION" --title 2>/dev/null || echo "v${VERSION}")"
node scripts/deploy-notes.mjs "$VERSION" > "$astage/notes.md" 2>/dev/null || echo "Release v${VERSION}." > "$astage/notes.md"
if gh release view "v$VERSION" --repo "$APP_REPO" >/dev/null 2>&1; then
  gh release edit "v$VERSION" --repo "$APP_REPO" --title "$title" --notes-file "$astage/notes.md"
  gh release upload "v$VERSION" "${assets[@]}" --clobber --repo "$APP_REPO"
else
  gh release create "v$VERSION" "${assets[@]}" --repo "$APP_REPO" \
    --title "$title" --notes-file "$astage/notes.md" --target "$(git rev-parse HEAD)"
fi
echo "Cut $APP_REPO release v$VERSION (${#assets[@]} ABI splits)."

if [ "$PAGE_PUSH_FAILED" = "1" ]; then
  echo >&2
  echo "PUBLISH INCOMPLETE: release assets are up, but the download page still" >&2
  echo "advertises the previous version. Fix the pages repo and re-run, or edit" >&2
  echo "$PAGES_DIR/sabeel-kanban/index.html by hand." >&2
  exit 1
fi

echo "Published kanban v${VERSION}."
