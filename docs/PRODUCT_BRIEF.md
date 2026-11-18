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
  this?" No integrations, no automations, no Gantt/calendar/list view
  alternates, no time tracking (that lives in the sibling time-tracker app).
  There is one board view; a board's **lanes** are part of it, and a board that
  does not switch them on looks and behaves exactly as it would without them.
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
| Card subscriptions | **Everything on the card** (2026-11-02, widening the comments-only subscriptions of 2026-07-28). A subscriber hears about every comment and every change the card's history records. The creator is subscribed from the start (a bell beside the new card's title, on unless they turn it off), and anyone on the board may subscribe or unsubscribe with its bell. Assignees hear the same without being subscribed; subscribing as well keeps the interest after they are unassigned. See "Notifications". |
| Labels | **Two scopes** (2026-11-07). **Institute labels** are on every board, and only admins add, rename, recolour or delete them, in More → Labels. **A board's own labels** are on that board alone, and anyone on it changes them. A cross-board move or copy carries institute labels and leaves board labels behind. |
| Description format | **Markdown, restricted to five elements** — bold, italic, bullet list, ordered list, link (changed 2026-07-30). Both editors are WYSIWYG, so markdown is storage the user never sees. See "Rich text". |
| Search | **Global across the boards you belong to**, client-side matching. See "Search". |
| Notifications | Push **plus an in-app inbox** with an unread badge. |
| Column watching | **Arrivals only** (2026-11-02). A board member may watch a column and is told when a card arrives in it: moved in, created in it, or restored into it. Watching a column does not subscribe you to its cards, and a card leaving a column notifies no one. |
| WIP limits | **None.** Dropped from the model. |
| Column deletion | **Blocked until the column is empty**, made painless by multi-select bulk actions. |
| Bulk actions | **Multi-select cards** → move, archive, delete, assign. |
| Board list | **Favorites + recents**, then everything else alphabetically. No folders. |
| Card deletion | Members **archive** only. Permanent **delete is the board's owners and admins**. |
| Offboarding | A disabled user **keeps their assignments**, rendered as inactive; a board's owners get a review list to reassign. Disabling **warns** if the person solely owns a board, and proceeds anyway. |
| Theming | **Single light theme, no dark mode** (decided 2026-07-21). Semantic tokens throughout, so a re-theme stays a one-file change. |
| Subtasks | A card may be a **subtask of one other card on the same board** (`parentId` on the child). The parent's detail view lists them and links straight through; the child shows "Subtask of". On a card's face (Faisal, 2026-11-14, the chips of three prototypes, because people were hand-labelling cards "Main Task" and "subtask" to see this on the board): the parent a grey chip with its count, the child one naming its parent (`parentTitles`), or "Subtask" where the parent is not among the cards loaded — archived, on another board after a move that left the child linked, or on a screen that loads no siblings (My Work, Search, the board's archive). A tile's accessible name says both (`cardTileName`). Deliberately NOT a checklist: a subtask is an ordinary card, with its own column, assignees and comments. Added 2026-07-25 — the ClickUp import had been faking it in description text. **`parentId` is an opaque string to the rules**: same-board is enforced by the picker, not by `firestore.rules`, which check only that it is a string under 200 chars. A child's read access comes from its OWN `boardId`, so a stale or cross-board link leaks nothing: it shows as a plain "Subtask" chip and a "Subtask of" line the child can unlink, never the other card's title. Do not add a rules lookup to "fix" this; it would cost a read on every card write to enforce something the UI already does and no one can exploit. |
| Template mark | **A board may be marked as a template** (2026-11-15), by its owners and admins on General. The mark does exactly two things: the board is listed under Templates with a badge, and it is left out of the overview. Cloning stays a long press on any board; a clone is never marked; its history opens with one line, "cloned from", and nothing else ties it to its source. |
| Details | **A board may carry details** (2026-11-15): a short list of typed fields (Text, Number, Date, Link, and the fixed Start date and End date), filled in on Board settings → Details. Everyone on the board reads them; its owners and admins change them. See "Details". |
| Lanes | **A board may be divided into lanes as well as columns** (2026-11-15), so a program board can stand in for a tracking spreadsheet. A switch on Board settings → Lanes, off by default; a card sits in one column and one lane. With lanes, one column holds **finished** cards: a lane's heading counts them, and a finished card is never late. See "Lanes". |
| Overview | **One screen of every program** (2026-11-15): a row per board with lanes, a mark per lane showing its state, boards with the same lanes under one heading, three orders either way, and boards each person may hide from their own. Opened from an icon in the Boards header, shown only to someone it has a board for. See "Overview". |
| Explicitly NOT in v1 | Checklists (as a separate item type — see Subtasks), dependencies, recurring cards, alternate board views, automations, integrations, guest/external access. |
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
| Add, rename, recolour or delete a **board's own** label (on a board they're on) | ✓ | ✓ | ✓ |
| Add, rename, recolour or delete an **institute** label | | | ✓ |
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
  notifyPrefs: { mention: bool, assigned: bool, comment: bool, … }
  mutedBoardIds: [boardId, …]
  watchedColumns: ['boardId/columnId', …]        # columns whose arrivals notify me; self-written,
                                                 # board membership checked when a notice is sent
  favoriteBoardIds: [boardId, …]
  recentBoardIds: [boardId, …]                   # client-maintained, capped at 10
  overviewSort?: start|created|late              # the overview's order; absent is start
  overviewReverse?: bool                         # that order the other way
  overviewHiddenBoardIds?: [boardId, …]          # boards hidden from my overview, at most 500
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
  lanesOn?: bool                                 # absent = off; off keeps `lanes` and every card's lane
  lanes?: [ { id, name } ]                       # at most 12 (LANES_MAX); order is the board's
  doneColumnId?                                  # the finished column, read only through `finishedColumnId`
  fields?: [ { id, name, type } ]                # details' fields, at most 20; type text|number|date|link|start|end
  details?: { fieldId: value }                   # every value a string; a date YYYY-MM-DD; no key = not set
  template?: bool                                # listed under Templates; never copied to a clone

boards/{boardId}/activity/{entryId}              # the board's own history
  type: created|renamed|archived|restored|memberAdded|memberRemoved|ownerAdded|ownerRemoved
        |columnAdded|columnRemoved|columnRenamed|columnsReordered
        |lanesOn|lanesOff|laneAdded|laneRemoved|laneRenamed|lanesReordered|finishedColumn
        |fieldAdded|fieldRemoved|fieldRenamed|fieldsReordered|detailChanged   # detailChanged carries `field`
        |templateOn|templateOff|cloned                # cloned: a clone's first line, written by cloneBoard
  at, actorUid?, actorName?, subjectUid?, subjectName?, from?, to?, since?
  # Written ONLY by the onBoardWritten trigger. Names are stored, not looked up.

labels/{labelId}                                 # one collection, two scopes
  boardId?                                       # absent: an INSTITUTE label, on every board, admins only
                                                 # present: that board's own; anyone on it; never changes
  name, color                                    # color from LABEL_COLORS; rules check the hex shape
  createdAt, createdBy                           # '' for those migrated from board arrays
                                                 # a COLLECTION, not an array: any member may add one, and
                                                 # two people appending to one array field is a lost write

cards/{cardId}                                   # TOP-LEVEL collection; keyed to a board by a FIELD
  boardId                                        # which board this card is on — client-supplied, rule-validated, changed by a cross-board move
  title, description                             # title is plain; description is MARKDOWN, five elements only
                                                 # `packages/shared/src/richtext.ts` is the one definition
  columnId, rank: string
  assigneeUids: [uid, …]                         # MUST be members of boardId's board (rule-enforced)
  subscriberUids: [uid, …]                       # subscribers: every comment and change. SAME membership rule, and for a
                                                 # sharper reason: the read rule has a subscriber arm, so this grants read
  dueDate?: string                               # 'YYYY-MM-DD' — an all-day date, NOT a timestamp
  priority: none|low|med|high|urgent
  labelIds: [id, …], archived: bool, archivedAt?  # ids into labels/*; a cross-board move keeps institute ones only
  commentCount                                   # denormalized for the card face
  parentId?                                      # the card this is a SUBTASK of — lives on the child, so the parent's list is derived
                                                 # board-scoped by convention (a cross-board move clears it); rules validate shape only
  laneId?                                        # the card's lane; absent = No lane. Shape-checked only, NEVER required:
                                                 # an id that matches no lane is drawn under No lane. A cross-board move clears it
  createdAt/By, updatedAt/By

cards/{cardId}/comments/{commentId}              # under the CARD, so they travel with a move
  authorUid, body, mentionUids: [uid, …], createdAt, editedAt?

cards/{cardId}/activity/{activityId}
  type: created|moved|assigned|unassigned|due|priority|labels|edited|archived
        |subtaskOf|subtask|attached|detached|lane
  actorUid, at, from?, to?
  # Written ONLY by the server (the card trigger, and the attachment callables
  # for the two file types). Clients have no write access at all, so the log
  # cannot be forged or edited.

pendingNotices/{cardId}                          # a card's changes waiting to be announced; one doc per card
  entries: { [activityId]: { type, actorUid, at, from?, to? } }
  # Server-only: no client reads or writes it. Every new activity entry lands
  # here, keyed by its id so a retried trigger cannot add it twice. The notice
  # sweep reads the whole (small) collection each minute, claims a doc that is
  # due by deleting it on an unchanged update time, then sends.
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
indexes on `assigneeUids` and `subscriberUids`, and column arrivals only the
automatic one on `users.watchedColumns`.
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

**A platform seam for the editor, and for the last step of drawing.** Lexical on
web, `react-native-enriched-html` on the phones, each used only where it is
strongest; the *experimental* part of the native library is its web support,
which is never loaded. The parse, toolbar, mention policy and the markdown↔HTML
converter are shared. `RichText` parses once and hands the same document to a
browser's `Text` blocks or a phone's single native text view (2026-11-07), which
exists because Android selection cannot cross views: drawn a block at a time,
Select all took one paragraph. Two surfaces disagreeing about what a card says
is the one thing a shared board cannot tolerate, which is why the parse is never
split.

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
4. **Templates** — boards marked as templates (2026-11-15), alphabetical, each
   with a badge, taken out before the others so a marked board is listed once.
   An archived template goes under Archived and keeps its badge.

No folders or groups: they need curation, a permission story of their own, and a
second tree to navigate on a phone. Revisit only if the team passes ~50 boards and
the flat list genuinely hurts.

On mobile this is the board-switcher bottom sheet; on web, the sidebar.

## Cloning a board (2026-11-13)

Programs that run again start from a **template board**: columns, the cards
for each step, their descriptions and the subtasks under them. On the boards
list, a **long-press** on a board (a **right-click** on a computer, where nobody
holds a mouse button) opens a sheet that asks for the clone's name, and Clone
opens the clone (Faisal, 2026-11-13: on the list, like a card's long-press, not
in Board settings). For anyone who cannot clone, the long-press is not wired at
all: no sheet and no message, and the press is an ordinary tap. On a phone a
screen reader offers it as a "Clone board" action on the row; on a computer the
keyboard's context-menu key (or Shift+F10) on a row does what a right-click
does. Once Clone is pressed the sheet stays until the clone answers — Cancel,
the backdrop, Back and Escape all wait — because a clone cannot be called back
and opens when it lands.

- **Organizers and admins**, on a board they can see (a member of it, or an
  admin), and not an archived one. A clone is a new board, so it takes what New
  board does; a member who wants one asks an organizer (Faisal, 2026-11-13).
- **The cloner is the only member and owner**, as on any new board.
- **What comes along:** the columns, in order; every OPEN card's title and
  description, in the same column and order; subtask links, each pointing at
  its parent's clone; the institute's labels on those cards; the board's
  description; the board's lanes, switched on or off as they were, under new
  ids, with each card's lane and the finished column; and its details' fields,
  under new ids, without their values. A card whose lane is gone on the source
  has none on the clone.
- **What stays behind:** archived cards, due dates, assignees, priorities,
  comments, history and attachments, and the template's own labels (Faisal,
  2026-11-13: institute labels only). A subtask whose parent is archived is
  cloned as an ordinary card.
- Each cloned card starts as a new card does: its history opening "created"
  by the cloner, and counted in Stats as created that day. **Subscribed** to
  every one only if the cloner turns on the sheet's bell, the new card's bell
  labelled "Subscribe to every card" — which starts **off**, unlike a new
  card's (Faisal, 2026-11-14: like creating all the cards, but a choice; a
  template can hold hundreds, and each would announce every change). The
  callable takes `subscribe` and treats it absent as off, so a 0.18.0 app,
  which offers no bell, clones without subscribing anyone.
- **One write, which keeps its own books.** The `cloneBoard` callable writes the
  board, every card and each card's "created" line in one transaction, so a
  clone exists whole or not at all; rules check a new card against its board as
  it stood before the write, so the client could not do it in one. The clone
  writes the board's `activeCardCount` with the cards and records Stats once,
  and its cards are stamped `SYSTEM_ACTOR`, which keeps the two counting
  triggers (`onCardWritten`, `onCardBoardCount`) out: left to them, every card
  would land as its own increment on the same board and Stats documents in the
  same second, more than Firestore sustains on one document. The other card
  triggers still run and have nothing to do, a clone assigning nobody and its
  new columns having no watchers; but each card's "created" line still waits
  as a pending notice, so a large clone holds other people's notices back by
  about one more sweep, a minute. Accepted.
- **Limits:** more than `CLONE_BOARD_MAX_CARDS` (240) open cards, or more than
  `CLONE_BOARD_MAX_BYTES` of text, is refused with a reason rather than cloned in
  parts — the first keeps the transaction inside Firestore's 500 writes, the
  second inside its 10 MiB, which counts bytes: Arabic and curly quotes are two
  or three a character.
- **Asking twice makes one clone.** The app picks the new board's id when it
  offers the clone and sends it with every try, so a retry after a clone that
  landed but whose answer was lost gets that board back rather than a second
  one, which nobody could delete. The answer names the board as it was made;
  when the person changed the name before trying again, the app renames it to
  the name of the try it is waiting on. Only the latest try's answer is acted
  on, so a late answer to an earlier one cannot undo that. Who follows the
  cards is not put right the same way, so the bell holds still once Clone has
  been pressed: it cannot show a choice the clone did not get.
- **The clone opens where it was asked for.** If the person has gone elsewhere
  while it was on its way (a notification tapped over the sheet), the clone
  waits in the boards list rather than being pushed on top of where they went.
  The same holds for New board.

`boardClone` in `@sabeel/shared` is the one statement of what a clone holds.

## Lanes (2026-11-15)

Decided by Faisal over a concept round on 2026-11-15, to let a program board
replace a program-tracking spreadsheet without adding typing or anything to
learn for boards that are not programs.

- **A lane is a name in Board settings → Lanes**, as a column is: an id and a
  name, renamed in place, dragged into order, removed only once it holds no
  open cards (`laneDeleteBlocked`), at most **12** on a board (`LANES_MAX`,
  restated in `firestore.rules` and held to it by `ruleLimits.test.ts`).
  Names are unique on a board, case-insensitively, checked by the app.
- **A switch, off by default.** Off, or on with no lane added, the board is
  drawn exactly as before (`lanesLive`). Off keeps the lanes and every card's
  lane, so on restores the board.
- **A card records its lane** (`laneId`). No lane, or a lane since removed, is
  drawn under **No lane**, last, in every column once any card on the board has
  none. A cross-board move or copy leaves the lane behind.
- **The finished column exists only on a board with live lanes.** It is chosen
  on the Lanes page and starts as the last column. Every column write keeps it
  pinned (`columnsPatch`): deleting it gives its place to the new last column,
  written and recorded in the board's history, and the delete's confirmation
  says which column that is. A stored column that is gone anyway, deleted by
  an app too old to know about lanes, falls back to the last
  (`finishedColumnId`). A card in it is **finished**
  (`isFinished`), and **a finished card is never late anywhere**: its face shows
  its date rather than how late it is, its card says nothing of Overdue, My
  Work files it under **Finished** (last), Search's Overdue chip leaves it out,
  and the 08:00 reminder skips it. A board without lanes has no finished column
  and is unchanged.
- **Each column lists every lane under one heading** (`LaneHeading`), on the
  phone, the browser and a tablet alike: the name and one badge, finished of
  total across every column, **green** when the lane is complete, **red** when
  an unfinished card is past its date, the ordinary text colour otherwise, "No
  cards" when empty. A lane keeps its heading in a column with none of its
  cards, so it holds its place from column to column. The wide board is not a
  swimlane grid: lanes do not line up across columns (decision A).
- **Add card asks for a lane** on a board with lanes, none chosen, and adds
  nothing until one is. A subtask starts in its parent's lane. A card's lane is
  a second choice beside its column on the card; No lane is offered only while
  the card has none. The selection bar's Move takes a column, a lane or both.
  On the browser a card dropped on a lane lands in it; a card with a lane is
  not dropped into No lane.
- **A lane change is in the card's history and its followers' notices**, like
  a column move ("moved it to the Marketing lane"). Sorting an existing board
  into lanes therefore sends one notice per card (decision B).
- **A lane's state** (`laneInfo`) counts every open card in it, dated or not;
  due dates decide only late and soon, through `bucketFor`. Archived cards do
  not count.
- **Not checked by the rules, on purpose.** A card in a column that does not
  exist vanishes from the board, which is why columns are checked against a
  `columnIds` mirror; a card naming a lane that does not exist is drawn under
  No lane and loses nothing, the same choice as `parentId`. So there is no
  `laneIds` mirror, the rules check `laneId`'s shape only, and they never
  require one: an app from before lanes keeps adding cards, which land under No
  lane. Lane names and lengths are the app's to keep, like a board's own labels.
- **A clone carries** whether lanes are on, the lanes (under new ids), each
  card's lane and the finished column.

## Details (2026-11-15)

Facts about what a board is for: its start date, the teachers, a meeting
link. Decided by Faisal with lanes, for program boards; a board that adds no
field has an empty Details page and nothing else changes.

- **A list of typed fields**, each a name, a type and a value: Text, Number,
  Date, Link, plus **Start date** and **End date**, which are dates with fixed
  names, one of each at most, and the only details anything else reads
  (`namedFieldValue`); no field of another type may take either name. A
  number takes commas only between groups of three (1,200), so "7,5" is
  refused rather than saved as 75. None is required; none has a default. A field's type is
  chosen once; to change it, remove the field and add another. At most twenty
  (`BOARD_FIELDS_MAX`, restated in the rules). No file field, no per-field
  switch for the overview: both were proposed and rejected.
- **Everyone on the board reads them** on Board settings → Details, the first
  page for someone who does not run the board (whose settings are "About this
  board"). **The board's owners and admins change them**: each value with its
  own pencil and editor, a date from a picker, and the fields behind "Edit
  fields". Removing a field removes its value in the same write.
- **A link opens only when it is http or https** (`safeLink`), checked when
  saved and again when tapped, since another client could have stored
  anything.
- **Values are strings in one map**, keyed by field id, written by path, so two
  owners saving different values both land.
- **Shapes are the app's, not the rules'**: rules bound the list and the map at
  twenty and cannot look inside either, so a name's length, a date being a date
  and a link being http hold because the app keeps them and only owners and
  admins write a board. The same accepted gap as a board's own labels.
- **History** records fields added, removed, renamed and reordered, and each
  value set or cleared, naming the field. **A clone** carries the fields under
  new ids and none of the values.

## Overview (2026-11-15)

One screen that shows how every program is going, so the people running
programs see what is late without opening each board. Decided by Faisal with
lanes; read-only, and it stores two preferences per person and nothing else.

- **Reached from an icon in the Boards header**, shown only to someone with at
  least one board it lists (a hidden one counts), so people who never use
  lanes never see it. Not a tab and not in More (decision D).
- **It lists the boards you can see that have live lanes** (`lanesLive`), are
  not marked as templates and are not archived (`overviewBoards`): the boards
  you are on, and every such board for an admin, as in the Boards list.
  Archiving a board is how a finished program leaves everyone's overview.
- **One row per board**: its name, its Start date and End date if set, and one
  mark per lane, the lane's state (`laneInfo`) as a shape and a colour, so it
  reads without colour: a tick on green (all finished), an exclamation on red
  (a card is late), filled (due soon), a ring (under way), a dashed ring
  (cards, none dated) and a dash (no cards). A finished card is never late
  here either. **No legend on the screen** (Faisal, 2026-11-17): a key would
  cost rows a phone cannot spare, so the marks are explained in the manual and
  in the overview's help film, which lays them over the picture. Nothing else
  is read from Details. A row opens its board; to a
  screen reader it is one button that says each lane and its state
  (`describeMark`). A board whose cards could not be loaded says so on its
  row rather than drawing marks that would read as "nothing here".
- **Boards with the same lanes share a heading.** "The same" is the lanes'
  names in the same order, ignoring capitals and spaces at the ends
  (`laneSignature`); a board that renames, adds or reorders a lane moves under
  a heading of its own. Boards are ordered inside their group, and the group
  holding the first board in the order comes first (`groupOverview`).
- **Three orders, each either way, remembered per person**: start date
  (earliest first, where it opens), date created (oldest first) and most
  overdue (the board whose latest card is most days late first, counting only
  cards in its lanes, the ones its row shows). A board with no start date goes
  last whichever way the start-date order runs, and so does one whose cards
  are still loading or could not be read under most overdue. Ties go by name
  (`sortOverview`). Nobody arranges the list by hand.
- **Each person hides boards from their own overview**, by a long press on the
  row (right-click on a computer), and shows them again from **Hidden (n)** at
  the foot; a board shown again returns to its place (decision E). Hiding
  changes nothing for anyone else, and a hidden board stays hidden through
  being archived and restored. Hiding is offered only once the person's
  hidden list has been read.
- **The lane names are written in full.** Each is measured as drawn, in the
  platform's own font (`useMeasuredWidths`). Straight over their marks where
  each fits its column on one line; otherwise on a slant, every name starting
  at its own mark (`laneColumns`). The columns narrow until the name that reaches
  furthest right ends inside the row, and the slant is the gentlest at which
  neighbouring names stay a line apart. So every lane is on screen, nothing
  scrolls sideways, and on a small phone with twelve lanes the marks shrink
  rather than touch (decision F). There is no setting for the layout.
- **Stored per person, on the user document**: `overviewSort`,
  `overviewReverse` and `overviewHiddenBoardIds`, written by the person alone,
  each control writing its own field. The hidden list keeps boards not listed
  at the moment, so one archived and restored stays hidden, and holds the
  latest 500 (`OVERVIEW_HIDDEN_MAX`, restated in the rules). A display preference grants nothing, so hiding a board you
  cannot see changes nothing.
- **Each row listens to its own board's cards**, the board screen's query and
  rule, rather than one query across boards: a member's read of a card is
  checked against its board, and a query may make ten such lookups. Rows are
  not virtualised, since a row that stops listening would lose its place in
  "most overdue". Fine for the boards fewer than fifty people keep.

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
  are **not** logged; a column change is, and so is a lane change on the same
  board. Otherwise a busy board's history is 100% noise and nobody reads it.
- Retention matches cards: kept indefinitely.

### A board's own history

On the History page of Board settings, for everyone who can see the board: who
created it, renamed it, archived or restored it, added or removed whom, made
or unmade an owner, added, removed, renamed or reordered its columns or its
lanes, turned lanes on or off, and set the finished column.

- **One writer.** The `onBoardWritten` trigger diffs every board write
  (`diffBoard` in `@sabeel/shared`) into `boards/{id}/activity`. Client edits
  and the member callables both land as board writes, so neither writes
  history itself. Removing an owner from the board is one entry, not a
  removal plus a lost ownership.
- **Who did it is the `updatedBy`/`updatedAt` stamp**, and only when the
  write moved it (`boardChangeActor`). Rules refuse a board update unless it
  carries a new stamp naming the writer, so every client change is named and
  app builds older than the history cannot save a board. A server write that
  leaves the stamp alone is recorded with nobody named. A new board names its
  creator.
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
- `pendingNotices` has no client access at all.
- A user may write their own `watchedColumns`: a list of at most 200
  `boardId/columnId` strings. Rules cannot check membership of every board an
  array names, so the server does, when it sends: an arrival goes only to
  members of the card's board, and an entry for a board you are not on yields
  nothing. `removeBoardMember` clears the removed person's entries for that
  board.
- A user may write their own overview preferences: `overviewSort` one of the
  three orders, `overviewReverse` a boolean, `overviewHiddenBoardIds` a list of
  at most 500 (`OVERVIEW_HIDDEN_MAX`, held to it by `ruleLimits.test.ts`).
  They grant nothing, so the ids are not checked.
- Board create: `role in [organizer, admin]`. Settings, membership, ownership and
  archive: ownership of that board.
- `columnId` on a card must match a column that exists on the board — clients
  cannot invent columns.
- **A board's `fields` and `details` are bounded at twenty each and nothing
  more**; their contents are the app's to keep (see "Details").
- **`laneId` on a card is checked for shape only** (a string of at most 200),
  and never required, by decision: see "Lanes". A board holds at most 12
  `lanes`; their names, their uniqueness and the finished column naming a real
  column are the app's to keep, an accepted gap like a board's own labels, held
  because only a board's owners and admins write a board.
- **Every uid in a card's `assigneeUids` must be in the parent board's
  `memberUids`.** Load-bearing for My Work — see above.
- **The same is true of `subscriberUids`**, and for a sharper reason: the read
  rule has a subscriber arm too, so subscribing IS a grant of read. Without the
  membership rule, adding your own uid to any card whose id you learned would be
  a way into a board you are not on. `removeBoardMember` clears it alongside
  `assigneeUids`, a cross-board move filters it, and a copy starts with only the
  person who made it, as any new card does.
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
this app to become as annoying as the thing it replaced, so what reaches someone
follows from what they chose to follow, and changes are announced once per burst
of editing rather than once per save (decided 2026-11-02):

| Event (`notifyPrefs` key) | Who gets it | Sent | Default |
|---|---|---|---|
| You were @mentioned in a comment (`mention`) | the person mentioned | at once | on |
| A card was assigned to you (`assigned`) | the new assignee | at once | on |
| A comment on a card you follow (`comment`) | the card's followers | at once | on |
| A card you follow changed (`cardChanged`) | the card's followers, and anyone the burst unassigned | once the card is quiet | on |
| A card arrived in a column you watch (`columnArrival`) | that column's watchers | once the card is quiet | on |
| A card assigned to you is due soon (`dueSoon`) | the assignees | 08:00 in `ORG_TIMEZONE` | on |
| A new user is awaiting approval (`newUserPending`) | all admins | at once | on |

**A card's followers are its subscribers and its assignees.** Being assigned
makes you a follower without writing you into `subscriberUids`. Only assignees
get due-soon reminders and find the card in My Work's Assigned list; a
subscriber who is not assigned finds it under Subscribed. One event reaches each
person once, through the first of mention, assignment, following and watching
that applies to them.

**A change is anything the card's history records:** a column move, an edit to
the title or description, the due date, priority, labels, someone assigned or
unassigned, a file attached or detached, a subtask link, archiving and
restoring. A reorder within a column is not recorded and notifies no one.
Notices are worded from the same entries the history shows, so the two cannot
disagree.

**Changes are announced per burst, not per save.** Each save is its own write,
so a push per write would chime once per save: editing a title, then the
description, then attaching a file would buzz a phone three times, and replacing
the notification in the tray afterwards does not take the chimes back. So every
new activity entry is collected in `pendingNotices/{cardId}`, and a sweep that
runs every minute sends a card's notice once two minutes pass with no new entry,
or ten minutes after its first entry while someone keeps editing. Each recipient
gets one push and one inbox entry naming what changed, and only what OTHERS
changed: when two people edit a card together, each hears about the other's
part. A newly assigned person's own assignment is left out of their notice,
having gone out at once. Comments, mentions and assignment stay immediate: each
is a single action, and someone may be waiting for an answer.

**A column arrival is decided when the notice is sent,** against the card as it
is then: not archived, and in this burst it was created, restored, or moved from
a column other than the one it is in now (its earliest move's `from`). A card
dragged through a column on its way elsewhere tells that column's watchers
nothing. Watching is per column, from a bell on the column header, and it never
subscribes the watcher to the card: the notice opens the card, whose bell does
that.

**Archived cards are dormant.** The burst that archives a card is still sent, as
its last notice. After that nothing on the card notifies anyone, comments and
mentions included, until it is restored, which notifies its followers and its
column's watchers. Subscriptions survive archiving untouched; My Work's
Subscribed list hides archived cards meanwhile. Nothing on an archived board
notifies at all.

**Being unassigned** sends that burst's notice to the person taken off, their
last unless they also subscribe.

**Recipients must be members of the card's board when a notice is sent.**
Subscribers and assignees are by rule; column watchers and people unassigned in
the burst are checked. So someone removed from a board stops hearing about it at
once, and no notice carries a card's title to a person who could not open it.

**Every card's creator is subscribed** unless they turned it off, cards made
before 2026-11-02 included (`scripts/subscribe-creators.mjs` added them once),
with two exceptions: cards imported from ClickUp, whose recorded creator is
whoever ran the import (they carry a `sourceId`), and cards whose creator is no
longer on the board.

Everything is opt-out per event, plus mute-this-board (`mutedBoardIds` on the user
doc). Nothing notifies the actor about their own action.

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
- **On a board with lanes**, each column page lists the board's lanes in order,
  each under a heading with its badge, then that lane's cards in this column;
  a lane with none here keeps its heading, so lanes hold their place as you
  swipe.
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

- ~~**Notification event list**~~ — **settled.** Following cards, watching
  columns and per-burst notices, 2026-11-02; see "Notifications".
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
