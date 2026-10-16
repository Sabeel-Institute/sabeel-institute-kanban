# Kanban on the App Store and Google Play

Kanban's store answers, its review account and where it stands. The method and
the decisions every Sabeel app shares, numbered 1–10, are in the
[`sabeel-app-stores` skill](https://github.com/Sabeel-Institute/brand/blob/main/skills/sabeel-app-stores/SKILL.md).
When this file and the skill disagree about a shared decision, the skill wins
and this file is the one to fix. Building and shipping: `docs/DEPLOY.md` and
`docs/IOS-BUILD.md`.

## Where it stands (2026-10-16)

**iPhone.** TestFlight internal testing: v0.11.5 builds 11, 12 and 13, all
VALID, in the group "Sabeel Kanban Internal". The next upload is build 14
(`expo.ios.buildNumber`). App Store Connect app 6801011482, SKU `sabeel-kanban`,
bundle id `com.sabeelinstitute.kanban`. **Nothing has been submitted to App
Review.** Destination: the App Store, unlisted. Kanban goes through App Review
first and alone, the pilot for the other Sabeel apps (decided 2026-08-18), so a
correction from Apple costs one app's rework rather than three.

**Android.** Google Play internal testing now: v0.11.4 (versionCode 11004) on
the track, testers the account-wide "Sabeel staff" email list. Destination:
Play production, a public listing (decided by Faisal 2026-10-16). The app
signing key is Google-generated; the repo's key (in the vault) is the upload
key only. The download page's APK (`docs/DEPLOY.md`) is signed with the upload
key, so it and a Play install cannot replace each other.

**Web.** <https://sabeel-institute-kanban.web.app>, v0.11.5 (`67913fa`), serving
`/privacy`, `/support` and `/get-app` as static pages. The email sign-in's
server side is live; its link reaches the web with the next hosting deploy.

## How Kanban keeps the shared decisions

### 1. The app never creates an account

Both stores require in-app account deletion only from an app that creates
accounts or points at somewhere that does; Kanban does neither (skill,
decision 1). Built 2026-08-18 in v0.10.0.

**What breaks it.** Signing out afterwards does not unmake the Auth record or
the `users/` document the create trigger already wrote:

```ts
// WRONG. The account exists by the end of line 1.
await signInWithCredential(auth, cred);
const me = await getDoc(doc(db, 'users', auth.currentUser.uid));
if (me.data()?.status !== 'active') await signOut(auth);
```

**What works.** Native Google Sign-In is pure Google OAuth: it yields an ID
token and touches nothing in the Firebase project. The gate lives in that
window (`app/src/auth/google.ts`):

```ts
const { idToken } = await GoogleSignin.signIn();      // creates nothing
const { exists } = await accountExists({ idToken });  // callable, Admin SDK
if (!exists) return showRefusal();                    // never reaches Firebase Auth
await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
```

**The `accountExists` callable** (`functions/src/accountExists.ts`):

- Verifies **Google's** ID token, not Firebase's. `getAuth().verifyIdToken()`
  checks tokens Firebase issued; this one comes from `accounts.google.com`,
  because the person has not signed in to Firebase yet — the whole point. It
  uses `google-auth-library` and pins the audience to `GOOGLE_WEB_CLIENT_ID`;
  without the pin, a token minted for any other OAuth client would pass.
- Unauthenticated, because there is no session yet; it trusts no email the
  client sends.
- Answers **one boolean**: does an account exist. Never role, status or why —
  that would be an account-enumeration oracle.

It deliberately does not check status. Existence is the whole question, because
signing in to an account that already exists creates nothing:

| State | In the app | Why it is safe |
|---|---|---|
| No account | Refused; `signInWithCredential` never called | The one case that would create |
| Pending | Signs in, waiting-for-approval screen | Account exists; the screen updates live on approval |
| Disabled | Signs in, account-disabled screen | Account exists; disabling sets a claim and revokes tokens, so sign-in succeeds and `App.tsx` routes on the claim |
| Active | Signs in | — |

**It cannot be done on the client.** `fetchSignInMethodsForEmail` returns an
empty array for every project created after 15 September 2023 (email
enumeration protection); Firebase's replacement is the Admin SDK behind a
callable.

**No server-side backstop** (considered and rejected 2026-08-18). A
`beforeCreate` refusal of everything would also stop the web app, which keeps
self-service sign-in, and a blocking function cannot tell web from phone
(`EventContext` has no client identifier). If the exemption is ever
challenged, the answer is admin pre-provisioning, not detection — which would
first need it settled whether a Google sign-in links to a pre-created Auth
user under the project's one-account-per-email setting.

**The refusal copy names no website:**

> **This account isn't set up for the app yet.**
> Contact your administrator.

"Sign in on the website first" is the exact sentence Play's second clause
forbids. The real instruction goes in the onboarding email, out of band. The
comments in `SignInScreen.tsx` and `google.ts` say why there is no "Sign up"
link, and `GET_APP_URL` (which carries that instruction) is linked only on the
web.

**What moves to the web, and what stays.** Only creating an account moves: web
sign-in stays self-service (staff sign in with Google and land pending; an
admin approves), so the web needed nothing new. Role changes, disable and
re-enable, membership and every other admin action stay in the app; none
creates an identity, and an admin can still cut off a departing colleague from
a phone.

**What is proven:**

- `accountExists`: 10 emulator tests
  (`functions/test/integration/accountExists.test.ts`), including that asking
  about an unknown address creates no user record.
- The ordering: 6 unit tests (`app/src/auth/googleGate.test.ts`), the
  load-bearing one that `signInWithCredential` is never reached when no account
  exists.
- The web still creates accounts: `web-e2e` green, so the gate did not leak
  across the platform seam.
- The public pages: fetched anonymously against the hosting emulator and
  confirmed static, not the app shell.
- **The Android round trip, against production (2026-08-18):** a personal
  Google account with no Kanban account got the refusal; a Workspace account
  straight after signed in (so `googleSignOut()` ran); and production Auth
  showed **no new record** and no account outside `oursabeel.com` at all.
- **iPhone: not yet verified.** Same code path, different platform; it is on
  the checklist below.

### 2. Sign in with Apple

Not required (skill, decision 2): staff sign in with existing Workspace
accounts, 4.8's education/enterprise exemption, and the email door is
first-party. Sign in with Apple is not enabled on the App ID
(`docs/IOS-BUILD.md`).

### 3. The review account

Decided by Faisal on 2026-10-15, in his words:

- "sign in thru email should never be able to be an admin or manager. Just a
  member."
- "That sign in with password for kanban and timesheet should only accept that
  one email. The sign in page shouldn't indicate its a special thing for a
  reviewer."
- "create a board for app reviewer and add as member there. They won't get to
  see any of our actual data." — "That way there's no special code for app
  reviewer."

So nothing in the app is about reviewers (skill, decision 3):

- **The door.** A plain **Sign in with email** link under the Google button.
  Password sign-in is accepted for one address, `PASSWORD_SIGN_IN_EMAIL` =
  `apps-reviewer@oursabeel.com` in `packages/shared/src/constants.ts`:
  `beforeSignIn` (`functions/src/signUpGate.ts`) refuses any other, and
  `firestore.rules` and `storage.rules` give a password session for any other
  address nothing. The refusal reads like a wrong password.
- **A member whatever its claims say**: `sessionAccess`, the rules' `role()`
  and `actorOf` in every callable; `setUserAccess` refuses a password-only
  account any other role.
- **No sign-up.** `beforeSignUp` refuses every password sign-up from a client,
  that address included; the account is made by an admin, so § 1 stands. The
  blocking functions need Identity Platform, on since 2026-10-15.
- **The address is public, on purpose.** Rules cannot read a secret, so the
  literal is in this public repository. The account's security is a long
  generated password and Firebase's rate limiting; signed in, it is a member of
  one board of sample cards. Do not hide it behind a claim: a second mechanism
  and an extra admin step for no gain.

**The account** was made 2026-10-15 through the Admin API with that address, a
generated password and a verified email (an admin-made account runs no
blocking function). `onUserCreate` provisioned it pending; it was approved as a
member. It belongs only to the **"App Review"** board, whose members are Faisal
and the account, with five sample cards. Signed in through the public API it
sees that board alone, and reading another board is refused.

**The password** lives only in the vault,
`~/.config/secrets-vault/sabeel/review/kanban-app-review.txt`, and, at
submission, in App Store Connect's App Review Information sign-in fields and
Play Console's App access. Never in a repository, a chat or a log.

**Resetting it:** set a new password on the account with the Admin SDK
(`getAuth().updateUser(uid, { password })`) or Identity Toolkit
`accounts:update`, with gcloud ADC on `sabeel-institute-kanban`; then write it
into the vault (`vault.sh collect`) and both store consoles. Not a reset email:
the address is not a Workspace user.

**Recreating the board, through Kanban's own screens:** an admin makes a board
named **App Review** (Boards → **New board**), adds the review account with
Board settings → **Add someone**, and adds a few neutral cards to open, move and
comment on.
The account is on no other board. If the account itself is gone: make it again
as above, then approve it in **People** as a member. On a new project the order
that keeps the door shut is in `docs/DEPLOY.md` § Prerequisites.

**Keep it alive.** Every update is reviewed too, and a demo account disabled
after approval is an automatic rejection.

**The locks and their tests:**

| Lock | Test |
|---|---|
| The one address, `refusedSignIn`, `refusedSignUp` | `functions/test/unit/passwordDoor.test.ts` |
| `beforeSignUp` refuses password and off-domain sign-ups and makes no account; the Admin SDK still can; `beforeSignIn` lets only the one address in | `functions/test/integration/signUpGate.test.ts` |
| `actorOf` holds the address to a member; no callable reads `auth.token` itself | `functions/test/unit/actor.test.ts` |
| A member whatever its claims; promotion refused for a password-only account | `functions/test/integration/setUserAccess.test.ts` |
| Firestore rules: the address as a member, any other password session nothing | `functions/test/integration/rules.test.ts`, `boardRules.test.ts` |
| Storage rules | `functions/test/integration/attachmentRules.test.ts` |
| The door end to end, by keyboard: refused for another address and a wrong password in the same words, a member though its claims say organizer | `scripts/web-e2e.mjs` |

Each lock was mutation-checked against its own test (deploy log, 2026-10-15).

### 4. Content: the rules, Report a problem, and @mentions

What Kanban users post: cards (title and rich-text description), comments with
links and @mentions, and attachments of any type up to 10 MB. Everything is
seen only by members of the same board (and admins, who see every board).

Before the first App Store submission or Play production release, whichever
comes first, Kanban adds the skill's two pieces (decision 4, decided by Faisal
2026-10-16) — **not built yet**:

1. **The institute's rules, accepted once**, at first sign-in and before
   anything can be posted: the skill's text with "Kanban", "staff", "board" and
   "More".
2. **Report a problem** in More: the person types what is wrong, and it reaches
   Kanban's admins, who answer within 24 hours by removing the content or
   disabling the account.

Deliberately not: blocking between members (a colleague blocked on a shared
board would hide the work the board exists for), a word filter, or automatic
removal. An admin blocks a user from the service by disabling the account in
People, which revokes its sessions and leaves it only the account-disabled
screen. Board owners and admins can already delete any comment.

**Open, for Faisal, before Play production: @mentions.** Play requires in-app
blocking for "UGC features that enable 1:1 user interaction with specific users
(for example, direct messaging, tagging, mentioning)". Kanban has @mentions,
and a mention notifies the person named. Not decided; the options:

- argue that a mention can only name a member of the same board
  (`firestore.rules` holds `mentionUids` to the board's members) and only
  notifies them, so it is not interaction with strangers;
- a per-person mute of mention notifications (today a person can turn off all
  mention notifications in the Alerts settings, or mute a whole board, but not
  one person);
- drop @mentions from the Play build.

Internal testing is not reviewed against this, and Apple's 1.2 does not name
mentions.

### 5. Adults only

Every Kanban user is an adult on the institute's staff (skill, decision 5). The
privacy policy says the app is not offered to children under 13; the rules
state no minimum age, which would otherwise force Apple's rating up.

### 6. Privacy

- **`/privacy` and `/support`** are static files (`app/public/`), rewritten in
  `firebase.json` ahead of the app's catch-all, so an anonymous fetch from a
  reviewer or a crawler gets the page, not an empty app shell. The privacy page
  carries no navigation, no sign-in link and no branding beyond the name. The
  accepted residual: it shares a domain with the app, so someone could edit the
  URL down to the sign-in page; the rule governs what the app directs people
  to, and a privacy link is not a sign-up flow.
- **In the app:** Privacy policy on the sign-in screen's footer, reachable
  before signing in (5.1.1(i)), and in More. The support page is never linked
  from the app: it tells newcomers to sign in on the website first, which is
  the account-creation pointer § 1 forbids. Its URL goes in the store listings
  only.
- **Deletion by email** to `privacy@oursabeel.com`, acted on within 30 days.
  The account, its credentials, profile, contact details and notification
  settings are removed; cards, comments, attached files and the record of who
  made them are the institute's and stay.
- **What is collected** (`app/public/privacy.html`): name, email address and
  Google profile picture, from the Workspace account at sign-in; the content
  people enter — cards, comments, attached files; and crash and error
  diagnostics carrying the internal account id only (`setErrorUser` sends the
  uid, never a name or email).
- **Third parties:** Google (sign-in); Google Cloud and Firebase (hosting and
  data, in the US); Sentry (crash and error diagnostics); and Apple's push
  service, through which an iPhone notification's title and text are
  delivered.
- **Not tracking**: no advertising, no tracking across apps; no App Tracking
  Transparency prompt.
- **The iOS privacy manifest** is `expo.ios.privacyManifests` in `app.json`:
  name, email, photos or videos, other user content, user id and crash data, all
  linked, none tracking, plus `UserDefaults` with reason `CA92.1`;
  `npm run check:ios` refuses it empty. Google's sign-in pods (`GoogleSignIn`,
  `AppAuth`, `GTMAppAuth`, `GTMSessionFetcher`, `GoogleUtilities`) bring their
  own manifests: check them in the `.ipa` `ios.yml` keeps, and watch for an
  `ITMS-91053` email after an upload.

### 8. Play signing: a Google-generated key

Kanban took Play's Google-generated app signing key in August 2026; the key in
the vault is the upload key. The consequences (skill, decision 8):

- Play installs run under Google's key; its SHA-1 is registered in Firebase, or
  Google sign-in fails with `DEVELOPER_ERROR` for Play users only
  (`docs/DEPLOY.md`).
- The download page's APK carries the upload key, so it and a Play install
  cannot replace each other: uninstall first; nothing is lost, all state is in
  Firestore.
- A lost upload key is reset through Play Console support; the signing key,
  which must never change, is Google's.
- **Open, for Faisal:** whether Kanban keeps Google's key. Play allows a
  change until a release reaches open testing or production, but staff who
  installed Kanban from internal testing run under Google's key, and their
  copies would need reinstalling after a change. The LMS and the Time Tracker
  use their own keys so their download-page APKs and Play installs update
  each other; Kanban's download page is the developer's pre-release route, so
  that matters less here.

### 9. Distribution

- **iPhone now:** TestFlight, group "Sabeel Kanban Internal", which gets every
  build; adding a tester is in `docs/IOS-BUILD.md`. Builds expire after 90
  days.
- **iPhone next:** the App Store, unlisted. After the app is submitted to App
  Review, and not as a beta, the **Account Holder** files Apple's request at
  `developer.apple.com/contact/request/unlisted-app/`. The developer account is
  an Organization under Sabeel Institute, so the listing carries the
  institute's name.
- **Android now:** internal testing, the "Sabeel staff" list ticked on the
  track; `npm run publish:play -- --internal` publishes; testers join through
  the opt-in link (`docs/DEPLOY.md` § Testers).
- **Android next:** production, released from Play Console: `publish:play`
  publishes to internal testing only, and its service account holds "Release
  apps to testing tracks", not production.

### 10. Store checks

`ios.config.usesNonExemptEncryption` is false; builds run on GitHub's
`macos-26` runners (Xcode 26, iOS 26 SDK); `targetSdk` 36 and `minSdk` 33; both
external-storage permissions removed with `tools:node="remove"`. Play
registered `com.sabeelinstitute.kanban` for Android developer verification; the
download-page APK's upload key needs registering by the 2027 rollout
(`docs/DEPLOY.md`).

## Store answers

**Apple App Privacy** — data linked to the user, none used for tracking, all
for app functionality. Matches `privacy.html` and the privacy manifest:

| Category | Types |
|---|---|
| Contact info | Name, email address |
| User content | Photos or videos (attachments, the Google profile picture), other user content (cards, comments, attached files) |
| Identifiers | User ID |
| Diagnostics | Crash data |

**Apple age rating:** user-generated content **Yes**; messaging and chat **Yes**
(comments and @mentions); social media **No** (no feed); advertising **No**;
unrestricted web access **No** (links open the system browser). Keep the rating
Apple calculates; no age override.

**Play Data safety:** account creation **No** (§ 1), so the deletion questions
fall away. Collected, not shared, for app functionality: name, email address
and user IDs (personal info); photos, and files and docs (attachments); other
user-generated content (cards, comments); crash logs. Encrypted in transit;
deletion by request to `privacy@oursabeel.com`. Open: Play's "Device or other
IDs" names the Firebase installation ID, from which a phone's push token comes;
`privacy.html` does not mention push tokens, and the two must match.

**Play content rating (IARC):** completed 2026-08-29, all ages (`TODO.md` § N);
the individual answers were not recorded. Before production, confirm the
user-interaction question is answered **Yes** ("Users Interact").

**Play target audience:** 18 and over only. **Ads:** none.

**Play App access:** `apps-reviewer@oursabeel.com` and its password, with: "On the
sign-in screen, tap Sign in with email under the Google button."

## Review notes

The skill's template, filled in for Kanban. Paste into App Store Connect's App
Review Information notes, and adapted into Play's App access. The password goes
in the sign-in fields, never in the notes.

```text
This app is for the staff of Sabeel Institute, a nonprofit adult-education
institute. Accounts are provisioned by the institute through its web
application; the app refuses any identity that does not already have an
account, and no account is created from the app. Guideline 5.1.1(v) is
therefore not engaged.

Staff sign in with the institute's Google Workspace accounts (the
education/enterprise exemption under Guideline 4.8).

For review, use "Sign in with email", under the Google button, with the
account in the sign-in fields. It is an ordinary member account made by an
administrator, and a member of one board of sample cards, "App Review": open
a card, move it between columns, comment, @mention, attach a file. Creating
boards and the administrator roles are granted only to the institute's own
Workspace accounts.
Email: apps-reviewer@oursabeel.com

All content is visible only to members an administrator has added to the
same board. Nothing is public, searchable or discoverable, and users cannot
contact strangers. Guideline 1.2:
- Terms: every user accepts the institute's rules, which prohibit
  objectionable content and abusive users, before they can post.
- Reporting: More > Report a problem. The report goes to the institute's
  administrators, who act on it within 24 hours by removing the content and
  disabling the author's account.
- Blocking abusive users from the service: administrators disable the
  account, which ends its sessions and shuts it out of every board. Blocking
  between members is not offered because the app carries shared work:
  blocking between colleagues on shared work boards would hide the work they
  share.
- Contact: https://sabeel-institute-kanban.web.app/support (the privacy
  policy, linked on the sign-in screen, gives the same address).

Account deletion is requested by email; the privacy policy (linked on the
sign-in screen) states the address, the process and what is retained.
```

## Before submitting

**App Store, first and alone:**

- [ ] **Build 14 or later**, from a release with its own version and deploy-log
      entry (`docs/DEPLOY.md` § Shipping a release), carrying the Next and Go
      keys on the email form (on `main`), the rules screen and Report a problem
      (§ 4, not built).
- [ ] **The iPhone refusal round trip** on a TestFlight install: a Google
      account with no Kanban account is refused, and production Auth shows no
      new record — the check Android passed on 2026-08-18.
- [ ] **A production push** on a TestFlight install, including a tap with the
      app closed (`TODO.md` § D2).
- [ ] App Privacy and the age rating, as above.
- [ ] Listing: description, keywords, category, screenshots at the required
      sizes (from the emulator seed, never a real session), support URL
      `https://sabeel-institute-kanban.web.app/support`, privacy policy URL
      `https://sabeel-institute-kanban.web.app/privacy`.
- [ ] App Review Information: contact, sign-in required with the review
      account, the notes above.
- [ ] Version release: manual.
- [ ] After submitting: the Account Holder files the unlisted request (§ 9).

**Play production:**

- [ ] The @mentions decision (§ 4) and the signing-key decision (§ 8).
- [ ] The rules screen and Report a problem (§ 4).
- [ ] App content: privacy policy URL, App access, ads, content rating (users
      interact), target audience, Data safety (including the push-token
      question above).
- [ ] Store listing: short and full description, icon, feature graphic, phone
      screenshots, category, contact email.
- [ ] A production release from Play Console, which Play reviews.

**Both:**

- [ ] Confirm `privacy@oursabeel.com` exists (a Workspace group, two admins).
- [ ] The privacy policy read by someone who did not write it.
- [ ] Texas SB 2420: a question for a lawyer before the first public listing
      (Play production is one; skill, decision 5).

## Legal position

Driven by the store rules, not statute: the skill's decision 7 (Texas TDPSA,
CCPA, FERPA, GDPR, COPPA). Do not cite FERPA.

## Sources

- [The `sabeel-app-stores` skill](https://github.com/Sabeel-Institute/brand/blob/main/skills/sabeel-app-stores/SKILL.md)
- Apple — [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- Apple — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
  (1.2 user-generated content, 2.1 demo accounts, 4.8 login services, 5.1.1
  privacy and deletion)
- Apple — [User Privacy and Data Use](https://developer.apple.com/app-store/user-privacy-and-data-use/)
- Apple — [Unlisted app distribution](https://developer.apple.com/support/unlisted-app-distribution)
- Apple — [Third-party SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/)
- Google Play — [App account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- Google Play — [User-generated content](https://support.google.com/googleplay/android-developer/answer/9876937)
- Google Play — [Open, closed and internal tests](https://support.google.com/googleplay/android-developer/answer/9845334)
- Google Cloud — [Blocking functions](https://docs.cloud.google.com/identity-platform/docs/blocking-functions)
- Expo — [Privacy manifests](https://docs.expo.dev/guides/apple-privacy/)
