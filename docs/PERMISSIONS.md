# Who can do what

Two separate things decide it, and keeping them separate is the whole design:

- an **org role** — `member`, `organizer` or `admin` — which says what you can do
  across the organisation;
- **ownership of one board**, which says what you can do on that board and
  nothing else.

They are orthogonal. A plain member can own a board. An organizer can own none.
Neither fact tells you anything about the other.

Status gates everything above both of them: nothing at all works unless the
account is `active`. And an active account sees only the institute's rules until
it has accepted them, once (`acceptRules`; `docs/STORE-RELEASE.md` § 4).

## The org role

| | member | organizer | admin |
|---|---|---|---|
| Use the app at all | ✓ | ✓ | ✓ |
| Create a board | — | ✓ | ✓ |
| Create a label | ✓ | ✓ | ✓ |
| Report a problem (five an hour) | ✓ | ✓ | ✓ |
| Rename, recolour or delete a label | — | — | ✓ |
| Stats | — | — | ✓ |
| Approve accounts, change roles | — | — | ✓ |
| See a board you were not added to | — | — | ✓ |

`organizer` grants **exactly one thing**: starting a board. Whoever starts one
owns it, which is how the role turns into authority — but only over what they
started, and only until somebody hands it elsewhere.

**Only an admin sees every board.** Everyone else, organizers included, sees the
boards they are a member of. There is no third case anywhere in the rules.

**Label curation is admin-only** because a label is org-wide: renaming or
deleting one changes cards on boards the person doing it may not even be able to
open. Creating one is not gated beyond being active — it happens while somebody
is looking at a card, it is cheap, and it is reversible by an admin.

**A password sign-in is a member, and only for one address** (Faisal,
2026-10-15). The role a session acts with depends on how it signed in: through
Google, the claims' role; with a password, member whatever the claims say. A
password sign-in is accepted for one address (`PASSWORD_SIGN_IN_EMAIL`), the
account the store reviewers use; for any other it is refused at sign-in, and a
session that got past would have no access at all. An admin cannot give a
password-only account another role. `docs/STORE-RELEASE.md` § 3, The review
account, has the why.

## Board ownership

A board carries `boardOwnerUids`. Being in it — **and** being a member of the
board — is what lets you:

- change the board's name — `description` exists on the document and the ClickUp
  importer sets it, but no screen edits one, so nothing here grants that
- add, rename, reorder and delete columns
- add and remove members
- make another member an owner, or take it away
- archive the board, and restore it
- permanently delete a card (members can only archive)
- delete anybody's comment

It grants nothing anywhere else. Owning three boards and owning none are the same
thing on the fourth.

Everyone else on a board opens the same screen and gets **the member list,
read-only**, with owners marked. That answers "who do I ask to add someone?"
without a trip to an admin — which is what it used to take.

### The creator is protected

The person who created a board cannot be removed from `boardOwnerUids` by
another owner, and cannot be removed from the board either. **Only an admin can**
— including when the creator wants to step down themselves, which they cannot do
unaided.

The rule is phrased on the CHANGE, not on the value: it refuses an update that
*takes* the creator out. A board where an admin has already legitimately demoted
the creator stays perfectly editable, which a value-shaped rule ("the creator
must always be an owner") would have made permanently uneditable instead.

It checks **both lists**, on both sides. Authority is `member AND owner`, so
dropping the creator from `memberUids` unseats them exactly as completely as
dropping them from `boardOwnerUids`, and nothing makes the two move together —
and equally, a creator who already holds only one of the two holds nothing, so
there is nothing left to protect and the clause stands aside. Pinning that state
would freeze the board for everyone but an admin.

**`removeBoardMember` repeats the check, and that repetition is the real
boundary.** That callable clears both lists itself, so removing the creator
through it is the same unseating by another route — and it is an Admin SDK batch,
which rules do not see at all. The screen disables the row; a disabled control is
an affordance, not a security control.

### Ownership is checked alongside membership, never alone

Every check is "in `memberUids` AND in `boardOwnerUids`". A leftover ownership
entry for somebody no longer on the board therefore grants nothing.

That pairing is load-bearing. There is deliberately **no rule** that
`boardOwnerUids ⊆ memberUids`.

The invariant does hold: `removeBoardMember` clears both lists in one batch. But
it holds because that code is right, and rules cannot check an Admin SDK batch at
all. A subset rule would convert any lapse there — or any restore from a backup
predating this shape — into a board that silently bounces the next client write
and only an admin can repair, which is how the labels migration broke board
editing. The pairing makes the same lapse inert instead: a stray entry grants
nothing, and `scripts/verify-board-owners.mjs` reports it.

### Membership only changes through callables

**Neither adding nor removing is a client write.** `addBoardMember` and
`removeBoardMember` are both callables, and the rules refuse any client update
that touches `memberUids` or `memberProfiles` at all — **admins included**. Board
*create* still sets `memberUids: [creator]`; this governs updates.

Removal has always had to be server-side, for the reason below. **Adding joined
it on 2026-08-20, because it did not work**: rules allow `list` on `users/` to
admins alone, so a non-admin owner could never see whom to add, even though the
write was permitted the whole time. The bug was not the permission — it was that
the read feeding the control was gated more narrowly than the control.

Moving it also means the **server supplies the profile**. `memberProfiles` is a
free-form map and rules cannot cross-reference `users/`, so while the client sent
it an owner could write any name or address against a uid. `listAddableUsers`
returns **names only** for the same reason the directory is admin-only: a picker
needs something to tap, not everybody's address.

This is what makes "assignees are board members" true rather than merely
intended. That invariant is checked on CARD writes only, so a board write that
dropped a member would leave their `assigneeUids` and `subscriberUids` entries
behind — and the card read rule has an arm for each, so the person would keep
read access to the very cards the removal was meant to take away, while every one
of those cards started failing its next edit. The callable clears assignments,
subscriptions, membership and ownership in one batch precisely so none of that
can happen.

### A board with no owner

Possible, and deliberately visible rather than hidden:

- the migration writes an empty list where a board's creator had left it;
- an admin can demote the last owner;
- a disabled account keeps its ownership entries, and cannot act on them.

Such a board is administrable **by admins only** until somebody is given
ownership. Nothing is lost and nothing is stuck — an admin opens Board settings
and turns somebody's toggle on.

Disabling an account **warns** the admin when that person is the only owner of
some board, naming them, and then goes ahead. Blocking would mean being unable to
disable a departing colleague until every board they touched had been reassigned,
which is the wrong way round: losing access is the urgent half.

## Where each of these lives

One definition per rule, mirrored rather than duplicated:

| Decision | Server (the authority) | Client (affordance only) |
|---|---|---|
| Create a board | `canCreateBoards()` in `firestore.rules` | `sessionCan.createBoards` |
| Administer a board | `ownsBoard()` in `firestore.rules`, `canManageBoard` in `removeBoardMember` / `countMemberAssignments` | `canManageBoard(user, board)` |
| Take the creator off a board | `keepsCreator()` in `firestore.rules`, repeated in `removeBoardMember` | `canUnseatCreator` — the creator's row is disabled |
| Change a board's member list | `membershipIsServerOnly()` in `firestore.rules` refuses every client write; `canManageBoard` inside `addBoardMember` / `removeBoardMember` | the picker calls `listAddableUsers`, also `canManageBoard` |
| See a board's contents | `onBoard()` in `firestore.rules` | `canAccessBoard(user, board)` |
| Curate labels | `isAdmin()` in `firestore.rules`, `canCurateLabels` in `deleteLabel` | `canCurateLabels` |
| Stats | `isAdmin()` in `firestore.rules` | `canViewStats` |
| Report a problem; accept the rules | `canUseApp` inside `reportProblem` and `acceptRules`; `reports/*` closed to every client in `firestore.rules` | the rules screen in `App.tsx`; Report a problem in More |
| Administer accounts | `checkAccessChange` in `setUserAccess` | `canAdministerUsers` |
| The role and status a session acts with (the password door) | `isSignedIn()` and `role()` in `firestore.rules`, `isActive()` in `storage.rules`, `sessionAccess` through `actorOf` in every callable, `beforeSignIn` | `sessionAccess` in `session.ts` |

`packages/shared/src/access.ts` holds every client-side predicate, and each has
its own body even where two agree today — `canCurateLabels` was once an alias for
the board-authority predicate, which meant that the day board authority became
per-board, a member promoted to run one board would have inherited the power to
strip a label off every card in the organisation.

Attachment downloads are the one place a *rule* cannot decide: Cloud Storage
rules cannot read Firestore, so `getAttachmentUrl` and `deleteAttachment`
authorize in TypeScript with `canAccessBoard`. That function IS the download
boundary, not a mirror of one.

## What this replaced

Until 2026-08-16 board authority was an org role. `manager` meant three unrelated
things at once — administer any board, curate org labels, read stats — and one
consequence was that every manager could see and administer **every** board.
`docs/DEPLOY.md` § Restoring across the board-ownership migration records what a
restore from before that date has to re-run.
