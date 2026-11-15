import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { deleteCard, restoreCard, useArchivedBoardCards } from '../cards';
import { canManageBoard } from '@sabeel/shared';
import { useBoard } from '../boards';
import { useLabels } from '../labels';
import { confirmAction } from '../confirm';
import type { SessionUser } from '../session';
import { useNav } from '../nav';
import { CardFace } from '../components/CardFace';
import {
  Body,
  Card as Panel,
  Hint,
  IconAction,
  LoadError,
  Row,
  Screen,
  Spinner,
  Title,
} from '../components/ui';
import { space } from '../theme';
import type { Label } from '@sabeel/shared';
import { useAction } from '../useAction';

const NO_LABELS: Label[] = [];

/**
 * A board's archived cards, and the way back out.
 *
 * Archiving is the reversible half of the delete/archive pair — members can only
 * archive, precisely so nothing is lost by accident. But an archived card left
 * the board and there was no route back that anyone found: the only one was
 * global Search, in a different tab, behind an "Including archived" toggle that
 * gave no hint it was where your card went. A reversible action you cannot
 * discover how to reverse is not reversible.
 *
 * Reached from the board's own header, because that is where you are standing
 * when you wonder where a card went.
 */
export function BoardArchiveScreen({
  boardId,
  user,
}: {
  boardId: string;
  user: SessionUser;
}) {
  const nav = useNav();
  const board = useBoard(boardId);
  // Permanent deletion is this board's owners and admins — not a rank.
  const canManage = canManageBoard(user, board.data);
  const cards = useArchivedBoardCards(boardId);
  const allLabels = useLabels();
  const { run, busy, error } = useAction('boardArchive');
  /** Set only when a restore had to land the card somewhere else. */
  const [note, setNote] = useState<string | null>(null);

  if (board.status === 'loading' || cards.status === 'loading') {
    return <Spinner label="Loading archive…" />;
  }
  if (cards.status === 'error') {
    return (
      <Screen width="read">
        <Title>Archived cards</Title>
        <LoadError what="the archive" />
      </Screen>
    );
  }

  const b = board.data;
  if (!b) {
    // See BoardSettingsScreen: a refused read is not a missing board.
    return (
      <Screen width="read">
        <Row style={styles.between}>
          <Title numberOfLines={1} style={styles.grow}>
            {board.status === 'error' ? 'Board unavailable' : 'Board not found'}
          </Title>
          <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
        </Row>
        {board.status === 'error' ? (
          <LoadError what="this board" code={board.error} />
        ) : null}
      </Screen>
    );
  }

  const archived = cards.data ?? [];

  return (
    <Screen width="read">
      <Row style={styles.between}>
        <Title numberOfLines={1} style={styles.grow}>
          Archived cards
        </Title>
        <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
      </Row>
      <Hint>{b.name}</Hint>

      {error ? (
        <Panel>
          <Body>{error}</Body>
        </Panel>
      ) : null}

      {note ? (
        <Panel>
          <Body>{note}</Body>
        </Panel>
      ) : null}

      {archived.length === 0 ? (
        <Panel>
          <Body>Nothing is archived on this board.</Body>
          <Hint>
            Archiving a card takes it off the board but keeps it — it will show up
            here, and can be put back at any time.
          </Hint>
        </Panel>
      ) : null}

      {/*
        Icons ON the card's own row, not labelled buttons under it. A list of
        archived cards repeats these controls once per row, and "Restore to the
        board" written out N times reads as noise and costs a button-height band
        every time. The words survive in the accessibility labels.
      */}
      {archived.map((card) => (
        <Panel key={card.id}>
          {/* Top-aligned, not centred: a card face carrying labels, a due date
              and assignees is several lines tall, and Row's default would float
              these icons in the middle of it instead of beside the title. */}
          <Row style={styles.rowTop}>
            {/* The same face the board draws, so an archived card is
                recognisable rather than reduced to a line of text. */}
            <View style={styles.grow}>
              <CardFace
                card={card}
                labels={allLabels.data ?? NO_LABELS}
                boardMembers={b.members}
                unnamed
              />
            </View>
            <IconAction
              icon="unarchive"
              label={`Restore ${card.title} to the board`}
              disabled={busy}
              onPress={() =>
                run(async () => {
                  const { movedTo } = await restoreCard(card, user, b.columns);
                  // Its own column may have been deleted while it sat here. Say
                  // where it actually went rather than letting it reappear
                  // somewhere the user is not looking.
                  if (movedTo) {
                    setNote(`“${card.title}” went back to ${movedTo} — the column it was archived from no longer exists.`);
                  }
                })
              }
            />
            {/* Permanent deletion stays this board's owners and admins, as on the
                card itself — the archive is not a back door around that.
                It ASKS FIRST: this shipped as a bare button that deleted on the
                first tap, one row away from Restore, with no undo behind it. */}
            {canManage ? (
              <IconAction
                icon="delete-outline"
                danger
                label={`Delete ${card.title} permanently`}
                disabled={busy}
                onPress={() => {
                  void (async () => {
                    const ok = await confirmAction(
                      'Delete permanently?',
                      `“${card.title}” will be gone for everyone, along with its comments and files. This cannot be undone — leaving it archived keeps it recoverable.`,
                    );
                    if (ok) run(() => deleteCard(card.id));
                  })();
                }}
              />
            ) : null}
          </Row>
        </Panel>
      ))}

      <View style={styles.tail} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between', alignItems: 'center' },
  rowTop: { alignItems: 'flex-start' },
  grow: { flex: 1 },
  tail: { height: space.xl },
});
