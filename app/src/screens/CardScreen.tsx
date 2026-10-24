import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../icons';
import {
  PRIORITIES,
  canManageBoard,
  priorityLabel,
  readableInkOn,
  todayInOrgTz,
} from '@sabeel/shared';
import {
  archiveCard,
  cardsInColumn,
  createCard,
  deleteCard,
  moveCard,
  restoreCard,
  updateCard,
  useCard,
  subscribeToCard,
  useBoardCards,
  type Card,
} from '../cards';
import { useBoard } from '../boards';
import { createLabel, useLabels } from '../labels';
import type { SessionUser } from '../session';
import { useNav } from '../nav';
import { shareLink, WEB_ORIGIN } from '../share';
import { cardPath } from '../links';
import { Attachments } from '../components/Attachments';
import { Comments } from '../components/Comments';
import { ActivityLog } from '../components/ActivityLog';
import {
  AssigneePicker,
  assignableCandidates,
} from '../components/AssigneePicker';
import { Subtasks } from '../components/Subtasks';
import { CardDescription } from '../components/CardDescription';
import { CardTitleEditor } from '../components/CardTitleEditor';
import { NewLabelSheet } from '../components/NewLabelSheet';
import { DateField } from '../components/DateField';
import { Select } from '../components/Select';
import {
  Body,
  Button,
  Hint,
  LoadError,
  IconAction,
  Card as Panel,
  Heading,
  Row,
  Screen,
  Spinner,
  Title,
} from '../components/ui';
import { radius, space, type, useTheme } from '../theme';
import { useAction } from '../useAction';

/** Stable empty, so Subtasks' memos don't churn while the board loads. */
const NO_CARDS: Card[] = [];

export function CardScreen({
  boardId,
  cardId,
  user,
}: {
  boardId: string;
  cardId: string;
  user: SessionUser;
}) {
  const nav = useNav();
  const card = useCard(cardId);
  const board = useBoard(boardId);
  // Board authority: permanently deleting a card, and moderating a comment,
  // belong to this board's owners rather than to a rank in the organisation.
  const canManage = canManageBoard(user, board.data);
  // Org-wide. Every board offers the same labels, so this does not come from
  // the board document any more.
  const labels = useLabels();
  /**
   * The label list, but ONLY once we actually have it.
   *
   * `useLiveQuery` reports `data: undefined` while loading AND on error, so the
   * `?? []` this used to carry turned "not known yet" into "there are no
   * labels" — and `validateLabelName` against an empty set waves every
   * duplicate through. The result is a persistent org-wide label that only a
   * admin can remove, created with no warning at all. Null here means the
   * create controls stay disabled until the check can mean something.
   */
  const knownLabels = labels.status === 'ready' ? labels.data : null;
  const boardCards = useBoardCards(boardId);
  const t = useTheme();

  const [editingDesc, setEditingDesc] = useState(false);
  // Owned here, not in AssigneePicker: the control that opens it lives on the
  // section heading, outside that component.
  const [picking, setPicking] = useState(false);
  const { run, busy, error, setError } = useAction('card');
  const [note, setNote] = useState<string | null>(null);
  const [addingLabel, setAddingLabel] = useState(false);

  /*
   * NO EDITOR DRAFT AND NO SEEDING EFFECT LIVE HERE — deliberately, and this is
   * what retires a data-loss bug rather than merely avoiding it.
   *
   * This screen used to hold `title`, `titleDirty`, `editingTitle`, the same
   * for the description, and an effect that re-seeded them from the server. The
   * two editors can be open at once, and they shared one dirty flag: saving the
   * title cleared it, re-armed the effect, and silently overwrote an unsaved
   * description with the server's copy. Someone typed a long description, fixed
   * the title, and watched it vanish — no error, nothing to undo. Splitting the
   * flag fixed it only for as long as everyone remembered why there were two.
   *
   * Each editor now owns its own draft, so neither can reach the other's state
   * at all, and a keystroke re-renders one editor instead of this whole screen.
   */

  // Resolves a card id to a title, for the subtask entries in the activity log.
  // A plain arrow: nothing downstream keys off its identity now that
  // `ActivityLog` is no longer memoised, and a `useCallback` whose only purpose
  // was feeding that shallow compare would outlive its reason.
  const cardTitleFor = (id: string) =>
    (boardCards.data ?? NO_CARDS).find((x) => x.id === id)?.title ?? 'another card';

  if (card.status === 'loading' || board.status === 'loading') {
    return <Spinner label="Loading card…" />;
  }

  const c = card.data;
  const b = board.data;

  /**
   * Whether the board's OTHER cards have arrived.
   *
   * This screen deliberately renders as soon as the card and board do — waiting
   * on a whole-board query to show one card would be a visibly slower open. But
   * two controls here compute a rank from that list, and `?? []` makes an
   * unloaded list indistinguishable from an empty column: `rankBetween(null,
   * null)` then returns the fixed FIRST rank, so the card lands at the top of a
   * column it should have joined the end of — and collides with whatever card
   * already holds that rank. Both controls wait instead; it is brief.
   */
  const cardsReady = boardCards.status === 'ready';

  if (!c || !b) {
    // GONE and REFUSED are different answers, and both reach here: losing access
    // to a board ends the card's listener too, which is ordinary now that
    // authority is per-board. "It may have been deleted" would be a claim about
    // somebody else's work made from a refusal.
    const refused = card.status === 'error' || board.status === 'error';
    return (
      <Screen width="read">
        <Row style={styles.between}>
          <Title>{refused ? 'Card unavailable' : 'Card not found'}</Title>
          <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
        </Row>
        {refused ? (
          <LoadError what="this card" code={card.error ?? board.error} />
        ) : (
          <Hint>It may have been deleted.</Hint>
        )}
      </Screen>
    );
  }

  const today = todayInOrgTz();
  const overdue = c.dueDate !== undefined && c.dueDate < today;

  /** Whether I follow this card's comments. Assignment does NOT imply it — an
   *  assignee already hears about comments through `commentOnMyCard`, and
   *  subscribing separately is what makes the interest survive being
   *  unassigned. */
  const subscribed = c.subscriberUids.includes(user.uid);
  // Only board members may be assigned — the rule the My Work query depends on.
  // Sourced from the board doc so non-admins (who cannot list users) still see
  // who they can assign.
  const assignable = b.members;
  // Whether the heading offers "assign someone" must be the SAME question the
  // picker answers, so it comes from the picker's own helper rather than from
  // comparing two lengths — see assignableCandidates.
  //
  // Deliberately NOT useMemo: this sits below the early returns above, where a
  // hook would be conditional. It is a filter over a handful of board members.
  const assignableNow = assignableCandidates(assignable, c.assigneeUids);

  // The card this one is a subtask of, resolved against the board's LIVE cards.
  // Resolving here rather than fetching means a parent that was archived, moved
  // to another board or deleted simply resolves to undefined and the link is not
  // rendered — a dead link is worse than no link.
  const parent = c.parentId
    ? (boardCards.data ?? NO_CARDS).find((x) => x.id === c.parentId)
    : undefined;

  // Share an https link to this card. The receiver opens it — desktop lands in
  // the web app, a phone opens the browser (or, once App Links ship, the app) —
  // and the link resolves the card's board live, so it survives a cross-board
  // move. The link is built from the card id, never from the address bar.
  const onShare = async () => {
    const result = await shareLink(`${WEB_ORIGIN}${cardPath(cardId)}`, c.title);
    if (result === 'copied') {
      setNote('Link copied');
      setTimeout(() => setNote(null), 2200);
    }
  };

  return (
    <Screen width="read">
      <Row style={styles.between}>
        <View style={styles.crumbCol}>
          {/* Which board this card lives on — and a one-tap way back to it.
              Cards are top-level docs, so without this the detail view gives no
              hint of its board. Accent-coloured because it navigates. */}
          <Pressable
            onPress={() => nav.push({ name: 'board', boardId })}
            accessibilityRole="link"
            accessibilityLabel={`Open board ${b.name}`}
            hitSlop={8}
            style={styles.crumb}
          >
            <Icon name="dashboard" size={13} color={t.accent.base} />
            {/* Shrinks, or a long board name (120 chars are allowed) is laid
                out at full width beside the icon and spills over the Share and
                Back actions — invisibly on web, which clips, but not on
                Android. Same trap as the phone pager's column name. */}
            <Text
              style={[type.caption, styles.shrink, { color: t.accent.base }]}
              numberOfLines={1}
            >
              {b.name}
            </Text>
          </Pressable>
          {/* No generic "Card" heading: the card's own title sits directly below
              as the page's heading, so a second one was pure noise. */}
        </View>
        <View style={styles.headerActions}>
          {note ? <Hint>{note}</Hint> : null}
          {/* Subscribing is about the COMMENTS, so the label says so — a bare
              "Subscribe" would imply you hear about every field on the card,
              which was considered and deliberately not built. */}
          <IconAction
            icon={subscribed ? 'notifications-active' : 'notifications-none'}
            label={
              subscribed ? 'Unsubscribe from comments' : 'Subscribe to comments'
            }
            accent={subscribed}
            disabled={busy}
            onPress={() => run(() => subscribeToCard(cardId, user, !subscribed))}
          />
          <IconAction icon="share" label="Share card" onPress={onShare} />
          <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
        </View>
      </Row>

      {error ? (
        <Panel>
          <Body>{error}</Body>
        </Panel>
      ) : null}

      <Panel>
        {/* The way back UP a subtask chain — and the ONLY place a subtask can
            detach itself.

            Shown whenever `parentId` is set, even when the parent cannot be
            resolved. Hiding it in that case was a one-way door: archiving or
            moving a parent left the child silently still linked, with no sign it
            was a subtask, no unlink here (the only unlink lived on the parent,
            which was now unreachable), and permanently excluded from every
            picker, because `canBeSubtaskOf` refuses a card that already has a
            parent. The link lives on the CHILD, so the child must always be able
            to let go of it. */}
        {c.parentId ? (
          <Row style={styles.between}>
            {parent ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open parent card ${parent.title}`}
                onPress={() => nav.push({ name: 'card', boardId, cardId: parent.id })}
                style={({ pressed }) => [styles.grow, pressed && { opacity: 0.6 }]}
              >
                <Hint>Subtask of</Hint>
                <Body>{parent.title}</Body>
              </Pressable>
            ) : (
              <View style={styles.grow}>
                <Hint>Subtask of</Hint>
                <Body>a card that isn&rsquo;t showing here</Body>
                <Hint>It may have been archived, moved to another board, or deleted.</Hint>
              </View>
            )}
            <IconAction
              icon="link-off"
              label="Unlink from parent card"
              onPress={() => run(() => updateCard(cardId, { parentId: undefined }, user))}
              disabled={busy}
            />
          </Row>
        ) : null}
        {/* The title READS as a title and only becomes a field when you choose
            to edit it — the same shape as Description just below.

            It was a permanently-open TextField, which was wrong twice over: a
            card's name is the thing you came to read, and a single-line input
            TRUNCATES it, so a long title could not be read at all on the one
            screen dedicated to that card. As a heading it wraps and shows in
            full. */}
        <CardTitleEditor
          title={c.title}
          busy={busy}
          run={run}
          onSave={(next) => updateCard(cardId, { title: next }, user)}
        />
        {/* The column is EDITABLE here. Previously it was a read-only pill, so
            moving a card meant leaving the detail view, finding it on the board
            and using a separate move action — for the one property you most
            often change while reading a card. */}
        <Row>
          <Hint>in</Hint>
          <Select
            label="Column"
            value={c.columnId}
            disabled={busy || !cardsReady}
            options={b.columns.map((col) => ({ value: col.id, label: col.name }))}
            onChange={(toColumnId) =>
              run(async () => {
                // Give it a fresh rank at the END of the destination. Carrying
                // the old rank across would drop the card at an arbitrary
                // position — ranks are only meaningful within a column.
                const destination = cardsInColumn(boardCards.data ?? [], toColumnId);
                await moveCard({
                  card: c,
                  toColumnId,
                  before: destination[destination.length - 1] ?? null,
                  after: null,
                  user,
                });
              })
            }
          />
        </Row>
      </Panel>

      {/* Edit sits ON the heading, not as a full-width button under the text.
          A button that wide reads as the section's primary action when it is
          really a secondary one, and it cost a whole row on a screen that is
          already long. */}
      <Heading
        action={
          !editingDesc ? (
            <IconAction
              icon="edit"
              label="Edit description"
              onPress={() => setEditingDesc(true)}
            />
          ) : null
        }
      >
        Description
      </Heading>
      <CardDescription
        cardId={cardId}
        description={c.description}
        user={user}
        editing={editingDesc}
        onDone={() => setEditingDesc(false)}
        run={run}
        busy={busy}
      />

      <Attachments cardId={cardId} user={user} />

      <Heading>Subtasks</Heading>
      <Panel>
        <Subtasks
          parentId={cardId}
          boardCards={boardCards.data ?? NO_CARDS}
          columns={b.columns}
          busy={busy || !cardsReady}
          onOpen={(id) => nav.push({ name: 'card', boardId, cardId: id })}
          onCreate={(childTitle) =>
            run(async () => {
              // Created in the PARENT's column, so a breakdown starts wherever
              // the work currently sits rather than always at To Do.
              const newId = await createCard({
                boardId,
                columnId: c.columnId,
                title: childTitle,
                user,
                columnCards: cardsInColumn(boardCards.data ?? [], c.columnId),
              });
              await updateCard(newId, { parentId: cardId }, user);
            })
          }
          onLink={(id) => run(() => updateCard(id, { parentId: cardId }, user))}
          // `undefined` is how updateCard clears a field (deleteField), so an
          // unlink leaves the card intact and merely unparented.
          onUnlink={(id) => run(() => updateCard(id, { parentId: undefined }, user))}
        />
      </Panel>

      <Heading>Priority</Heading>
      <Panel>
        <Row style={styles.wrap}>
          {PRIORITIES.map((p) => {
            const selected = c.priority === p;
            const label = priorityLabel(p);
            // Selected looks like the card-face badge: filled color + readable ink.
            // `none` has no badge color, so it fills a neutral chip. Unselected is
            // an outline tinted with the priority color as a hint.
            const fill = p === 'none' ? t.bg.inset : t.priority[p];
            const ink =
              p === 'none'
                ? t.text.secondary
                : readableInkOn(fill, t.text.inverse, t.text.primary) === 'light'
                  ? t.text.inverse
                  : t.text.primary;
            return (
              <Pressable
                key={p}
                onPress={() => run(() => updateCard(cardId, { priority: p }, user))}
                accessibilityRole="button"
                accessibilityLabel={`Priority ${p}`}
                style={[
                  styles.chip,
                  selected
                    ? { backgroundColor: fill, borderColor: fill }
                    : {
                        backgroundColor: 'transparent',
                        borderColor: p === 'none' ? t.border.subtle : t.priority[p],
                      },
                ]}
              >
                <Text
                  style={[
                    type.caption,
                    { color: selected ? ink : t.text.secondary, fontWeight: selected ? '600' : '400' },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      </Panel>

      <Heading>Due date</Heading>
      <Panel>
        {overdue ? <Hint>Overdue</Hint> : null}
        <DateField
          value={c.dueDate}
          label="Due date"
          onChange={(next) =>
            run(() => updateCard(cardId, { dueDate: next }, user))
          }
        />
      </Panel>

      {/* The person-add icon rides on the heading rather than sitting in the
          panel: a section-level control in its own row costs a row of a screen
          that is already long. Same shape as Description's edit icon. */}
      <Heading
        action={
          assignableNow.length > 0 && !picking ? (
            <IconAction
              icon="person-add"
              label={`Assign someone (${assignableNow.length} available)`}
              accent
              disabled={busy}
              onPress={() => setPicking(true)}
            />
          ) : null
        }
      >
        Assignees
      </Heading>
      <Panel>
        <AssigneePicker
          picking={picking}
          onPickingChange={setPicking}
          members={assignable}
          assignedUids={c.assigneeUids}
          onToggle={(uid, assign) =>
            run(() =>
              updateCard(
                cardId,
                {
                  assigneeUids: assign
                    ? Array.from(new Set([...c.assigneeUids, uid]))
                    : c.assigneeUids.filter((x) => x !== uid),
                },
                user,
              ),
            )
          }
          emptyHint={
            assignable.length <= 1
              ? 'Only people added to this board can be assigned. Add them under board Settings — and they have to be approved under People first.'
              : undefined
          }
        />
      </Panel>

      {/* Always rendered, unlike before: with an empty set the `+` is the only
          way anyone gets a first label, and hiding the section hid it. */}
      <Heading>Labels</Heading>
      <Panel>
        <Row style={styles.wrap}>
          {(labels.data ?? []).map((l) => {
                const on = c.labelIds.includes(l.id);
                return (
                  <Pressable
                    key={l.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Label ${l.name}`}
                    onPress={() =>
                      run(() =>
                        updateCard(
                          cardId,
                          {
                            labelIds: on
                              ? c.labelIds.filter((x) => x !== l.id)
                              : [...c.labelIds, l.id],
                          },
                          user,
                        ),
                      )
                    }
                    style={[
                      styles.chip,
                      { borderColor: l.color, backgroundColor: on ? l.color : 'transparent' },
                    ]}
                  >
                    <Text
                      style={[
                        type.caption,
                        {
                          // Readable ON the fill when selected; muted-but-legible
                          // on transparent when not.
                          color: on
                            ? readableInkOn(l.color, t.text.inverse, t.text.primary) === 'light'
                              ? t.text.inverse
                              : t.text.primary
                            : t.text.secondary,
                          fontWeight: on ? '600' : '400',
                        },
                      ]}
                    >
                      {l.name}
                    </Text>
                  </Pressable>
                );
              })}
          {/* An icon, not a labelled button: it sits in a row of chips and a
              "New label" button would be wider than every one of them. */}
          <IconAction
            icon="add"
            label="New label"
            accent
            disabled={busy || knownLabels === null}
            // No draft to reset: the sheet is mounted only while open, so its
            // name and colour start fresh every time by construction.
            onPress={() => setAddingLabel(true)}
          />
        </Row>
        {labels.status === 'ready' && (labels.data ?? []).length === 0 ? (
          <Hint>No labels yet. Add one with +, and every board gets it.</Hint>
        ) : null}
      </Panel>

      {addingLabel ? (
        <NewLabelSheet
          knownLabels={knownLabels}
          busy={busy}
          onError={setError}
          onClose={() => setAddingLabel(false)}
          onCreate={(name, color) =>
            void run(async () => {
              // Created AND applied in one go — coining a label while looking at
              // a card means you want it on that card.
              const id = await createLabel({ name, color, user });
              await updateCard(cardId, { labelIds: [...c.labelIds, id] }, user);
              setAddingLabel(false);
            })
          }
        />
      ) : null}

      <Heading>Comments ({c.commentCount})</Heading>
      <Comments
        canModerate={canManage}
        cardId={cardId}
        members={assignable}
        prioritiseUids={c.assigneeUids}
        user={user}
      />

      <Heading>Activity</Heading>
      <Panel>
        <ActivityLog
          cardId={cardId}
          members={assignable}
          columns={b.columns}
          cardTitleFor={cardTitleFor}
        />
      </Panel>

      <Heading>Danger zone</Heading>
      <Panel>
        {c.archived ? (
          <Button
            busy={busy}
            label="Restore to the board"
            onPress={() =>
              run(async () => {
                // May land in a different column if its own was deleted while it
                // was archived — see restoreCard.
                const { movedTo } = await restoreCard(c, user, b.columns);
                if (movedTo) {
                  setNote(`Restored to ${movedTo}`);
                  setTimeout(() => setNote(null), 3200);
                }
              })
            }
          />
        ) : (
          <Button
          busy={busy}
            label="Archive card"
            variant="danger"
            onPress={() =>
              run(async () => {
                await archiveCard(cardId, user);
                nav.pop();
              })
            }
          />
        )}
        {canManage ? (
          <>
            <Hint>
              Deleting is permanent and cannot be undone. Everyone else on this
              board can only archive.
            </Hint>
            <Button
              busy={busy}
              label="Delete permanently"
              variant="danger"
              onPress={() =>
                run(async () => {
                  await deleteCard(cardId);
                  nav.pop();
                })
              }
            />
          </>
        ) : null}
      </Panel>

    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  crumbCol: { flex: 1, gap: space.xs },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  shrink: { flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1, gap: space.xs },
  wrap: { flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  // Matches the picker in Board Settings, so choosing a colour looks the same
  // wherever a label is created.
  swatch: { width: 28, height: 28, borderRadius: radius.pill, borderWidth: 2 },
});
