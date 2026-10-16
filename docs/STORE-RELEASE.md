# Store release: no account creation in the mobile app

**Status:** built for Kanban in v0.10.0 (2026-08-18); the other two follow once
Kanban is through App Review. § 8 is what their agents need.

**First deploy is TestFlight**, not App Review — the refusal path is seen working
in real use before anything one-way happens. No review account, no App Review
submission, no unlisted request until then.

## Who this is for

Three apps, three repos, one shape:

| App | Repo | Surfaces today | Store plan |
|---|---|---|---|
| Kanban | `sabeel-institute-kanban` | Android, iOS, web | iOS **unlisted**; Play **closed testing** |
| Timesheet | `sabeel-institute-time-tracker` | Android, web | Play **closed testing**; iOS later |
| Class recordings | `sabeel-recording-app` | Android, web | Play **production**; iOS later |

**Kanban goes first.** It is the only one with a working iOS build, so it proves
the whole route. The other two adapt this document rather than re-deriving it —
§ 8 lists exactly what differs per app.

If you are the agent for the timesheet or recordings app: read § 1 to § 3 as
requirements, § 8 for what is different about yours, and treat § 4 to § 7 as the
release checklist you will need when your turn comes.

---

## 1. The one rule everything else hangs off

> **The mobile app must never cause an account to come into existence.**

Not "must not show a signup screen". Must not *create*. Everything in this
document follows from that sentence, and one careless line of code destroys it.

### Why it is worth the refactor

Both stores require in-app account deletion **only if the app supports account
creation**:

- **Apple 5.1.1(v)** — "If your app supports account creation, you must also
  offer account deletion within the app." There is no clause about directing
  users elsewhere.
- **Google Play** — triggers if "a user can complete creating an app account
  directly in the app **or if the app directs the user to an app account
  creation flow outside of the app**."

Satisfy neither trigger and the requirement is not engaged. That saves building
a deletion flow that would have to decide what happens to organisation-owned
content when a board owner, or a student with a transcript, deletes themselves —
which is the genuinely hard part, not the button.

**The Workspace account is not the app account.** Play defines an app account as
"a unique user identity that developers provide". A staff member's
`@oursabeel.com` login is the *credential*; the app account is the Firebase Auth
uid plus the `users/{uid}` document your backend creates. Do not confuse
them —
"they already had a Google account" is not an argument that survives review.

---

## 2. The sign-in refactor

### What breaks it

```ts
// WRONG. The account exists by the end of line 1.
await signInWithCredential(auth, cred);
const me = await getDoc(doc(db, 'users', auth.currentUser.uid));
if (me.data()?.status !== 'active') await signOut(auth);
```

Signing out afterwards does not unmake the Auth record or the `users/` document
the create-trigger already wrote. This is account creation in the app.

### What works

Native Google Sign-In is **pure Google OAuth** — it yields an ID token and
touches nothing in your Firebase project. That is the window the design lives in.

```ts
const { idToken } = await GoogleSignin.signIn();   // creates nothing
const { exists } = await accountExists({ idToken });  // callable, Admin SDK
if (!exists) return showRefusal();                 // never reach Firebase Auth
await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
// from here, App.tsx routes on status exactly as it does today
```

### The `accountExists` callable

Implemented in `functions/src/accountExists.ts`. One thing the design above did
not anticipate: it verifies **Google's** ID token, not Firebase's.
`getAuth().verifyIdToken()` checks tokens *Firebase* issued, and what arrives
here comes from `accounts.google.com` because the user has not signed in to
Firebase yet — which is the entire point. It uses `google-auth-library` (now a
declared dependency, previously only transitive via `firebase-admin`) and pins
the audience to `GOOGLE_WEB_CLIENT_ID`, without which a token minted for any
other OAuth client would pass.

- Unauthenticated callable (there is no session yet, by definition).
- Verifies the Google ID token server-side. Do **not** trust an email sent by the
  client.
- Looks the user up with the Admin SDK and returns **one boolean: does an account
  exist.** Nothing about role, status or why. Never return *why* — that is an
  account-enumeration oracle, and it is the reason Firebase disabled the
  client-side check in the first place.

**It deliberately does not check status.** Existence is the whole compliance
question, because signing in to an account that already exists creates nothing.
Everything else is already handled:

| State | Mobile behaviour | Why it is safe |
|---|---|---|
| No account | Refuse; never call `signInWithCredential` | The one case that would create |
| Pending | Sign in, show the waiting-for-approval screen | Account exists; the screen already updates live on approval |
| Disabled | Sign in, show the account-disabled screen | Account exists; disabling sets a claim and revokes tokens, it does not set Firebase's own `disabled` flag, so sign-in still succeeds and `App.tsx` routes on the claim |
| Active | Sign in normally | — |

So the status routing in `App.tsx` is untouched. **The entire change is one
existence gate in front of `signInWithCredential`**, which is worth saying plainly
because it is far smaller than the compliance argument behind it.

**You cannot do this on the client.** `fetchSignInMethodsForEmail` returns an
empty array for every project created after 15 September 2023 — email enumeration
protection is on by default and the method is deprecated on all platforms.
Firebase's documented replacement is exactly this: Admin SDK behind a callable.

### No server-side backstop

Considered and rejected (2026-08-18). Nothing in this design detects which
platform a request came from, and nothing needs to: the mobile app simply never
calls the code path that creates an account.

A `beforeCreate` blocking function was the alternative, but the web app keeps
self-service sign-in, so it could not reject everything — it would have to tell
web from mobile, and `EventContext` has no client identifier. If the exemption is
ever challenged, the answer is admin pre-provisioning, not detection.

### The refusal copy, which matters more than it looks

The honest instruction — *"sign in on the website first"* — is the exact sentence
Google's second clause forbids. So the app must not say it:

> **This account isn't set up for the app yet.**
> Contact your administrator.

No URL, no product name, no "web". The real instruction goes in the onboarding
email, out of band, where it does not count. Accept one support question per new
person; it is the price of the exemption.

Put a comment in the sign-in code saying why there is no "Sign up" link, or
somebody adds a helpful one in two years and never connects it to a policy
declaration made today.

---

## 3. What moves, and what does not

**Moves to the web app:** creating an account. That is all.

Because sign-in on web stays self-service (staff sign in with Google and land
pending; an admin approves), nothing new has to be built there — the existing
flow already is the creation flow. The change is entirely on the mobile side.

**Stays in the mobile app:** role changes, disable and re-enable, membership,
and every other admin action. None of them creates an identity, and an admin
should still be able to cut off a departing colleague from a phone. Do not strip
features you are allowed to keep.

---

## 4. What each web app must provide

All three routes must be **served as static pages by Firebase Hosting, outside
the authenticated SPA**, and must return content to an anonymous fetch. Store
crawlers and reviewers do not sign in, and a client-side route behind auth looks
empty to them.

### 4.1 `/privacy` — the privacy policy

Required by Apple in App Store Connect metadata **and inside the app** (5.1.1(i)),
and by Play in the store listing. It must:

- identify what data is collected, how, and every use of it;
- name every third party with access — Google (sign-in), Firebase/Google Cloud
  (hosting, database, storage), Sentry (crash reports) — and confirm they give
  equal protection;
- state retention, and **describe how a user requests deletion**.

That last clause is not optional and is not removed by the exemption. The
exemption removes the *button*, not the *route*.

### 4.2 Deletion by email

No automated delete is required. The policy names an address and states the
process and the timeframe. Retention is legitimate and should be stated plainly
rather than hidden: organisation-owned records — cards, timesheets, academic
records — are retained as institutional records; the account, its credentials and
personal data are removed.

Address: **`privacy@oursabeel.com`** (decided 2026-08-18), one address across all
three apps. It does not exist yet — create it as a Workspace group with two
admins on it, so the policy does not go stale when one person changes role.

### 4.3 `/get-app` — the download page

A durable page linking the Android and iOS builds. Placeholders are fine for now;
the page must exist and be linked from somewhere permanent in the signed-in web
UI so people can find it without being sent a link each time.

This direction — web pointing at the app — is unrestricted. Only app-pointing-at-
web-signup is the problem.

### 4.4 `/support` — support page

App Store Connect requires a support URL. It can be minimal: what the app is, who
it is for, and the same contact address.

---

## 5. What each mobile app must add

- **A privacy policy link, inside the app.** Store metadata alone does not
  satisfy 5.1.1(i). A row in settings, and on the sign-in screen where a
  not-yet-signed-in reviewer can reach it.
- **The refusal path from § 2.**
- **iOS privacy manifest.** `expo.ios.privacyManifests` in `app.json`; Expo writes
  `PrivacyInfo.xcprivacy` from it during prebuild. Expect at least
  `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`.

**One accepted residual.** The policy lives on the same domain as the web app, so
a curious user could edit the URL down to the root and find the sign-in page. The
rule governs what the *app* directs users to, and a privacy policy link is not an
account creation flow — so this is fine. Mitigate it anyway: the privacy page
carries no navigation, no "sign in" link and no app branding beyond the name.

---

## 6. iOS release — unlisted

Full App Review, once. Then a direct link, not searchable, **no expiry and no
install cap** — unlike TestFlight external, where builds die after 90 days.

1. Submit as a normal App Store submission.
2. In **Review Notes**, state the exemption explicitly (§ 7).
3. The **Account Holder** files Apple's unlisted request at
   `developer.apple.com/contact/request/unlisted-app/`. The app must be submitted
   to review and must not be in a beta/prerelease state when the request is filed.

The Apple Developer account is an **Organization** account under Sabeel Institute,
so listings show the institute's name and the Account Holder files the request.

### Metadata never filled in, because TestFlight does not ask for it

- App Privacy questionnaire — Contact Info (email), User Content, Identifiers,
  Diagnostics. All **Linked to You**, none **Used to Track**.
- Age rating questionnaire.
- Support URL, privacy policy URL, screenshots at required sizes.

### Third-party SDK manifests

`GoogleSignIn`, `AppAuth`, `GTMAppAuth`, `GTMSessionFetcher` and `GoogleUtilities`
are all on Apple's required-manifest list and arrive via CocoaPods. Verify in
`ios/Pods` after a prebuild on the Mac — this cannot be checked from Linux.
Sentry is **not** on Apple's list. Watch for `ITMS-91053` warning emails after any
upload.

### Not required

- **Sign in with Apple.** Kanban and the timesheet are exempt under 4.8's
  education/enterprise carve-out (existing Workspace account). The recordings app
  needs the two-door split — see § 8.
- **ATT prompt or consent gate for crash reporting.** Apple's own guidance is
  explicit that analytics and crash reporting confined to your own app is not
  tracking. Disclosure in App Privacy is sufficient.

---

## 7. Android release

**Internal apps (Kanban, timesheet): closed testing.** Play has no equivalent of
Apple's unlisted, and production means a public listing. Closed testing stays
invisible, and membership is a Google Group an admin edits — which works because
every staff member has a Workspace Google account. Kanban is already on internal
testing, which is equally unlisted; moving to closed testing buys Google Group
management and a higher cap, nothing else.

**Recordings app: production.** Student intake is rolling and a student's Play
account is not the address the institute holds, so allowlisting does not scale.
The Play developer account is organizational, so production is available directly
— the 12-testers-for-14-days gate applies only to personal accounts created after
13 November 2023.

### Data safety form

Answer **No** to account creation, which under this design is true rather than
arguable, and the account-deletion questions fall away with it. Everything
declared must match the privacy policy — Google checks consistency.

### Already satisfied, do not regress

- `targetSdk 36` — meets the 31 August 2026 requirement.
- `minSdk 33`.
- Both external-storage permissions stripped with `tools:node="remove"`.

---

## 8. Per-app adaptation

### Kanban — the pilot

Already has iOS, purpose strings, and a released Play track. Needs: the § 2
refactor, the § 4 web pages, the § 5 in-app additions, and the § 6 metadata.

#### The review account: an email sign-in, one address, a member

Decided by Faisal on 2026-10-15, in his words:

- "sign in thru email should never be able to be an admin or manager. Just a
  member."
- "That sign in with password for kanban and timesheet should only accept that
  one email. The sign in page shouldn't indicate its a special thing for a
  reviewer."
- "create a board for app reviewer and add as member there. They won't get to
  see any of our actual data." — and "That way there's no special code for app
  reviewer."

So the reviewers get an ordinary member account that signs in with a password,
and nothing in the app is about reviewers:

- **The door.** The sign-in screen has a plain **Sign in with email** link under
  Google. Password sign-in is accepted for exactly one address,
  `PASSWORD_SIGN_IN_EMAIL` in `packages/shared/src/constants.ts`: `beforeSignIn`
  (functions/src/signUpGate.ts) refuses it for any other, and firestore.rules and
  storage.rules give a password session for any other address nothing at all.
  The refusal reads like a wrong password.
- **Member only, whatever the claims say** (`sessionAccess`, the rules' `role()`,
  `actorOf` in every callable), and `setUserAccess` refuses to give a
  password-only account any other role.
- **No sign-up.** `beforeSignUp` refuses every password sign-up from a client,
  that address included; the account is made by an admin. The app still makes
  no account on any surface, so § 1 stands.
- **The address is public, on purpose.** Rules cannot read a secret, so the
  literal is in this public repository, and it goes to Apple in the review notes
  anyway. The account's security is a long generated password and Firebase's
  rate limiting, and even signed in it is a member of one board of sample cards.
  Do not hide it behind a claim: that is a second mechanism and an extra admin
  step for no gain.

**Setting it up, as ordinary admin steps** (the password lives in Faisal's vault,
never in this repository):

1. Make the account through the Firebase console (Authentication → Add user) or
   the Admin API, with that address, a generated password, and the address
   verified (`emailVerified: true` through the API). An admin-made account runs
   no blocking function; `onUserCreate` provisions it as a pending member, as for
   anyone.
2. Approve it in **People**, as a member.
3. Make a board **App Review** and add the account as its only other member
   (Board settings → Members). Add a few neutral cards to open, move and comment
   on. It must be on no other board.

**Order on the first deploy:** functions (with `beforeSignUp` and
`beforeSignIn`) first, and both registered as the project's blocking triggers,
then the Email/Password provider switched on; then the steps above. The other
way round there is a window with no door.

### Timesheet

`platforms: ["android", "web"]`. Same refactor and same web pages. iOS is a later
project — when it happens, § 6 applies unchanged. Its Play track stays unlisted.

### Sequencing

Kanban ships through App Review **first, alone** (decided 2026-08-18). The other
two follow once it is through. The pilot exists so that a correction from Apple
costs one app's rework rather than three — and the exemption argument in § 9 is
exactly the kind of thing a reviewer might push back on.

### Recordings app — the one that differs

`platforms: ["android", "web"]`, two populations, and **both doors now exist**
(updated 2026-09-07; this section previously said the student email/password
system had not been built).

- **Two labelled doors on the sign-in screen — DONE.** "Staff" (Google
  Workspace) and "Students" (email and password), as separate headed sections. A
  reviewer can see the split, and it stops students tapping Google and hitting a
  wall.
- **Sign in with Apple is not needed** provided the student door stays
  first-party. The moment any social login appears on the student side, 4.8
  triggers and Sign in with Apple becomes mandatory.
- **Student accounts are created by staff, on the web app only**
  (`CAN_CREATE_ACCOUNTS`), and the student sets their own password from an
  emailed link. The student never creates the account, wherever they first sign
  in.
- **Only the Google door needed the § 2 gate.** `signInWithEmailAndPassword`
  cannot bring an account into existence — it fails when there is none — so the
  student door was never a trigger. `createUserWithEmailAndPassword` is the call
  that would be, and this app has never had it on any surface. Worth stating
  because "the mobile refusal applies to both doors" reads as though both needed
  building, and only one did.
- **Password reset** exists, and it is a first-party flow — no third-party login
  service involved, so it changes nothing about 4.8.
- Retention: academic records are retained. FERPA grants students the right to
  inspect and amend, never to erase, and transcripts are normally kept
  permanently.

**The review account is a STUDENT account, and only a student account** (decided
2026-08-19). Both stores need working credentials — Apple under 2.1(a), Play
under *App access* — and the same account serves both.

Do not hand a reviewer a Google Workspace account. Two-Step Verification an admin
can exempt; the **login challenge** Google raises on a sign-in from an unusual
location is separate, and an admin override for it lasts **10 minutes** with no
permanent per-account disable. An App Review session is exactly an unusual
location, arriving asynchronously, with the code going to whoever's phone is on
the account. There is no version of that which works.

A student account is sufficient because the student experience *is* the app:
signing in and reaching your recordings. Apple asks for "credentials for the role
needed to verify key features", not every role.

**What this costs, and it is the only thing to watch:** the store listing must
describe what a student account can demonstrate. Advertise teacher tooling in the
description or the screenshots and a reviewer may reasonably ask to see it, which
is a "Guideline 2.1 — Information Needed" round trip of about a week. Keep the
listing and the demo account describing the same app.

Say the shape out loud in Review Notes anyway — two roles, the teacher role
restricted to the institution's Workspace accounts, the student account
demonstrating the reviewable functionality. A reviewer told why up front does not
ask.

**And keep the account alive.** Every future update is reviewed too, and a demo
account disabled after approval is an automatic rejection next time.

---

## 9. Review Notes — the text to paste

```text
This app does not support account creation. Accounts are provisioned by the
organisation through its web application; the app refuses sign-in for any
identity that does not already have an account, and no account is created from
the app under any circumstance. Guideline 5.1.1(v) is therefore not engaged.

Sign-in uses Google with the organisation's existing enterprise accounts, which
is the education/enterprise exemption under Guideline 4.8.

[Kanban and the timesheet] For review, sign in with "Sign in with email"
using the account below. It is an ordinary member account made by an
administrator, the only one that signs in with a password; staff sign in with
Google. It belongs to one board of sample cards, so that nothing real is shown.
Email: <the review address>   Password: <from Faisal's vault>

[Recordings app only] The sign-in screen has two separate paths. Staff sign in
with the organisation's Google Workspace accounts. Students use a first-party
email and password system operated by the institution. No third-party login
service is offered on the student path.

Account deletion is requested by email; the privacy policy states the address,
the process and what is retained. Organisation-owned records — [cards /
timesheets / academic records] — are retained as institutional business records.
```

---

## 10. Legal position

Driven by store rules, not statute:

- **Texas TDPSA** — nonprofits are fully exempt, and small businesses separately.
- **CCPA** — applies to for-profit businesses. Not applicable.
- **FERPA** — **does not apply.** Confirmed 2026-08-18: the institute receives no
  US Department of Education funding. Retention of student records rests on
  institutional and contractual grounds instead, which is equally solid and is
  how the policy should word it. Do not cite FERPA.
- **GDPR** — **out of scope.** Confirmed 2026-08-18: all students are in the US.
  No erasure-rights section is needed. Revisit if the institute ever enrols
  someone in the EU or UK, because that single fact brings it back.
- **COPPA** — not applicable; no under-13 users on any app.

So the privacy policy can be short, plain and honest rather than a compliance
document. Have someone read it who is not the person who wrote it.

---

## 11. What has shipped, and what is still unverified

Built 2026-08-18 in v0.10.0. **Two halves are each proven; their join is not.**

- `accountExists` — 10 emulator tests, including that asking about an unknown
  address creates no user record.
- The ordering — 6 unit tests in `app/src/auth/googleGate.test.ts`, the important
  one being that `signInWithCredential` is never called when no account exists.
- The web app still creates accounts — `web-e2e` unchanged and green, which is
  what proves the gate did not leak across the platform seam.
- The public pages — fetched anonymously against the hosting emulator and checked
  they are static, not the SPA shell.

**The native round trip is now verified too**, on Android against production
(2026-08-18), which was the one thing no test on Linux could reach:

- a personal Google account with no Kanban account → the refusal message;
- signing in with a Workspace account immediately afterwards → works, which also
  proves `googleSignOut()` ran, since Google would otherwise have silently
  reused the first account and made switching impossible;
- and the assertion that matters, checked against production Auth rather than
  inferred from the screen: **the refused attempt created no account.** Zero new
  auth records, and zero non-`oursabeel.com` accounts in the directory at all.

Before this release that same attempt created a record and relied on
`onUserCreate` to delete it again. Now nothing is created, which is the whole
claim.

**Still unverified: iOS.** Same code path and the same seam, but a different
platform, and `docs/IOS-BUILD.md`'s handoff prompt asks for the identical check
on a real iPhone.

### Recordings — built 2026-09-07

The same design, adapted: `functions/src/accountExists.ts` and the gate in
`app/src/auth/google.ts`, with the refusal copy from § 2 and no URL in it.

- 7 emulator tests on the callable. Every one asserts the **user count**
  afterwards, not just the boolean — a version answering `exists: false` while
  quietly minting a record would satisfy a return-value test and fail the only
  promise that matters. Two cases are about refusing a *real colleague* on the
  allowed domain whose account does not exist yet, and refusing an unverified
  address that does match an account.
- 5 unit tests on the ordering, the load-bearing one being that
  `signInWithCredential` is never reached when no account exists. Shown to fail
  with the gate bypassed.
- Only the Google door was changed, for the reason in § 8.

**Still unverified: the native round trip**, and for a different reason than
iOS. It needs a personal Google account with no account in the project, signed in
on a device against production — the check Kanban did on 2026-08-18. Nobody has
run it here, so the claim currently rests on the callable and the ordering being
correct, not on having watched a stranger be refused. Do it before submitting.

## 12. Open decisions

- [ ] Create `privacy@oursabeel.com` as a Workspace group and put two admins on
      it. Decided 2026-08-18; does not exist yet.
- [ ] Who reviews the privacy policy text. It should be read by somebody who did
      not write it.
- [ ] App Store listing copy, screenshots and category, per app.
- [ ] Whether a Google sign-in links correctly to a pre-created Auth user —
      depends on the project's one-account-per-email setting. Only matters if the
      backstop in § 2 is implemented as pre-provisioning.
- [x] Whether `beforeCreate` fires for Admin SDK `createUser`: it does not, and
      `functions/test/integration/signUpGate.test.ts` holds that, so
      `beforeSignUp` refuses every password sign-up from a client and an admin
      can still make one (2026-10-15).

---

## Sources

- Apple — [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- Apple — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
  (2.1 demo accounts, 4.8 login services, 5.1.1 privacy and deletion)
- Apple — [User Privacy and Data Use](https://developer.apple.com/app-store/user-privacy-and-data-use/)
- Apple — [Unlisted app distribution](https://developer.apple.com/support/unlisted-app-distribution)
- Apple — [Third-party SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/)
- Google Play — [App account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- Google Play — [Open, closed and internal tests](https://support.google.com/googleplay/android-developer/answer/9845334)
- Google Cloud — [Blocking functions](https://docs.cloud.google.com/identity-platform/docs/blocking-functions)
- Expo — [Privacy manifests](https://docs.expo.dev/guides/apple-privacy/)
