import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { canUnseatCreator } from '@sabeel/shared';
import {
  addBoardMember,
  countMemberAssignments,
  listAddableUsers,
  removeBoardMember,
  setBoardOwner,
  type BoardListItem,
} from '../../boards';
import { confirmAction } from '../../confirm';
import { useNav } from '../../nav';
import type { SessionUser } from '../../session';
import { radius, space, useTheme } from '../../theme';
import { useAction } from '../../useAction';
import { NoPeopleMatch, PeopleFilterField, usePeopleFilter } from '../PeopleFilter';
import {
  Body,
  Button,
  Card,
  Heading,
  Hint,
  IconAction,
  PickerList,
  Row,
  Toggle,
} from '../ui';

/**
 * Board settings → People: who is on the board and who owns it.
 *
 * For everyone on the board, not only its owners. A non-owner reaches it
 * deliberately — the roster answers "who do I ask to add someone?", which used
 * to be a question you could only put to an admin — and sees no controls at all.
 */
export function PeoplePage({
  board: b,
  user,
  canManage,
}: {
  board: BoardListItem;
  user: SessionUser;
  /** `canManageBoard(user, board)`: whether this person runs the board. */
  canManage: boolean;
}) {
  const nav = useNav();
  const boardId = b.id;
  // …and so is taking the board's CREATOR off it, which is the client mirror of
  // `keepsCreator()` in firestore.rules and of the check `removeBoardMember`
  // repeats. Named rather than inlined so the disabled controls below and the
  // rule that would refuse them are visibly the same sentence.
  const canUnseat = canUnseatCreator(user);
  // ASKED FOR ONLY BY SOMEONE WHO COULD USE IT. A non-owner has no add control
  // at all, so for them a failure would be a red banner about a query nothing
  // on their screen needed.
  /**
   * Who could be added. A CALLABLE, not a live query: `firestore.rules` lets
   * only admins list `users/`, so an owner has to ask the server. Not a
   * `useLiveQuery` violation — nothing here subscribes to Firestore.
   *
   * The filter below runs against the LIVE board document, so somebody added
   * drops out of the list at once. The other direction needs the server: the
   * callable leaves out whoever is on the board, so somebody removed after the
   * list was fetched was offered again only once the page reopened. So it is
   * asked again whenever the members change, keeping the last answer on screen
   * meanwhile.
   */
  const [addable, setAddable] = useState<{ uid: string; displayName: string }[] | null>(null);
  const [addableFailed, setAddableFailed] = useState(false);
  const memberKey = b.memberUids.join(',');
  useEffect(() => {
    if (!canManage) return;
    let live = true;
    listAddableUsers(boardId)
      .then((people) => {
        if (!live) return;
        setAddable(people);
        setAddableFailed(false);
      })
      .catch(() => { if (live) setAddableFailed(true); });
    return () => { live = false; };
  }, [canManage, boardId, memberKey]);

  const { run, busy, error } = useAction('boardSettings');
  // The pending remove/leave confirmation. `cards` is looked up in the
  // background for removing SOMEONE ELSE (null = still counting, 'unknown' = the
  // count failed); self-leave never counts, so the dialog can open instantly
  // with no round-trip.
  const [pending, setPending] = useState<{ uid: string; self: boolean } | null>(
    null,
  );
  const [pendingCards, setPendingCards] = useState<number | 'unknown' | null>(null);
  /** Whether the "add someone" picker is open — its trigger is on the heading. */
  const [adding, setAdding] = useState(false);
  const countReq = useRef(0);

  // Who the ADD picker can offer, filtered against the LIVE board doc, not just
  // at fetch time — the callable already excludes current members, but somebody
  // added while this page is open must leave the picker without a round trip.
  const nonMembers = useMemo(
    () =>
      (addable ?? []).filter(
        (u) =>
          !b.memberUids.includes(u.uid) &&
          // You add yourself with Join, not from the add-someone list.
          u.uid !== user.uid,
      ),
    [b.memberUids, addable, user.uid],
  );

  // Adding the LAST candidate empties the picker while it is still open, which
  // would otherwise render an empty panel directly above the "nobody available
  // to add" hint, with the heading's trigger hidden because `adding` is true.
  useEffect(() => {
    if (adding && nonMembers.length === 0) setAdding(false);
  }, [adding, nonMembers.length]);

  function ask(uid: string) {
    // Open the confirmation IMMEDIATELY — the dialog is the feedback. Waiting on
    // a callable before showing anything read as a frozen button, and on a real
    // phone the count cold-started for seconds.
    const self = uid === user.uid;
    setPending({ uid, self });
    setPendingCards(null);
    // Self-leave skips the count entirely (one round-trip, not two);
    // removeBoardMember already reports how many cards it unassigned. For
    // removing SOMEONE ELSE the count is worth showing, so fetch it in the
    // background and drop it into the already-open dialog when it lands. The
    // req token ignores a stale count if the dialog has since changed.
    if (!self) {
      const req = ++countReq.current;
      countMemberAssignments(boardId, uid)
        .then((n) => {
          if (countReq.current === req) setPendingCards(n);
        })
        .catch(() => {
          if (countReq.current === req) setPendingCards('unknown');
        });
    }
  }

  // Current members come from the board — everyone can see them.
  const members = b.members;
  const isMember = b.memberUids.includes(user.uid);

  return (
    <>
      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      {/* Adding rides on the heading, and the candidate list opens on demand.
          It used to be a permanent second panel with a labelled Add per person,
          which grew with the directory and pushed Archive off the screen. */}
      <Heading
        action={
          canManage && nonMembers.length > 0 && !adding ? (
            <IconAction
              icon="person-add"
              label={`Add someone (${nonMembers.length} available)`}
              accent
              disabled={busy}
              onPress={() => setAdding(true)}
            />
          ) : null
        }
      >
        Members ({b.memberUids.length})
      </Heading>
      {!isMember ? (
        <Card>
          <Body>
            You are not a member of this board. Join to be assignable to its
            cards and to see it under your own boards.
          </Body>
          <Button
            busy={busy}
            label="Join this board"
            onPress={() =>
              run(() =>
                addBoardMember(boardId, user.uid),
              )
            }
          />
        </Card>
      ) : null}
      <Card>
        {/* What the switch column IS. Nothing else on this page says it: the
            Toggle carries an accessibilityLabel and no visible text, and at
            320px a per-row label does not fit — so a sighted owner met a bare
            switch beside every name with no clue what flipping it would do.

            One line for the section rather than the same words repeated down
            every row. Kept SHORT on purpose: docs/PERMISSIONS.md is the single
            statement of who can do what, and the confirmation below already
            spells out the whole grant before anything happens. */}
        <Hint>
          {canManage
            ? 'The switch on each row makes that person an owner of this board. Turning it on or off asks first and says what changes.'
            : b.boardOwnerUids.length === 0
              ? 'Nobody owns this board at the moment, so only an admin can change it.'
              : 'Owners are marked below — they are who to ask to add someone or change this board.'}
        </Hint>
        {members.map((m) => {
          const isOwner = b.boardOwnerUids.includes(m.uid);
          const isCreator = m.uid === b.createdBy;
          return (
            <Row key={m.uid} style={styles.between}>
              <View style={styles.grow}>
                <Body>{m.displayName}</Body>
                <Hint>{m.email}</Hint>
                {/* A Hint, not a Caption: this explains why the control beside
                    it is disabled, so it carries meaning and has to be legible.
                    It is also the only thing on screen that accounts for two
                    rows both saying Owner behaving differently. */}
                {isCreator ? <Hint>created this board</Hint> : null}
              </View>
              {canManage ? (
                <Row>
                  {/* A state editor, not a verb button — the same shape the
                      People screen uses for access. The row SHOWS whether this
                      person owns the board, and changing it asks first. A
                      mistap is then a visible flip you decline, rather than a
                      grant nobody is told about. */}
                  <Toggle
                    value={isOwner}
                    disabled={busy || (isCreator && !canUnseat)}
                    label={`Owner of this board: ${m.displayName}`}
                    onValueChange={async (next) => {
                      // Stepping DOWN yourself is the one move you cannot take
                      // back: the moment it lands, this page becomes the
                      // read-only roster. Say so, rather than letting someone
                      // find out by looking for the control they just used.
                      const self = m.uid === user.uid && !next;
                      const ok = await confirmAction(
                        next
                          ? `Make ${m.displayName} an owner?`
                          : self
                            ? 'Step down as an owner?'
                            : `Remove ${m.displayName} as an owner?`,
                        next
                          ? `${m.displayName} will be able to change this board's settings and columns, add and remove people, promote other owners, archive it, and permanently delete its cards. It grants nothing on any other board.`
                          : self
                            ? 'You will stay on the board and keep using it, but will no longer be able to change it or manage who is on it — including undoing this. Another owner or an admin would have to give it back.'
                            : `${m.displayName} will stay on the board and keep using it, but will no longer be able to change it or manage who is on it.`,
                      );
                      if (ok) void run(() => setBoardOwner(boardId, m.uid, next));
                    }}
                  />
                  {/* The board knows who its members are, not what org role they
                      hold — that lives in users/*, which only admins may read.
                      Your own row offers Leave (a door you walk out of);
                      everyone else, Remove. Both confirm before anything
                      happens. */}
                  <IconAction
                    icon={m.uid === user.uid ? 'logout' : 'person-remove'}
                    label={
                      m.uid === user.uid
                        ? 'Leave this board'
                        : `Remove ${m.displayName} from this board`
                    }
                    disabled={busy || (isCreator && !canUnseat)}
                    onPress={() => ask(m.uid)}
                  />
                </Row>
              ) : isOwner ? (
                /* Read-only for everyone else, and it answers the question the
                   roster exists to answer: who do I ask to add someone? */
                <Hint>Owner</Hint>
              ) : null}
            </Row>
          );
        })}
        {/* Both of these explain why there is no ADD control. Shown to someone
            who would not get one anyway, they read as an apology for a button
            they never expected — so they belong behind the same gate. */}
        {!canManage ? null : addableFailed ? (
          <Hint>
            Could not load who can be added. Check your connection and reopen
            this page.
          </Hint>
        ) : addable !== null && nonMembers.length === 0 ? (
          /* Said out loud, not left silent: with no add control and no reason
             given, "why can I only assign myself?" reads as a bug rather than
             as an account still waiting for approval. */
          /* "More → People", not "People": this page is People too. */
          <Hint>
            Nobody available to add. An admin approves people in More → People
            before they can join a board.
          </Hint>
        ) : null}

        {adding ? (
          <AddPeoplePanel
            people={nonMembers}
            busy={busy}
            onAdd={(uid) => run(() => addBoardMember(boardId, uid))}
            onDone={() => setAdding(false)}
          />
        ) : null}
      </Card>

      {/* Gated with the rows that open it: a live demotion — another owner
          revoking yours while this is on screen — would otherwise leave a
          confirmation whose button the server now refuses. */}
      {canManage && pending ? (
        <Card>
          <Body>
            {pending.self
              ? 'Leave this board? Any cards assigned to you on this board will be unassigned.'
              : pendingCards === null
                ? 'Remove this person from the board? Checking how many cards they are assigned to…'
                : pendingCards === 'unknown'
                  ? 'Remove this person from the board? Could not check how many cards they are assigned to. They will be unassigned from all of them.'
                  : pendingCards > 0
                  ? `Remove this person from the board? They are assigned to ${
                      pendingCards
                    } card${
                      pendingCards === 1 ? '' : 's'
                    }, and will be unassigned from ${
                      pendingCards === 1 ? 'it' : 'them'
                    }.`
                  : 'Remove this person from the board? They are not assigned to any cards.'}
          </Body>
          <Row>
            <Button
              busy={busy}
              label={pending.self ? 'Leave' : 'Remove'}
              variant="danger"
              onPress={() =>
                run(async () => {
                  const { uid, self } = pending;
                  await removeBoardMember(boardId, uid);
                  setPending(null);
                  // After leaving, step out to the boards list. (An admin still
                  // SEES the board, but the point of leaving is to be off it.)
                  if (self) nav.reset({ name: 'boards' });
                })
              }
            />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setPending(null)}
            />
          </Row>
        </Card>
      ) : null}
    </>
  );
}

/**
 * The add-someone list, narrowed by typing like every person picker
 * (PeopleFilter). Its own component because the filter's draft changes on
 * every keystroke and must not re-render the roster above it.
 */
function AddPeoplePanel({
  people,
  busy,
  onAdd,
  onDone,
}: {
  people: readonly { uid: string; displayName: string }[];
  busy: boolean;
  onAdd: (uid: string) => void;
  onDone: () => void;
}) {
  const t = useTheme();
  const { filter, setFilter, matches } = usePeopleFilter(people);
  return (
    <View
      style={[styles.picker, { borderColor: t.border.subtle, backgroundColor: t.bg.inset }]}
    >
      <Hint>Add someone</Hint>
      <PeopleFilterField value={filter} onChange={setFilter} />
      {matches.length === 0 ? <NoPeopleMatch /> : null}
      <PickerList>
        {matches.map((u) => (
          <Pressable
            key={u.uid}
            accessibilityRole="button"
            accessibilityLabel={`Add ${u.displayName} to this board`}
            disabled={busy}
            onPress={() => onAdd(u.uid)}
            style={({ pressed }) => [
              styles.option,
              {
                backgroundColor: pressed ? t.bg.accentSoft : t.bg.surface,
                borderColor: t.border.subtle,
              },
            ]}
          >
            <Body>{u.displayName}</Body>
          </Pressable>
        ))}
      </PickerList>
      <Button label="Done" variant="secondary" onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  grow: { flex: 1, gap: space.xs },
  picker: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.sm,
    gap: space.sm,
  },
  /** Roughly four rows, then it scrolls. */
  option: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.xs,
    gap: space.xs,
  },
});
