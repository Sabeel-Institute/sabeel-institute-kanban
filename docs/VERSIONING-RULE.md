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
  train** (0.12.x). Nothing derives a version from anywhere else, and nothing
  else states one: `app.json` has no `android.versionCode`.
- **`versionCode`** is computed in `app/android/app/build.gradle` as
  `major*1000000 + minor*1000 + patch` (0.12.2 is 12002), the scheme every
  Sabeel app shares (ci-tools' `lib/version.mjs`). Any future change to those
  multipliers must produce a **larger** number than the current scheme does
  for the current version, or the next release cannot install over the last.
- **`expo.ios.buildNumber`** is the same number, as a string (`"12002"`).
  `npx sabeel-ci release` writes it with the version, and each version goes to
  TestFlight once, from the iOS workflow on its tag.
- **The manual's** `*For app version X.Y.Z · <Month YYYY>*` line in
  `docs/USER-MANUAL.md` names the same version; `release` moves it and renders
  the PDF.
- **Ceilings:** minor and patch at most 999, and the code at most 2100000000,
  Play's largest (major at most 2100). Exceeding any of them fails the Gradle
  build rather than computing a colliding number.

## Where enforcement is wired

| Where | Runs when | Catches |
|---|---|---|
| `npx sabeel-ci check-version` | `npm run lint`, `web:export` (`sabeel-ci build-web`), so CI runs it | a web-only release that never touches Gradle |
| `app/android/app/build.gradle` | every native build | a build where nobody ran the check |
| `npx sabeel-ci check-app` | CI's quality job | a `versionCode` stated anywhere but Gradle's computation, an iOS build number or a manual line that disagrees with the version |
| `npx sabeel-ci build-aab`, `release` | every Play build and release | the last gate before an upload that cannot be unpublished, and a version not above main's and every released tag's |
| `npx sabeel-ci check-ios-config` | `npm run check:ios`, `build:ios` | an `ios.version` override, which would show Apple a different number |

`check-version` **self-tests on every invocation** against ten bad shapes,
including `2026.07.01`. That case exists because the obvious
`^\d+\.\d+\.\d+$` accepts a date — a hole the time-tracker maintainer found
in code that had already shipped here.

## Sibling projects

The LMS and Time Tracker use the same version shape, versionCode formula and
iOS build number, through the same ci-tools commands. A change to the shared
release conventions lands in ci-tools, for all three.
