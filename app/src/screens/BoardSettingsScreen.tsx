import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  BOARD_NAME_MAX,
  canEditBoardLabels,
  canManageBoard,
  canUnseatCreator,
  columnsPatch,
  localId,
  validateBoardName,
  validateColumnName,
  type BoardColumn,
} from '@sabeel/shared';
import {
  addBoardMember,
  listAddableUsers,
  countMemberAssignments,
  removeBoardMember,
  setBoardOwner,
  updateBoard,
  useBoard,
} from '../boards';
import type { SessionUser } from '../session';
import { useNav } from '../nav';
import {
  Body,
  Button,
  Hint,
  Card,
  Heading,
  IconAction,
  LoadError,
  PickerList,
  Row,
  Screen,
  Spinner,
  TextField,
  Title,
  Toggle,
} from '../components/ui';
import { confirmAction } from '../confirm';
import { BoardHistory } from '../components/BoardHistory';
import { ColumnNameEditor } from '../components/ColumnNameEditor';
import { ReorderList } from '../components/ReorderList';
import { BoardLabelsSection } from '../components/LabelManager';
import { radius, space, useTheme } from '../theme';
import { useAction } from '../useAction';

export function BoardSettingsScreen({
  boardId,
  user,
}: {
  boardId: string;
  user: SessionUser;
}) {
  const nav = useNav();
  const board = useBoard(boardId);
  /**
   * Whether this person ADMINISTERS the board, as opposed to merely being on it.
   *
   * Everything on this screen except the roster is gated on it. A non-owner
   * reaches the screen deliberately — the roster answers "who do I ask to add
   * someone?", which used to be a question you could only put to an admin — and
   * sees no controls at all.
   *
   * Computed here rather than after the loading guards below, because the
   * directory subscription needs it: `board.data` is undefined while the board
   * loads and `canManageBoard` takes that, returning false until it knows.
   */
  const canManage = canManageBoard(user, board.data);
  // …and so is taking the board's CREATOR off it, which is the client mirror of
  // `keepsCreator()` in firestore.rules and of the check `removeBoardMember`
  // repeats. Named rather than inlined so the disabled controls below and the
  // rule that would refuse them are visibly the same sentence.
  const canUnseat = canUnseatCreator(user);
  // ASKED FOR ONLY BY SOMEONE WHO COULD USE IT. Only admins may list all users;
  // a board owner who is not one gets the error and a note explaining it, which
  // is the honest answer to "who else could I add?". A non-owner has no add
  // control at all, so for them the same failure is a red banner about a query
  // nothing on their screen needed.
  /**
   * Who could be added. A CALLABLE, not a live query: `firestore.rules` lets
   * only admins list `users/`, so an owner has to ask the server. Not a
   * `useLiveQuery` violation — nothing here subscribes to Firestore.
   *
   * A one-shot snapshot is enough because the filter below runs against the LIVE
   * board document, so somebody added drops out of the list without a refetch.
   */
  const [addable, setAddable] = useState<{ uid: string; displayName: string }[] | null>(null);
  const [addableFailed, setAddableFailed] = useState(false);
  useEffect(() => {
    if (!canManage) return;
    let live = true;
    listAddableUsers(boardId)
      .then((people) => { if (live) setAddable(people); })
      .catch(() => { if (live) setAddableFailed(true); });
    return () => { live = false; };
  }, [canManage, boardId]);
  const t = useTheme();

  const { run, busy, error, setError } = useAction('boardSettings');
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

  // Who the ADD picker can offer. Derived up here, ABOVE the early returns
  // below, because the effect that closes the picker is a hook and hooks cannot
  // sit after a conditional return.
  //
  // Filtered against the LIVE board doc, not just at fetch time — the callable
  // already excludes current members, but somebody added while this screen is
  // open must leave the picker without a round trip.
  const nonMembers = useMemo(() => {
    const bd = board.data;
    if (!bd) return [];
    return (addable ?? []).filter(
      (u) =>
        !bd.memberUids.includes(u.uid) &&
        // You add yourself with Join, not from the add-someone list.
        u.uid !== user.uid,
    );
  }, [board.data, addable, user.uid]);

  // Adding the LAST candidate empties the picker while it is still open, which
  // would otherwise render an empty panel directly above the "nobody available
  // to add" hint, with the heading's trigger hidden because `adding` is true.
  useEffect(() => {
    if (adding && nonMembers.length === 0) setAdding(false);
  }, [adding, nonMembers.length]);

  if (board.status === 'loading') return <Spinner label="Loading board…" />;
  const b = board.data;
  if (!b) {
    // GONE and REFUSED are different answers. Being removed from a board you
    // have open ends its listener with permission-denied, which is ordinary now
    // that authority is per-board — and "Board not found" would tell somebody
    // their colleague's board had been deleted.
    return (
      <Screen width="read">
        <Row style={styles.between}>
          <Title>{board.status === 'error' ? 'Board unavailable' : 'Board not found'}</Title>
          <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
        </Row>
        {board.status === 'error' ? (
          <LoadError what="this board" code={board.error} />
        ) : null}
      </Screen>
    );
  }


  // Returns whether the name was ACCEPTED, so the row knows whether to clear
  // itself. A rejected name stays in the field.
  async function addColumn(name: string): Promise<boolean> {
    const problem = validateColumnName(name, b!.columns);
    if (problem) {
      setError(problem);
      return false;
    }
    const next: BoardColumn[] = [...b!.columns, { id: localId('col'), name: name.trim() }];
    // columnsPatch, never a bare `columns` write: rules validate card writes
    // against the flat `columnIds` mirror, so a desynced pair means cards cannot
    // be created in the new column at all — with a bare PERMISSION_DENIED as the
    // only clue.
    await run(() => updateBoard(boardId, columnsPatch(next)));
    return true;
  }

  async function renameBoard(name: string) {
    const problem = validateBoardName(name);
    if (problem) {
      setError(problem);
      return;
    }
    await run(() => updateBoard(boardId, { name: name.trim() }));
  }

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

  // Current members come from the board — everyone can see them. (The ADD
  // picker's candidates are derived above, where the hooks live.)
  const members = b.members;
  const isMember = b.memberUids.includes(user.uid);

  return (
    <Screen width="read">
      <Row style={styles.between}>
        <Title>{canManage ? 'Board settings' : 'Members and labels'}</Title>
        <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
      </Row>

      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      {/* Everything from here to the members roster is OWNER work. A non-owner
          gets the roster and nothing else — not a screen full of disabled
          controls, which reads as something being broken. */}
      {canManage ? (
        <>
          <Heading>Name</Heading>
          <Card>
            <BoardNameEditor initial={b.name} onSave={renameBoard} />
          </Card>

          <Heading>Columns</Heading>
          <Card>
            {/* Drag the handle to reorder. One document write per drop
                (columnsPatch keeps columns/columnIds in sync — never a bare
                `columns` write, or card rules reject the new column). */}
            {/* The name is editable in place. Dragging is the handle's job, so a tap
                on the pencil cannot start a reorder. */}
            <ReorderList
              items={b.columns}
              keyOf={(c) => c.id}
              renderItem={(c) => (
                <ColumnNameEditor
                  column={c}
                  columns={b.columns}
                  canEdit
                  busy={busy}
                  onError={setError}
                  onRename={(next) => updateBoard(boardId, columnsPatch(next))}
                  run={run}
                />
              )}
              onReorder={(next) => run(() => updateBoard(boardId, columnsPatch(next)))}
            />
            <Hint>
              Columns are removed from the board screen, and only once they are
              empty — so no cards can vanish with them.
            </Hint>
            <AddColumnRow busy={busy} onAdd={addColumn} />
          </Card>

        </>
      ) : null}

      {/* For EVERYONE on the board, not only its owners: a board's own labels
          are anyone-on-the-board's to change, and the institute labels above
          them are locked for all. */}
      <BoardLabelsSection boardId={boardId} user={user} canEdit={canEditBoardLabels(user, b)} />

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
        {/* What the switch column IS. Nothing else on this screen says it: the
            Toggle carries an accessibilityLabel and no visible text, and at
            320px a per-row label does not fit — so a sighted owner met a bare
            switch beside every name with no clue what flipping it would do.

            One line for the section, the same shape Columns and Labels above
            already use, rather than the same words repeated down every row.
            Kept SHORT on purpose: docs/PERMISSIONS.md is the single statement of
            who can do what, and the confirmation below already spells out the
            whole grant before anything happens. */}
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
                      // back: the moment it lands, this screen becomes the
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
            this screen.
          </Hint>
        ) : addable !== null && nonMembers.length === 0 ? (
          /* Said out loud, not left silent: with no add control and no reason
             given, "why can I only assign myself?" reads as a bug rather than
             as an account still waiting for approval. */
          <Hint>
            Nobody available to add. People must be approved under People before
            they can join a board.
          </Hint>
        ) : null}

        {adding ? (
          <View
            style={[
              styles.picker,
              { borderColor: t.border.subtle, backgroundColor: t.bg.inset },
            ]}
          >
            <Hint>Add someone</Hint>
            <PickerList>
              {nonMembers.map((u) => (
                <Pressable
                  key={u.uid}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${u.displayName} to this board`}
                  disabled={busy}
                  onPress={() =>
                    run(() =>
                      addBoardMember(boardId, u.uid),
                    )
                  }
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
            <Button
              label="Done"
              variant="secondary"
              onPress={() => setAdding(false)}
            />
          </View>
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

      {canManage ? (
        <>
          <Heading>Archive</Heading>
          <Card>
            <Body>
              Archiving hides the board from everyone&rsquo;s list. Boards are
              never permanently deleted — too much work accumulates in them.
            </Body>
            <Button
              busy={busy}
              label={b.archived ? 'Restore board' : 'Archive board'}
              variant={b.archived ? 'primary' : 'danger'}
              onPress={() =>
                run(async () => {
                  await updateBoard(boardId, { archived: !b.archived });
                  if (!b.archived) nav.reset({ name: 'boards' });
                })
              }
            />
          </Card>
        </>
      ) : null}

      {/* For everyone who can see the board, like the roster: who changed
          what is as much a member's question as an owner's. */}
      <Heading>History</Heading>
      <Card>
        <BoardHistory boardId={boardId} />
      </Card>
    </Screen>
  );
}

/**
 * The new-column row, owning its draft.
 *
 * Board settings renders every column, every label, every member, every
 * non-member and a ReorderList. Typing a column name here re-rendered the lot
 * on each character, for a field that nothing else on the screen reads.
 *
 * Unmount-scoped in spirit but long-lived in practice — this row is always on
 * screen — so it clears itself on a successful add, which is what the screen
 * did before.
 */
function AddColumnRow({
  busy,
  onAdd,
}: {
  busy: boolean;
  /** Resolves once the column is written; rejects if it was refused. */
  onAdd: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');

  async function submit() {
    // Cleared only if it was accepted. A rejected name stays in the field —
    // retyping it to be told again which word was the problem is worse than
    // the duplicate.
    if (await onAdd(name)) setName('');
  }

  return (
    <Row style={styles.addRow}>
      <View style={styles.grow}>
        <TextField
          value={name}
          onChangeText={setName}
          placeholder="New column name"
          onSubmit={submit}
        />
      </View>
      <IconAction
        icon="add"
        label="Add column"
        accent
        onPress={submit}
        disabled={busy || !name.trim()}
      />
    </Row>
  );
}

function BoardNameEditor({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <>
      <TextField
        value={name}
        onChangeText={setName}
        placeholder="Board name"
        maxLength={BOARD_NAME_MAX}
      />
      <Button
        label="Save name"
        onPress={() => onSave(name)}
        disabled={name.trim() === initial}
      />
    </>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  grow: { flex: 1, gap: space.xs },
  /** A tight gap: IconAction is a laid-out 44pt box, not slop. */
  addRow: { alignItems: 'center', gap: space.xs },
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
