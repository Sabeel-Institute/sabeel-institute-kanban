# Sabeel Institute Kanban — Product Brief

## Context

Sabeel Institute (small nonprofit, **under 50 people**, all internal — no external
or public users) currently runs on ClickUp and wants off it for three reasons:

1. **The interface is too busy.** Outside the kanban board itself, the team uses
   almost none of what ClickUp offers, and the surrounding feature mass gets in
   the way.
2. **The 5-board cap.** They need unlimited boards.
3. **No good mobile story.** They want real on-the-go usage from a phone.

So the product is: **a featureful kanban board, access-controlled across unlimited
boards, that is genuinely good on a phone.** Nothing else.

Faisal is the developer. The nonprofit's staff are the admins and board owners
in the app.

## Product invariants (do not silently change)

- **Restraint is the feature.** The reason to leave ClickUp was interface bloat.
  Every proposed addition must justify itself against "does the team actually use
  this?" No dashboards, no integrations, no automations, no Gantt/calendar/list
  view alternates, no time tracking (that lives in the sibling time-tracker app).
  When in doubt, leave it out and ask.
- **No board limit.** Nothing in the data model, UI, or rules may cap board count.
- **Phone-first, not phone-compatible.** The mobile board is a distinct layout
  (below), not a squeezed desktop board. Every feature ships with a phone design.
- **Three org-wide roles, not per-board roles.** See below — this is deliberately
  simpler than the per-board role matrix originally sketched.

## Decisions (settled with Faisal, 2026-07-18)

| Topic | Decision |
|---|---|
| Auth | Google sign-in **only**, restricted to **`@oursabeel.com`** — a Google Workspace domain (confirmed 2026-07-19). Domain match alone is not enough: every new account still lands `pending` and an **admin** individually approves or rejects it. |
| Roles | **Org-wide: admin / organizer / member**, plus **per-board ownership** (changed 2026-08-16; it was three roles alone, with `manager` meaning board authority). See `docs/PERMISSIONS.md`. |
| Board count | **Unlimited.** |
| Card basics | Title, description, **assignees** (multiple), **due date**, **priority**, **labels/tags**. |
| Card extras | **Comments with @mentions**, **per-card activity history**. |
| Cross-board view | **"My Work"** — every card assigned to me across every board, sorted by due date. First-class screen, and the phone's default landing surface. |
| Due dates | **All-day dates only** (`YYYY-MM-DD`), no time-of-day, no start dates. |
| Card subscriptions | **Comments only.** Anyone who can see a card may subscribe to its comment thread (2026-07-28). Assignees are unaffected and may also subscribe, which keeps the interest after they are unassigned. Not "watchers": no other change notifies. |
| Labels | **Org-wide.** One set every board shares (changed 2026-07-27; they were per board). Any active member may add one; **admins** rename and delete (narrowed 2026-08-16 — the effect is org-wide, so the authority is). |
| Description format | **Markdown, restricted to five elements** — bold, italic, bullet list, ordered list, link (changed 2026-07-30). Both editors are WYSIWYG, so markdown is storage the user never sees. See "Rich text". |
| Search | **Global across the boards you belong to**, client-side matching. See "Search". |
| Notifications | Push **plus an in-app inbox** with an unread badge. |
| Watchers | **No general watchers.** Narrowed rather than overturned on 2026-07-28: you may subscribe to a card's COMMENTS (row above), and beyond that only assignment and @mention notify. Notifying on every change was considered and dropped. |
| WIP limits | **None.** Dropped from the model. |
| Column deletion | **Blocked until the column is empty**, made painless by multi-select bulk actions. |
| Bulk actions | **Multi-select cards** → move, archive, delete, assign. |
| Board list | **Favorites + recents**, then everything else alphabetically. No folders. |
| Card deletion | Members **archive** only. Permanent **delete is the board's owners and admins**. |
| Offboarding | A disabled user **keeps their assignments**, rendered as inactive; a board's owners get a review list to reassign. Disabling **warns** if the person solely owns a board, and proceeds anyway. |
| Theming | **Single light theme, no dark mode** (decided 2026-07-21). Semantic tokens throughout, so a re-theme stays a one-file change. |
| Subtasks | A card may be a **subtask of one other card on the same board** (`parentId` on the child). The parent's detail view lists them and links straight through; the child shows "Subtask of". Deliberately NOT a checklist: a subtask is an ordinary card, with its own column, assignees and comments. Added 2026-07-25 — the ClickUp import had been faking it in description text. **`parentId` is an opaque string to the rules**: same-board is enforced by the picker, not by `firestore.rules`, which check only that it is a string under 200 chars. A child's read access comes from its OWN `boardId`, so a stale or cross-board link leaks nothing — it renders as nothing. Do not add a rules lookup to "fix" this; it would cost a read on every card write to enforce something the UI already does and no one can exploit. |
| Explicitly NOT in v1 | Checklists (as a separate item type — see Subtasks), custom fields, dependencies, recurring cards, alternate board views, automations, integrations, guest/external access. |
| Layout | **Chosen by available WIDTH, not platform** (breakpoint **700px**, `WIDE_BREAKPOINT` in `app/src/theme/layout.ts` — the one definition; never restate it). Wide → columns side by side. Narrow → one column at a time, swipe between them. So a tablet gets columns and a phone browser gets the swipe board. |
| Drag and drop | A web **capability** layered on the wide layout. Native has no HTML5 drag API, so a wide native surface (a tablet) offers the same explicit "Move to…" the narrow layout uses. |
| Card ordering | **Fractional string ranks** (LexoRank-style, base-62) in `@sabeel/shared`. A move is a single-document write. |
| Notifications | Push (FCM), with **per-user, per-event-type control**. See "Notifications". |
| Archived cards | **Kept indefinitely**, hidden from the board, reachable via filter. Cards are small text documents and the team is <50 people; auto-deletion buys nothing and loses history. Revisit only if volume surprises us. |
| Offline | Firestore **persistent local cache enabled** on both surfaces. No offline-conflict UI in v1. See "Offline". |
| ClickUp migration | **Dev-side, human-in-the-loop, pre-deployment setup step.** Never an app feature. |
| Team size | <50 users, all internal. Sizing assumptions may rely on this. |

## Roles and access

**Two independent things**, and `docs/PERMISSIONS.md` is the full statement of
them. An **org role** — held in **custom claims** and mirrored to the user doc for
display, rules trusting the token and never the doc — and **ownership of one
board**, held in `boardOwnerUids` on the board itself.

They are orthogonal: a plain member can own a board, an organizer can own none,
and neither fact implies the other.

| | member | organizer | admin |
|---|---|---|---|
| See a board they've been added to | ✓ | ✓ | ✓ |
| Create/edit/move/archive cards on such a board | ✓ | ✓ | ✓ |
| Comment | ✓ | ✓ | ✓ |
| **See every board** | | | ✓ |
| **Create boards** | | ✓ | ✓ |
| **Add a label** (org-wide) | ✓ | ✓ | ✓ |
| Rename, recolour or delete a label | | | ✓ |
| Stats | | | ✓ |
| **Approve/reject/disable user accounts** | | | ✓ |
| **Change anyone's role** | | | ✓ |

Everything about ONE board — settings, columns, membership, ownership, archiving,
permanently deleting a card, deleting anyone's comment — belongs to that board's
**owners**, plus admins. Whoever creates a board is its first owner.

Consequences worth being explicit about:

- **Boards are private from everyone except admins.** This changed on 2026-08-16:
  every manager used to see and be able to join every board, which was bearable
  while there were a handful of boards and is the opposite of least privilege as
  they multiply. If the team ever needs a board that ADMINS cannot see, this
  model still does not support it — tell me and it becomes a per-board privacy
  flag.
- **Anyone's board list is exactly the boards they've been added to**, admins
  excepted. An owner of that board, or an admin, adds them.
- **Nobody can add themselves to a board**, whatever their role — except an admin,
  who can see it in order to join it.
- **The creator of a board is protected**: only an admin can take ownership away
  from them, including when they want to hand it on themselves.
- **A board can end up with no owner** — its creator left it, or an admin demoted
  the last one. It is then administrable by admins only, which is visible in Board
  settings and fixed there.

### Domain restriction is a server-side check

Google's `hd` hint on the client is a **convenience, not a security boundary** — a
determined user can complete a sign-in with any Google account. `oursabeel.com`
being a Workspace domain gives us these layers, in order of trustworthiness:

1. ~~**OAuth consent screen set to "Internal"**~~ — **not in use.** Decided
   2026-07-19: Internal requires the Cloud project to belong to a Google Cloud
   organization, and the project is deliberately under a personal Google account
   for now, which has none. The consent screen is **External, published**. This
   was the strongest layer and we do not have it; layer 2 is therefore doing the
   work it was always specified to do on its own. Revisit if the project is ever
   moved into an `oursabeel.com` organization — see TODO.md § C.
2. **An auth-create Cloud Function** verifies `email_verified` and the email
   domain server-side, marking anything else `rejected` immediately. This is the
   layer that must exist even if someone later flips the consent screen to
   External.
3. **`firestore.rules`** never grants access on domain alone — only on
   `status == 'active'`, which only an admin can set.
4. **The client passes `hd=oursabeel.com`** purely so the account chooser does the
   right thing. Never treated as a check.

## Data model

```
users/{uid}
  displayName, email, photoUrl
  status: pending|active|rejected|disabled
  role:   member|organizer|admin
  notifyPrefs: { mention: bool, assigned: bool, dueSoon: bool, … }
  mutedBoardIds: [boardId, …]
  favoriteBoardIds: [boardId, …]
  recentBoardIds: [boardId, …]                   # client-maintained, capped at 10
  unreadNotifCount
  # Mirrors custom claims for UI display. Rules trust the TOKEN, never this doc.

users/{uid}/pushTokens/{token}                     # one doc per device; the token IS the id
users/{uid}/notifications/{notifId}                # the in-app inbox
  type, boardId, cardId, actorUid, at, read: bool, text
  # Trigger-written, like activity. The client may only flip `read`.

boards/{boardId}
  name, description, archived: bool, createdAt, createdBy
  columns: [ { id, name } ]                      # embedded: few, rarely changed
  memberUids: [uid, …]                           # for `array-contains` queries
  updatedAt?, updatedBy?                         # who changed it last, for its history: a change stamps
                                                 # both (rules hold updatedBy to the writer) or leaves both

boards/{boardId}/activity/{entryId}              # the board's own history
  type: created|renamed|archived|restored|memberAdded|memberRemoved|ownerAdded|ownerRemoved
        |columnAdded|columnRemoved|columnRenamed|columnsReordered
  at, actorUid?, actorName?, subjectUid?, subjectName?, from?, to?, since?
  # Written ONLY by the onBoardWritten trigger. Names are stored, not looked up.

labels/{labelId}                                 # ORG-WIDE: one set, every board shares it
  name, color                                    # color from LABEL_COLORS; rules check the hex shape
  createdAt, createdBy                           # '' for the 32 migrated from board arrays
                                                 # a COLLECTION, not an array: any member may add one, and
                                                 # two people appending to one array field is a lost write

cards/{cardId}                                   # TOP-LEVEL collection; keyed to a board by a FIELD
  boardId                                        # which board this card is on — client-supplied, rule-validated, changed by a cross-board move
  title, description                             # title is plain; description is MARKDOWN, five elements only
                                                 # `packages/shared/src/richtext.ts` is the one definition
  columnId, rank: string
  assigneeUids: [uid, …]                         # MUST be members of boardId's board (rule-enforced)
  subscriberUids: [uid, …]                       # comment subscribers. SAME membership rule, and for a sharper
                                                 # reason: the read rule has a subscriber arm, so this grants read
  dueDate?: string                               # 'YYYY-MM-DD' — an all-day date, NOT a timestamp
  priority: none|low|med|high|urgent
  labelIds: [id, …], archived: bool, archivedAt?  # ids into labels/*; survive a cross-board move
  commentCount                                   # denormalized for the card face
  parentId?                                      # the card this is a SUBTASK of — lives on the child, so the parent's list is derived
                                                 # board-scoped by convention (a cross-board move clears it); rules validate shape only
  createdAt/By, updatedAt/By

cards/{cardId}/comments/{commentId}              # under the CARD, so they travel with a move
  authorUid, body, mentionUids: [uid, …], createdAt, editedAt?

cards/{cardId}/activity/{activityId}
  type: created|moved|assigned|unassigned|due|priority|labels|edited|archived
  actorUid, at, from?, to?
  # Written ONLY by a Firestore trigger. Clients have no write access at all,
  # so the log cannot be forged or edited.
```

```
cards/{cardId}/attachments/{attachmentId}
  name, contentType, uploadedBy, uploadedAt
  status: uploading|ready
  sizeBytes?          # read from the object by the server, absent until then
  # The DOCUMENT is the upload's authorization: Storage rules cannot read
  # Firestore, so this rules-checked write is the only place board membership
  # can be proven. The object then goes to cards/{cardId}/attachments/{id},
  # derived from the ids and never stored. Clients cannot update or delete.
```

A card carries an `attachmentCount` of its READY files, maintained by the
attachment callables, so a board tile can show a paperclip badge without a
subcollection query per card. It is trigger-owned: rules pin it across a client
update, exactly as a board's `activeCardCount` is.

Attachments are **10 MB each**, any type, several per card. Objects are
write-once and unreadable; every download is a short-lived V4 signed URL minted
by `getAttachmentUrl` after it re-checks board membership. Any active board
member may remove one, through `deleteAttachment` — which also deletes the
bytes, since a client cannot.

**A file is named before it uploads, never after** (added 2026-08-15). Picking a
file opens a sheet with its name in a field, its size and kind beside it, and an
Upload button. The timing is not a preference: the document IS the
authorization, and clients may never update it, so the gap between the pick and
the `setDoc` is the only place a name can be chosen at all. Renaming an
already-uploaded file would need a new callable, an object-metadata rewrite and
an activity type, and was declined.

**The extension is shown but not editable.** It is what the row reports as the
file's kind, what the browser downloads the file as, what `attachmentCacheName`
writes to disk on Android, and what `ACTION_VIEW` and the share sheet read to
choose a viewer — editing it away produces an unopenable file that still looks
right in the list. `splitAttachmentName` in `@sabeel/shared` is the single
definition of where a name ends and its suffix begins, shared with the kind
badge and with the truncation inside `sanitizeAttachmentName`; two definitions
would silently disagree. The sheet also owns the 10 MB check, which used to fire
*after* the pick as an error and now states a fact about the file before
anything is written.

**Why cards are a TOP-LEVEL collection (a `boardId` field, not a subcollection of
the board):** it makes a cross-board MOVE a single `boardId` update — comments and
activity ride along under the same card doc — instead of delete-from-A +
recreate-in-B. That lets any board MEMBER move a card (a move is an edit, not a
delete) and turns "My Work" into a plain collection query. The rules resolve each
card's board FROM its `boardId` and check membership there; `boardId` is
mutable-but-constrained — a move may change it, but only to a board the caller is a
member of, with a column and assignees valid for that board.

Note that `memberRoles` from the earlier draft is **gone** — with org-wide roles,
`memberUids` alone is enough.

### Ordering

Ranks are **base-62 strings**, not floats. Floats exhaust double precision after
roughly 50 consecutive inserts at the same position, which a busy column reaches;
strings can always be subdivided. `rankBetween(a, b)` lives in `@sabeel/shared`
with property-based tests, and is the only place that math exists.

Moving a card = one write to that card: `{ columnId, rank }`. Two people dragging
in the same column touch different documents and both succeed. A rare rank
collision is cosmetic (two cards tie, order breaks by cardId) and is healed by a
lazy re-rank of the column, never by blocking the user.

### Dates are strings, not timestamps

`dueDate` is a `'YYYY-MM-DD'` string. A timestamp would silently drift across
timezones — a card due "the 5th" must read as the 5th for everyone, and storing an
instant guarantees it eventually reads as the 4th for somebody. Strings make that
class of bug impossible. Comparison and sorting are lexicographic and therefore
free. A single `ORG_TIMEZONE` constant in `@sabeel/shared` defines what "today"
means for overdue highlighting and due-soon reminders; it is the **only** timezone
concept in the app.

## Cross-board "My Work"

This is the phone's default landing screen and the main reason the app beats
opening five boards in turn. Since cards are a top-level collection, it is a plain
**Firestore collection query**:

```ts
collection('cards')
  .where('assigneeUids', 'array-contains', uid)
// `archived` is filtered client-side, so this needs only the automatic
// single-field array-contains index — no composite index at all.
```

Two things follow, and both are why this had to be decided before the card model
was settled rather than bolted on later:

**1. Assignees must be board members (rules-enforced).** The read rule's assignee
arm keys on the card itself — you may read a card if you are in its `assigneeUids`
— so the My Work query needs no parent-board lookup at all. That is only coherent
if assignment implies membership, so a write adding someone to `assigneeUids` is
rejected unless they are in that card's board's `memberUids` (the rule resolves the
board from the card's `boardId`).

This constraint pays for itself twice. It also means **every board named in My
Work is already a board the user belongs to**, so the client has all the board
names from its own board list. No `boardName` denormalized onto every card, and no
fan-out trigger rewriting thousands of cards when a board is renamed.

**2. Removing someone from a board must unassign them.** Otherwise their read
access to those cards survives via the assignee rule. Board-member removal is
therefore a **callable**, not a raw client write: it removes the uid from
`memberUids` and strips it from every card's `assigneeUids` in one batch, and the
UI warns how many cards will be unassigned.

Required indexes (all COLLECTION scope on the top-level `cards`): `(boardId,
archived, rank)` for the board view, `(boardId, assigneeUids array-contains)` for
board-member removal, `(boardId, subscriberUids array-contains)` for the
unsubscribe half of that same removal, and `(archived, dueDate)` for the due-soon
sweep. My Work itself needs only the automatic single-field array-contains
indexes on `assigneeUids` and `subscriberUids`.
The emulator does not enforce composite indexes — verify in production (see
`docs/INHERITED-STACK.md`, lesson 6, and `scripts/probe-indexes.mjs`).

## Rich text (2026-07-30)

**Five elements: bold, italic, bullet list, ordered list, link.** Nothing else —
no headings, code, quotes, underline, strikethrough, tables or checklists, and no
images because attachments already cover those.

The vocabulary is small on evidence, not taste. Measured across every production
description and comment: **zero hand-typed markup**, and the only structure
people actually produce is paragraphs, a handful of lists and bare URLs. A small
vocabulary is also what makes the round trip provable, which is the thing this
decision turns on.

**Markdown is the storage format and nobody sees it.** Both editors are WYSIWYG
with a toolbar, which answers the 2026-07-20 objection directly rather than
overruling it: the team never learns syntax.

**A platform seam, and only for the editor.** Lexical on web,
`react-native-enriched-html` on Android — each used only where it is strongest,
and note the *experimental* part of the native library is its web support, which
is never loaded. The renderer, toolbar, mention policy and the markdown↔HTML
converter are shared. `RichText` must never gain a `.web` sibling: two surfaces
disagreeing about what a card says is the one thing a shared board cannot
tolerate.

**Escaping decides correctness.** Typing `2 * 3 * 4` stores `2 \* 3 \* 4` and
renders as literal asterisks. The escape set is exactly the parse set, and the
criterion is not the list but the property `parseRich(serializeRich(doc)) ===
doc`, enforced by seeded fuzz over documents full of awkward literals.

**Autolinking is render-time only**, so storage keeps what was typed and a phone
and a browser cannot diverge.

**Accepted residuals.** A hardware Ctrl+U on Android can set underline, markdown
cannot express it, and the converter drops it — the text visibly un-underlines,
and the library exposes no opt-out. Link TEXT is searchable; link TARGETS are
not. Legacy content re-renders by decision: `  - ` lines from the ClickUp import
became real bullets and bare URLs became tappable, verified first against all
103 production strings with zero words lost.

## Superseded: why plain text was chosen (2026-07-20)

**Descriptions and comments are plain text.** No markdown rendering, no syntax
hints, no rich-text editor. What someone types is what everyone sees.

Faisal called this after the alternatives were costed. The team will not learn
markdown syntax, so a markdown editor was never going to be *their* editor — it
was ours. A true rich-text editor means a web editor (Lexical being the
strongest, with first-party markdown), which on Android means a WebView; that is
a real and defensible option, but not one worth spending on before anyone has
asked for formatting.

The renderer and parser were **deleted rather than disabled**. Code that still
works invites someone to switch it back on without revisiting the reasoning.
`docs/RESEARCH-RICH-TEXT.md` keeps the analysis, so reopening this costs a
decision rather than a fresh investigation.

Revisit on an explicit request from the team, or during a deliberate refactor.

## Superseded: why markdown was chosen originally

Researched 2026-07-19, because "rich text is solved in React" deserved checking.

- **On web it is solved** — TipTap, Lexical, Slate and Quill all have first-class
  React 19 support.
- **On React Native it is not.** Expo's own documentation states there is "no
  one-size-fits-all solution for rich text editing in React Native" and that "no
  widely used packages exist". TipTap's maintainers say ProseMirror will not
  support RN natively, since it depends on browser DOM observers.
- Every viable native option therefore runs the editor **in a WebView**
  (`@10play/tentap-editor`, `react-native-cn-quill`, or Expo DOM components).
  Expo documents this as carrying "a performance and UX penalty", and DOM
  components add async-only function props, no `children`, and no OTA updates.
- `react-native-enriched-html` is genuinely native and good, but has **no web
  support** — disqualifying, since web is a first-class surface here.

So the choice was not "hard to build" but "the phone's editor is a browser inside
an app, forever". Markdown in a native `TextInput` keeps every surface native. A
formatting toolbar (bold, italic, list, link, heading) inserts the syntax so
nobody types `**` by hand, and the rendered view is what people mostly look at.

Storage is the markdown **source string**. It searches directly, diffs cleanly,
imports from ClickUp without fidelity games, and — importantly — remains readable
by a TipTap-based editor if this decision is ever revisited. Render with a
markdown component on both platforms; **sanitize on render** and never allow raw
HTML through.

## Search

Firestore has no full-text search, and adding Algolia/Typesense would mean a third
-party service, a sync pipeline and ongoing cost — exactly the machinery this
project exists to avoid. So search is **client-side, scoped to the boards you
belong to**:

- **One `boardId in [...]` query per 30 boards**, not one per board — the
  30-value ceiling on `in` is the only reason it chunks at all. Archived cards
  are excluded *server-side* unless the Archived filter asks for them, so the
  common case fetches strictly less rather than fetching everything and
  filtering.
- Matching is case-insensitive substring on title and description, in memory, so
  typing re-filters without re-reading.
- The persistent local cache makes repeat searches essentially free and lets
  search work offline over boards already visited.
- Honest limits: it matches substrings, not stems or fuzzy spellings, and it costs
  reads proportional to your card count. Fine for a few thousand cards across
  <50 people. **Revisit past roughly 10,000 cards** — at that point the answer is
  a proper search service, not a cleverer client.

**Search browses by default.** With nothing typed and nothing selected it lists
every card you can see, newest first. It used to show nothing until you typed,
which made the filters unreachable without inventing a query first.

**The filter set**, and why it is split across two rows: the *binary toggles* —
Archived and Overdue — stay one tap each, and everything with a LIST of values
lives behind a single `Filters` control rather than becoming four dropdowns
stacked above the results. Whatever is picked returns as a chip in the row
below, removable by the same gesture as everything else, so "what am I filtering
by?" is answered by one readable row. A clear-all icon appears only when
something is active — and the sheet carries its own copy of that control,
because the row is behind the modal while the sheet is open.

Inside the sheet the four sections are an **accordion, all closed on open, one
open at a time**, and the geometry decides that rather than taste: the sheet is
bounded to 80% of the viewport, which on a 320x568 phone leaves a body of about
334pt, and one open section — a narrowing field plus a capped list — is about
290. Exactly one fits. Two open would put a capped scroller inside a capped
scroller, and on iOS the inner one takes the gesture and does not chain. Each
header carries its own state (`Board: Fundraising 2026`, `Labels (2)`), so the
sheet says what is filtering without being expanded.

- **Priority is multi-select and offers all five values, `'none'` included.** It
  shipped as two chips, Urgent and High, which turned each other off — so "the
  things that matter" could not be asked for at all. `'none'` is a value (a card
  with no priority set), not the absence of a filter.
- **Board is single**, because a card carries exactly one and the question people
  ask is "just this board".
- **Labels are multi**, matching ANY.
- **Assigned to is single**, and its candidates are the union of the boards'
  `memberProfiles` — never `users/*`, which only admins may list, while Search is
  for everyone.

**Sorting is Best match / Newest first / Oldest first**, defaulting to Best
match, which is what Search has always done: rank by relevance when there is a
query, by recency when there is not. With an empty box Best match and Newest
first therefore agree exactly — correct, not a duplicate option; they diverge
only when there is something to be relevant to. Ordering happens in memory over
a set already fetched whole, so no index and no query change was involved, and
the 200-row render cap slices *after* the sort — "Oldest first" shows the 200
oldest rather than 200 arbitrary cards put in order.

"Last activity" means `max(lastActivityAt, updatedAt, createdAt)`.
`updatedAt` is client-written on a card EDIT and never moves for a comment or a
file, so **`lastActivityAt` is a trigger-owned field** bumped by the comment
trigger and the two attachment paths — all three already wrote to the card
document, so it is one more field in a write that was happening anyway. Rules
pin it exactly as `attachmentCount` is pinned. There was no backfill and no
index: a card without the field falls back, and `createdAt` is the floor so a
card missing both does not pin to an extreme of either direction. Editing a
comment is the one thing that does not move it — that path returns before the
trigger's write.

**Filters live in `app/src/viewState.ts`, not in the screen.** `App.tsx` renders
one screen per route, so opening a result unmounts Search; held in `useState`,
the whole search died on the way to a card and Back returned a blank screen.
Session-only, deliberately — a reload forgets, and so does signing out: every
view store registers itself so the next person on a shared device inherits
nothing.

**The keyboard is a width question, not a platform one.** Autofocus is
`Platform.OS === 'web' && isWide`. Keying it off the platform alone opened the
on-screen keyboard over the results in a *phone browser*, which is web too — and
is how a good part of this team uses the app.

## Bulk actions

Multi-select exists both for its own sake and because column deletion is blocked
until a column is empty — clearing a stale column of 40 cards must not be 40
separate gestures.

- **Web:** checkbox on card hover; click, then shift-click for a range.
- **Phone:** long-press a card to enter selection mode, then tap to add.
- Actions: **move to column**, **archive**, **delete**, **assign**.
- Writes go through a batch; a bulk move assigns fresh ranks so selection order is
  preserved at the destination.
- Delete asks for confirmation and names the count. Archive does not — it is
  reversible from the archive view.

## Offboarding a user

Disabling an account and removing someone from a board are **deliberately
separate actions** with different consequences:

- **Disable** (admin, org-wide): the user can no longer sign in. Their card
  assignments **stay** — nothing silently loses its owner. They render greyed with
  an "inactive" marker wherever they appear, and a board's owners get a review
  list of that person's open cards to reassign at their own pace. Disabling
  **warns** the admin if the person is the only owner of some board, naming them,
  and then proceeds: not being able to disable a departing colleague until every
  board they touched had been reassigned is the wrong way round.
- **Remove from board** (that board's owners, or an admin): strips them from
  `memberUids` **and** `boardOwnerUids` **and** unassigns them from that board's
  cards, because the assignee read-rule would otherwise leave them access. This is
  the callable described under My Work. Clearing ownership matters because
  `addBoardMember` only touches `memberUids` — left behind, re-adding the person
  later would silently restore their authority.

The two stay consistent: a disabled user is still a board member, so the
"assignees must be board members" invariant holds. They simply cannot read
anything, since every rule requires `status == 'active'`.

**How "immediately" is actually achieved, and its one residual.** Rules read
`status` off the **token**, and a claims change does not evict a live session, so
`setUserAccess` calls `revokeRefreshTokens` whenever a status moves to `disabled`
or `rejected` — without it a disabled user keeps working until their token
expires. Two things then happen: they can never mint a new token, and the client
flips to the "Account disabled" screen at once, because the app subscribes to the
mirrored user document rather than waiting on the token.

The residual: the ID token **already in memory** stays cryptographically valid
until it expires, up to an hour, and Firestore rules do not check revocation. The
app is closed to them instantly; a determined ex-user holding a raw token could
still reach the API for that hour. Same shape and same reasoning as the signed-URL
residual under Attachments — acceptable for a dozen colleagues, not for untrusted
users. If that ever changes, the fix is a `claimsUpdatedAt`/`auth_time`
comparison in rules, not a shorter token life.

## Board list and navigation

With no board cap, the list is the thing that degrades first. Structure without
curation overhead:

1. **Favorites** — user-starred, pinned to the top (`favoriteBoardIds`).
2. **Recents** — last 10 opened (`recentBoardIds`, on the user doc so it syncs
   between phone and web).
3. **Everything else** — alphabetical, with a filter box.

No folders or groups: they need curation, a permission story of their own, and a
second tree to navigate on a phone. Revisit only if the team passes ~50 boards and
the flat list genuinely hurts.

On mobile this is the board-switcher bottom sheet; on web, the sidebar.

## Theming

**The palette is the Sabeel Institute brand palette** — see `docs/BRAND.md`, the
authority (the designer's Option 1 revision; the JPG guide at
`docs/brand/sabeel-color-usage-guide.jpg` is superseded). Warm Ivory is
the foundation, Soft Sage the calm secondary, Dark Raspberry the brand identity
used with purpose for key actions and headings, Antique Gold sparingly for
accents, Mushroom Taupe for support. Consult the guide before any color decision.

Two documented departures live in `docs/BRAND.md`: body text uses a darkened
taupe (the specified Mushroom Taupe fails WCAG AA on ivory), and the dark palette
defines none.

**Single light theme — no dark mode** (decided 2026-07-21). The app pins
`userInterfaceStyle: "light"`; a derived dark palette existed and was removed.

Every color goes through semantic tokens (`bg.surface`, `text.muted`,
`border.subtle`, `priority.high`) — no screen holds a raw hex, enforced by
ESLint. There is no dark mode, but the discipline still earns its keep: the brand
palette lives in one file, so the Option 1 refresh was a single-file change, and
a future re-theme (or a dark mode, if that decision is ever reversed) stays one.
Label colors are the one user-chosen palette, so pick swatches that stay legible
on the warm-ivory surfaces.

## Activity history

A Firestore trigger on card writes diffs before/after and appends one entry per
change to `cards/{id}/activity`. Shown on the card detail screen below the
comments, newest first.

- Clients cannot write activity at all — the log is trustworthy by construction.
- Field edits that carry no meaning for others (rank-only changes from a reorder)
  are **not** logged; a column change is. Otherwise a busy board's history is
  100% noise and nobody reads it.
- Retention matches cards: kept indefinitely.

### A board's own history

At the bottom of Board settings, for everyone who can see the board: who
created it, renamed it, archived or restored it, added or removed whom, made
or unmade an owner, and added, removed, renamed or reordered its columns.

- **One writer.** The `onBoardWritten` trigger diffs every board write
  (`diffBoard` in `@sabeel/shared`) into `boards/{id}/activity`. Client edits
  and the member callables both land as board writes, so neither writes
  history itself. Removing an owner from the board is one entry, not a
  removal plus a lost ownership.
- **Who did it is the `updatedBy`/`updatedAt` stamp**, and only when the
  write moved it (`boardChangeActor`). Rules accept a new stamp only from the
  person it names, or a write that leaves the stamp alone. The second is for
  app builds older than the history, so their changes save and are recorded
  with nobody named. A new board names its creator.
- **Names are stored on the entry**: a member can read only the board's own
  profiles, and the people a history is about — someone removed, an admin
  not on the board, a deleted column — would resolve to nothing later.
- **Entries from before the history** were recovered once, with
  `since`/`at` bounding when each happened: from the daily backups, the
  point-in-time window and the member callables' logs. The logs name who
  added or removed someone; nothing else from that time records who made a
  change, so those entries name nobody.
- Entry ids come from the event id, so a repeated delivery overwrites rather
  than duplicates.

## Rules invariants

Deny-by-default.

- Board READ requires `status == 'active'` **and** (`role == 'admin'` or
  `uid in board.memberUids`).
- Board WRITE requires that **and** `uid in board.boardOwnerUids` — admins
  excepted. `.get('boardOwnerUids', [])`, never plain access: a board written
  before the field existed would otherwise error the rule, and an erroring rule
  denies.
- A board update may not remove `board.createdBy` from `boardOwnerUids` **or from
  `memberUids`** unless the caller is an admin — authority is the pair, so either
  removal unseats them. Phrased on the CHANGE, so a board whose creator an admin
  has already demoted stays editable.
- A board update may not SHORTEN `memberUids` at all (admins excepted). Removal
  is `removeBoardMember`, which also clears assignments and subscriptions; a
  client-side removal would leave those behind and the card read rule's assignee
  arm would keep handing the removed person access.
- A board CREATE must set `boardOwnerUids == [request.auth.uid]`. Deliberate: it
  turns "an app too old to know about ownership made a board nobody can manage"
  from silent and permanent into a visible failure.
- A column may not be removed from `board.columns` while any card references it.
- **Card delete requires ownership of that card's board.** Members may only set
  `archived: true`. Applies to bulk operations identically.
- `users/{uid}/notifications` is trigger-written; the client may only flip `read`.
- Board create: `role in [organizer, admin]`. Settings, membership, ownership and
  archive: ownership of that board.
- `columnId` on a card must match a column that exists on the board — clients
  cannot invent columns.
- **Every uid in a card's `assigneeUids` must be in the parent board's
  `memberUids`.** Load-bearing for My Work — see above.
- **The same is true of `subscriberUids`**, and for a sharper reason: the read
  rule has a subscriber arm too, so subscribing IS a grant of read. Without the
  membership rule, adding your own uid to any card whose id you learned would be
  a way into a board you are not on. `removeBoardMember` clears it alongside
  `assigneeUids`, a cross-board move filters it, and a copy starts without it.
- A card is also readable by anyone in its own `assigneeUids` or
  `subscriberUids`, which is what makes both cross-board queries legal without a
  parent lookup. Neither arm widens access — both lists are constrained to board
  members, so anyone matching could already read the card through membership.
  What they buy is a query that needs no per-row board read.
- No client may write their own `role` or `status`; both are claims, set only by
  the admin-only `setUserAccess` callable.
- Comment `authorUid` must equal `request.auth.uid`; edits restricted to the
  author; deletes to the author, an owner of that board, or an admin.
- **`activity` is read-only to all clients** — trigger-written only. So is
  a board's history, `boards/{id}/activity`, which its members and admins
  read.

## Notifications

Push via FCM (`expo-notifications`), with a **per-user preference toggle for every
event type** and a **per-board mute**. Notification noise is the fastest way for
this app to become as annoying as the thing it replaced, so the default set is
deliberately small:

| Event | Who gets it | Default |
|---|---|---|
| You were @mentioned in a comment | the mentioned user | on |
| A card was assigned to you | the new assignee | on |
| A comment on a card assigned to you | the assignees | on |
| A card assigned to you is due soon | the assignees | on |
| A card assigned to you was moved | the assignees | **off** |
| A new user is awaiting approval | all admins | on |

Everything is opt-out per event, plus mute-this-board (`mutedBoardIds` on the user
doc). Nothing notifies the actor about their own action. **Confirm this list
before the notifications phase** — it's the one area where I've proposed rather
than been told.

**Delivery is push + an in-app inbox.** Every notification is written to
`users/{uid}/notifications` by the same trigger that sends the push, so a
dismissed or missed push is never lost — there's a badge and a list. The client
may only flip `read`; it can neither create nor edit entries.

**A push shows whether the app is in the foreground, the background or closed,
on both surfaces** (decided 2026-09-17). Until then a push arriving at a focused
browser tab drew nothing, by design, on the argument that the Alerts badge was
already moving in front of the person; the decision reverses that. On Android the
app's notification handler already presented a foreground push; on web the
service worker now shows every push itself rather than letting the Firebase
SDK's worker hand a focused tab's push to a page that never drew it.

There are no watchers: you are notified because a card is assigned to you or
someone @mentioned you. Anyone wanting to track a card subscribes to its comments,
or assigns themselves alongside the doer.

Due-soon timing and timezone need a decision at Phase 8. The time tracker's
work-local timezone machinery is deliberately NOT being copied; due dates are
expected to be all-day dates in a single org timezone.

## Offline

"Offline depth" means: how much still works with no signal, and what happens to
edits made while offline.

- **Web (v1):** Firestore's persistent local cache (IndexedDB), with the
  multi-tab manager. A board opened before losing signal still renders after a
  reload, and queued writes survive.
- **Android (v1): memory cache only — corrected 2026-07-19.** The earlier plan
  said "persistent cache on both surfaces"; that is **not achievable** with the
  Firebase JS SDK on React Native, because `persistentLocalCache` requires
  IndexedDB and React Native has none. So on Android, offline means "keeps
  working while the app stays open, and syncs queued writes on reconnect" — it
  does **not** survive an app restart.

  Auth persistence *is* handled (AsyncStorage), so people stay signed in across
  restarts; it is only the Firestore cache that is in-memory.

  If restart-surviving offline on Android becomes a real requirement, the honest
  options are react-native-firebase (a native SDK with real persistence, but it
  has no web support, so it would mean two Firebase clients) or a local mirror of
  our own. Both are big; neither is worth doing before the team reports needing it.
- **Not in v1:** a conflict-resolution UI. If two people edit the same card while
  one is offline, last-write-wins silently. For a <50-person team with
  card-per-document granularity this is very unlikely to bite; building a merge UI
  before anyone has hit the problem is exactly the bloat we're avoiding.

## Mobile design (the differentiating surface)

```
┌─────────────────────┐
│  Board ▾      ⚙ 🔍  │   board switcher, settings, search
├─────────────────────┤
│  ◀  In Progress  ▶  │   swipe or tap arrows between columns
│      (2 of 5)       │   position indicator
├─────────────────────┤
│ ┌─────────────────┐ │
│ │ Fix signup flow │ │   full-width card: title, priority dot,
│ │ 🔴 Fri  @faisal │ │   due date, assignee avatars
│ └─────────────────┘ │
│ ┌─────────────────┐ │
│ │ Draft newsletter│ │
│ │ 🟡 Mon  @sara   │ │
│ └─────────────────┘ │
│         + Add       │
└─────────────────────┘
```

- **Swipe horizontally** to change column; the column header shows position so the
  board's shape stays legible.
- **Card move** is a "Move to…" sheet from the card (long-press or detail screen),
  not a drag — dragging across a swipe-paged surface is ambiguous and error-prone.
- **Reorder within a column** is a long-press drag on the vertical list only.
- Card detail is a **full screen**, not a modal; comments live at the bottom of it.
- Board switcher is a bottom sheet listing the user's boards.

## Phases

Full detail, scope and exit criteria live in **`docs/PHASE_STATUS.md`**, which is
also the live build tracker. Summary:

| Phase | What |
|---|---|
| 0 | Monorepo scaffold, CI green, semantic theme tokens (single light theme), hello screen both surfaces |
| 1 | Google auth (domain-restricted) + admin approval + role management |
| 2 | Boards: CRUD, membership, rules + rules tests |
| 3 | Columns + cards: create, edit, move, `rankBetween`, web drag-and-drop |
| 4 | Mobile board: swipe columns, move sheet, card detail screen |
| 5 | Card richness: plain-text description, assignees, due date, priority, labels |
| 6 | **My Work** cross-board view + collection-group index |
| 7 | Multi-select + bulk actions |
| 8 | Comments + @mentions |
| 9 | Activity history |
| 10 | Push notifications + in-app inbox + preferences |
| 11 | Global search + filters + archive view |
| 12 | Polish, user manual, deploy readiness |
| 13 | First production deploy |
| 14 | ClickUp import into production, then open the app to the team |

Phases 3–4 are the technical core; do not let later phases start until card
ordering is correct under concurrent edits **and tested under injected latency**
(see `docs/INHERITED-STACK.md`, lesson 5 — this is precisely the bug shape that
burned the time tracker).

Note the ordering fix: the ClickUp import runs **after** the production deploy,
against the real project, and **before** the team is onboarded — it needs somewhere
real to write, and it must not race live user activity.

## Migration from ClickUp

A **one-time, dev-side, human-in-the-loop** tool — `scripts/import-clickup.mjs`.
It runs as a **setup step before the app is opened to users**, so it never has to
reconcile against live data, and it never ships in the app.

The mapping is genuinely fuzzy: ClickUp usernames won't match Google accounts,
board and list names are getting renamed as part of the move, and statuses map
imperfectly onto columns. So the import runs in three stages:

1. **Extract** — Faisal exports from ClickUp (CSV or API). The script reads it and
   emits a `migration/mapping.json`: every distinct ClickUp user, list, status and
   board name it found, each with a proposed target and a confidence note.
2. **Reconcile** — Claude proposes the fuzzy mappings (user → `@oursabeel.com`
   account, ClickUp list → board name, status → column), Faisal reviews and edits
   the file. This is a conversation, not an algorithm. Unmapped entries are hard
   errors, not silent drops.
3. **Apply** — the script writes to Firestore via the Admin SDK. **Dry-run by
   default** (`--apply` to commit), idempotent via a stable `sourceId` on each
   imported card so a re-run updates rather than duplicates.

Cards import with their title, description, assignees, due date, priority and
comments where the export carries them. ClickUp attachments are not imported —
the export does not carry the files themselves.
Anything the script cannot map is reported, never guessed at.

## Stats (added 2026-07-28)

An ADMIN-ONLY screen showing how the boards are actually used (narrowed
2026-08-16 — it used to be managers too, which was safe only while a manager could
already open every board; once that stopped being true, this screen became a way
to read any board's activity by id without being on it): cards
created, cards archived, comments, active people, files added and files removed —
one metric at a time, as a bar chart bucketed by day, calendar week (Sunday to
Saturday) or calendar month, filterable to one board or all of them. Plus a
headline figure for attachment bytes currently stored. History is kept for good.

**Counting happens at event time, not in a nightly job**, and that is the whole
design. The alternative — sweep yesterday at midnight and store the totals — was
considered and dropped for three reasons:

1. **A sweep cannot see a removal.** The attachment document is deleted when the
   file is removed, so by midnight there is nothing left to count. Only counting
   as it happens sees it at all.
2. **It deletes the live/historical split.** Incremented on write, today's bucket
   is already correct, so there is no second code path for "the current day" and
   no way for the two to disagree.
3. **The volume never justified it.** Measured: about 7.5 events a day across the
   whole organisation. Counting costs roughly 16 extra small writes a day.

**A counter must never be able to damage, block or duplicate the thing it
counts.** `recordStat` therefore runs after the primary work has committed and
never rejects — because `guardedEvent` rethrows, so a throw inside a trigger
retries it, and `onCardWritten` writes activity with generated ids, meaning a
retry would write a SECOND copy of a card's history rather than repair anything.
On the attachment paths the counter sits inside the existing winner-only
transaction branches, beside `bumpAttachmentCount`, so a double tap or a retried
finalize cannot count a file twice.

**Data model.** `stats/{scope}/months/{YYYY-MM}` where scope is a board id or the
org-wide `_all`; every event writes both, so "all boards" is one read path rather
than a fan-in over eighteen. A month per document means a year of history is 12
reads and stays 12. Active people is stored as a uid ARRAY, not a count, because
a distinct count cannot be derived from sums. Day keys are computed in
`ORG_TIMEZONE` — a UTC key would file an evening's work under the next day.
`days` is exempted from indexing in `firestore.indexes.json`: Firestore
recursively indexes map subfields, which would put ~250 unused index entries on
the most frequently written document in the system.

**Two accepted residuals.** Firestore triggers are at-least-once, so a retry can
double-count; that is tolerable only because `scripts/backfill-stats.mjs` can
rebuild any range exactly from the source documents, which all still exist. The
exception is `bytesRemoved`: the activity log records that a file was detached
and its name, not its size, so that one series is forward-only and cannot be
reconstructed. The backfill therefore **preserves** any `bytesRemoved` already
recorded on a day it rebuilds rather than resetting it — a repair tool that
destroys the only series with no other source is not a repair tool, and it would
do so quietly, because every other number would move and it would look like the
repair working.

**The day a deploy lands is a hole, once.** The backfill never writes the current
day (the live triggers own it), so on the day counting first starts, events
before the deploy are recorded by neither. Re-running on any later day rebuilds
it from source. This cannot recur: from the following midnight the triggers cover
every day in full, so "skip today" costs nothing thereafter.

**Selecting a bar breaks it down** (added 2026-08-15), and only while one is
selected — with nothing selected the same panel would have to cover the whole
loaded year, a different question and a fan-out of reads nobody asked for. It
answers one of two questions depending on the metric:

- **Active people answers WHO.** `actors` is a uid array rather than a count, so
  the people are already in hand and the panel costs no read at all. Names come
  from the boards' `memberProfiles`, which are already loaded, rather than from
  a second query against `users/*` — which means it misses routinely rather than
  exceptionally (an admin acting on a board they are not a member of, anyone
  removed from a board since) and falls back to a placeholder rather than
  pretending.
- **Everything else answers WHERE** — boards ranked by that metric, biggest
  first, each a way through to the board. Every event already writes both the
  board scope and `_all` in one batch, so the rows sum to the bar by
  construction, and a shortfall means a board this reader cannot see or name.
  That is shown as an explicit unattributed row rather than quietly dropped.

The reads are one document per board per month the bucket spans (about 36 for a
day bucket across eighteen boards), cached by scope and month, and **none at all
when the screen is already scoped to one board** — that scope is subscribed
already. The month in progress is never cached, because the chart is live
specifically so today's bar moves, and a frozen breakdown under a moving bar is
the worst kind of wrong. A `collectionGroup` query would be one round trip
instead of N, and `scope`/`month` are denormalised for exactly that shape, but
the rules nest `months` inside `stats/{scope}` and would need a recursive
wildcard — not a rule worth widening at this size.

The same change fixed a real defect the panel exposed: the period figure was
`points.reduce((s, p) => s + p.value, 0)`, right for every counter and wrong for
active people, where it summed sixty daily DISTINCT counts. It is now the same
`valueBetween` each bar uses, so it unions.

**Imports do NOT show as spikes, and this was checked rather than assumed.** The
first version of this screen carried a caveat saying they did, on the strength of
a 45-card day (2026-07-25) that looked like a bulk write. It was not one: those
cards carry no `sourceId`, have 45 distinct `createdAt` instants spread over nine
hours, and were made by three different people. It was simply a busy day. The
real ClickUp imports are 19 cards spread over six days, the largest being nine,
each with its own timestamp.

The caveat was removed, because it was worse than useless — it told the team to
discount their most productive day as an artifact. Imported cards are still
counted on the day they were written, and still not filtered out, since board
card counts and these numbers have to agree.

## Open questions

- ~~**Notification event list**~~ — **settled and shipped.** `myCardMoved` is
  off by default because it fires constantly on a busy board; that is also why
  subscribing to a card was later narrowed to its *comments* rather than adding
  ten more triggers beside it.
- ~~**Due-soon timing**~~ — **settled.** `dueSoonReminders` runs on `0 8 * * *`
  in `ORG_TIMEZONE`, which is `America/Chicago` (Houston, where the team is —
  not the sibling time-tracker's, which deliberately has no org timezone at all).
- **Board privacy from admins** — currently impossible by design. Privacy from
  everyone else arrived on 2026-08-16; the admin exception remains. Flagged in
  case the team has a board that needs it.
- **Duplicating a board / board templates** — worth it if the nonprofit runs
  repeating programs with the same column structure. Not currently planned.

## Small calls made without asking

Reversible, low-stakes, and not worth a round trip — flag any you dislike:

- **New boards start with To Do / In Progress / Done**, all renameable and
  removable. A blank board is a worse first run than a wrong-but-editable one.
- **Priorities are none / low / medium / high / urgent**, shown on the card face
  as a small coloured badge carrying the word (*Urgent*, *High*, …) and never as
  a sort default. A bare dot was the original call and was dropped: a colour
  alone is unreadable to anyone who cannot separate the hues, and it forces a
  legend nobody has. *none* shows no badge at all.
- **Boards are archived, never hard-deleted.** Archiving hides a board from
  everyone's list and is admin-reversible; a board is far too much accumulated
  work to expose a destroy button for. (Cards are different — they're small, and
  a bad import needs purging.)
- **Comments are editable by their author, deletable by the author, an owner of
  the board, or an admin**, with an "edited" marker.
- **No @channel / @board-wide mention.** Mentions target individuals only.
