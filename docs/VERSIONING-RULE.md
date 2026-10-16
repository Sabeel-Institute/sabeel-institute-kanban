# Versioning — project specifics

**The general rule lives in the `expo-firebase-stack` skill**
(`faisal-shah/agent-skills` on GitHub, cloned at `../agent-skills/`; public), under *"The version number is a store contract, and Android hides that
from you"*. Read that first. It covers Apple's format constraints (TN2420), the
`versionCode` field-width collision, the leading-zero hole, and why enforcement
belongs in three places.

This file holds no copy of that rule, for the same reason
`docs/STACK-GOTCHAS.md` is a stub: the rule is true for anyone on this stack and
nothing in it names this project, so a second copy only drifts — and two
documents disagreeing about the same rule is worse than one of them not
existing.

Everything below is what is true *here* and nowhere else.

## This project

- **Source of truth:** `app/app.json` → `expo.version`. Currently on the **0.x
  train** (0.11.x). Nothing derives a version from anywhere else.
- **`expo.ios.buildNumber`** is iOS-only and rises on every upload, even within
  one version (`docs/IOS-BUILD.md` § Releasing).
- **`versionCode`** is computed in `app/android/app/build.gradle` as
  `major*1000000 + minor*1000 + patch`. It was `10000/100` until 2026-07-26,
  which would have collided at 0.1.100 — see the deploy log for v0.1.33. Any
  future change to those multipliers must produce a **larger** number than the
  current scheme does for the current version, or the next release cannot install
  over the last.
- **Ceilings:** minor and patch max 999, major max 2147. Exceeding any of them
  fails the Gradle build rather than computing a colliding number.

## Where enforcement is wired

| Where | Runs when | Catches |
|---|---|---|
| `scripts/check-version.mjs` | `web:export`, so CI runs it | a web-only release that never touches Gradle |
| `app/android/app/build.gradle` | every native build | a build where nobody ran the script |
| `scripts/build-aab.sh` | every Play build | the last gate before an upload that cannot be unpublished |
| `scripts/check-ios-config.mjs` | `npm run check:ios` | an `ios.version` override, which would show Apple a different number |

`check-version.mjs` **self-tests on every invocation** against seven bad shapes,
including `2026.07.01`. That case exists because the obvious
`^\d+\.\d+\.\d+$` accepts a date — a hole the time-tracker maintainer found in
an earlier draft of this document, in code that had already shipped here.

## Sibling projects

The time-tracker is aligned: same shape check, same `versionCode` formula, same
pinned `TZ=America/Chicago` timestamp and wording on its download page. Confirmed
against their `49c447f`. If you change any of the three here, tell them — the two
download pages sit on one site and are read side by side.
