import { Pressable, StyleSheet, Text, View } from 'react-native';
import { notesVersionLine } from '@sabeel/shared';
import { useBoard } from '../boards';
import {
  saveBoardNotes,
  useBoardNotes,
  useNotesVersions,
  type NotesVersion,
} from '../boardNotes';
import { when } from '../activityTime';
import { confirmAction } from '../confirm';
import { useNav } from '../nav';
import type { SessionUser } from '../session';
import { useAction } from '../useAction';
import { useLayout } from '../theme/layout';
import { radius, space, type, useTheme } from '../theme';
import { ActivityActor } from '../components/ActivityActor';
import { RichText } from '../components/RichText';
import { Body, Button, Hint, IconAction, LoadError, Row, Screen, Spinner, Title } from '../components/ui';

type Members = readonly { uid: string; displayName: string }[];

function nameOf(v: NotesVersion, members: Members): string {
  return v.byName ?? members.find((m) => m.uid === v.by)?.displayName ?? 'Someone';
}

/**
 * The notes' history: one version per sitting, newest first, each naming
 * who saved it and how many lines it added and removed
 * (`functions/src/boardNotes.ts` writes them). Opening one previews the notes
 * as it left them, with a way to put them back. No marked-up comparison:
 * the counts and a preview are enough to choose what to restore (Faisal,
 * 2026-11-25).
 *
 * On a phone the list and a version are a screen each; on a wide screen the
 * version sits beside the list, and choosing another replaces it, so Back
 * leaves the history rather than walking every version looked at.
 */
export function NotesHistoryScreen({
  boardId,
  versionId,
  user,
}: {
  boardId: string;
  versionId?: string;
  user: SessionUser;
}) {
  const nav = useNav();
  const { isWide } = useLayout();
  const board = useBoard(boardId);
  const versions = useNotesVersions(boardId);
  const members = board.data?.members ?? [];
  const list = versions.data ?? [];
  // A wide screen always shows a version: the newest until one is chosen.
  const shownId = versionId ?? (isWide ? list[0]?.id : undefined);
  const index = list.findIndex((v) => v.id === shownId);
  const shown = index >= 0 ? list[index] : undefined;

  const open = (id: string) =>
    isWide
      ? nav.replace({ name: 'boardNotesHistory', boardId, versionId: id })
      : nav.push({ name: 'boardNotesHistory', boardId, versionId: id });

  const header = (
    <Row style={styles.between}>
      <Title numberOfLines={1} style={styles.shrink}>
        {shown && !isWide ? `${nameOf(shown, members)} · ${when(shown.at)}` : 'Notes history'}
      </Title>
      <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
    </Row>
  );

  if (versions.status === 'loading') {
    return (
      <Screen width={isWide ? 'list' : 'read'}>
        {header}
        <Spinner label="Loading the history…" />
      </Screen>
    );
  }
  if (versions.status === 'error') {
    return (
      <Screen width={isWide ? 'list' : 'read'}>
        {header}
        <LoadError what="the notes history" code={versions.error} />
      </Screen>
    );
  }

  const listView = (
    <VersionList versions={list} members={members} selected={shown?.id} onOpen={open} />
  );
  const versionView = shown ? (
    <VersionView boardId={boardId} version={shown} members={members} user={user} />
  ) : versionId ? (
    <Hint>That version is not in the history.</Hint>
  ) : null;

  return (
    <Screen width={isWide ? 'list' : 'read'}>
      {header}
      {isWide ? (
        <Row style={styles.split}>
          <View style={styles.side}>{listView}</View>
          <View style={styles.main}>{versionView}</View>
        </Row>
      ) : versionId ? (
        versionView
      ) : (
        listView
      )}
    </Screen>
  );
}

function VersionList({
  versions,
  members,
  selected,
  onOpen,
}: {
  versions: NotesVersion[];
  members: Members;
  selected?: string;
  onOpen: (id: string) => void;
}) {
  const t = useTheme();
  if (versions.length === 0) return <Hint>No versions yet. The first save makes one.</Hint>;
  return (
    <View style={styles.list}>
      {versions.map((v) => {
        const on = v.id === selected;
        const name = nameOf(v, members);
        return (
          <Pressable
            key={v.id}
            accessibilityRole="button"
            accessibilityLabel={`${name}, ${when(v.at)}: ${notesVersionLine(v)}`}
            accessibilityState={{ selected: on }}
            onPress={() => onOpen(v.id)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: on ? t.bg.accentSoft : t.bg.surface,
                borderColor: on ? t.accent.base : t.border.subtle,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[type.body, { color: t.text.primary }]}>
              <Text style={styles.strong}>
                <ActivityActor name={name} via={v.via} />
              </Text>
              <Text style={{ color: t.text.secondary }}>{` · ${when(v.at)}`}</Text>
            </Text>
            <Hint>{notesVersionLine(v)}</Hint>
          </Pressable>
        );
      })}
    </View>
  );
}

function VersionView({
  boardId,
  version,
  members,
  user,
}: {
  boardId: string;
  version: NotesVersion;
  members: Members;
  user: SessionUser;
}) {
  const t = useTheme();
  const nav = useNav();
  const notes = useBoardNotes(boardId);
  const { run, busy, error } = useAction('restoreNotes');
  const name = nameOf(version, members);
  // Against the page itself, not the list's first row: the newest save may
  // not have been recorded as a version yet.
  const current = notes.data ? version.version >= notes.data.version : false;

  const restore = async () => {
    const ok = await confirmAction(
      'Restore this version?',
      `The notes go back to how ${name} left them, ${when(version.at)}. What is there now stays in the history.`,
    );
    if (!ok || !notes.data) return;
    const page = notes.data;
    await run(async () => {
      await saveBoardNotes(boardId, version.text, page.version, user, version.id);
      nav.pop();
    });
  };

  return (
    <View style={styles.version} testID="notes-version">
      <Hint>
        <Text>{notesVersionLine(version)}</Text>
        <Text>{` · saved by `}</Text>
        <ActivityActor name={name} via={version.via} />
      </Hint>
      <View style={[styles.preview, { backgroundColor: t.bg.raised, borderColor: t.border.subtle }]}>
        {version.text.trim() ? <RichText markdown={version.text} /> : <Hint>Empty.</Hint>}
      </View>
      {error ? <Body>{error}</Body> : null}
      {current ? (
        <Hint>This is how the notes stand now.</Hint>
      ) : (
        <Row>
          <Button
            label="Restore this version"
            variant="secondary"
            busy={busy}
            disabled={!notes.data}
            onPress={() => void restore()}
          />
        </Row>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  shrink: { flexShrink: 1 },
  split: { alignItems: 'flex-start', gap: space.lg },
  side: { width: 320, flexShrink: 0 },
  main: { flex: 1, minWidth: 0 },
  list: { gap: space.sm },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  strong: { fontWeight: '600' },
  version: { gap: space.md },
  preview: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
  },
});
