import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { type MentionCandidate } from '@sabeel/shared';
import { addComment, deleteComment, editComment, useComments } from '../comments';
import type { SessionUser } from '../session';
import type { BoardMemberProfile } from '../boards';
import {
  Body,
  Button,
  Hint,
  LoadError,
  Card as Panel,
  IconAction,
  Row,
  Spinner,
} from './ui';
import { RichText } from './RichText';
import { RichEditor } from './RichEditor';
import { space } from '../theme';
import { useAction } from '../useAction';

function when(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Editing one comment, with the draft owned HERE.
 *
 * UNMOUNT-SCOPED — no dirty flag and no reseeding effect, deliberately. This
 * renders only while its row is the one being edited, so the lifecycle is the
 * reset and there is no server value that could arrive mid-edit to be clobbered
 * by. Do NOT "fix" this by copying `CardDescription`'s shape: that one needs a
 * dirty flag because its parent keeps it mounted and re-feeds it the server's
 * copy, which is not the situation here.
 *
 * `editing` stays in the parent, so "only one row at a time" is unchanged by
 * this component existing.
 */
function CommentEditor({
  initialBody,
  candidates,
  prioritiseUids,
  busy,
  onSave,
  onCancel,
}: {
  initialBody: string;
  candidates: readonly MentionCandidate[];
  prioritiseUids?: readonly string[];
  busy: boolean;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialBody);

  return (
    <>
      {/* Seeded from the PROP, not from `draft`. `RichEditor` seeds once either
          way, so this is the same behaviour — but the prop is what the initial
          markdown actually is, and handing it a value that changes on every
          keystroke invites someone to conclude the seam is controlled. */}
      <RichEditor
        initialMarkdown={initialBody}
        onChangeMarkdown={setDraft}
        candidates={candidates}
        prioritiseUids={prioritiseUids}
        placeholder="Edit your comment — @ to mention someone"
        testID="comment-edit-editor"
        minHeight={72}
      />
      <Row>
        <Button
          busy={busy}
          disabled={draft.trim().length === 0 || busy}
          label="Save"
          onPress={() => onSave(draft)}
        />
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
      </Row>
    </>
  );
}

/**
 * The comment box, owning its draft and its remount key.
 *
 * Both belong together and neither belongs to the list. With `draft` in
 * `Comments`, typing a comment re-rendered every comment above it plus their
 * markdown — measured at 21.1 ms/char on a card with 25 comments against 4.8 on
 * a card with none, a 4.4x penalty for the crime of having a busy card.
 * `scripts/typing-perf-e2e.mjs` holds that ratio near 1 from here on.
 */
function CommentComposer({
  cardId,
  candidates,
  prioritiseUids,
  user,
  run,
  busy,
}: {
  cardId: string;
  candidates: readonly MentionCandidate[];
  prioritiseUids?: readonly string[];
  user: SessionUser;
  /** Shared with the list, so errors reach the one banner it renders. The
   *  optional label is load-bearing: this call site passes `addComment`. */
  run: (fn: () => Promise<unknown>, label?: string) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState('');
  /**
   * Bumped to remount the composer after a successful post.
   *
   * The rich editor is UNCONTROLLED — it seeds from `initialMarkdown` once, so
   * setting `draft` back to '' does not empty the box. A remount is safe at
   * exactly this moment and no other: the text has already been handed to
   * `addComment`, so there is nothing to lose.
   */
  const [composerKey, setComposerKey] = useState(0);

  return (
    <Panel>
      <RichEditor
        key={composerKey}
        initialMarkdown={draft}
        onChangeMarkdown={setDraft}
        candidates={candidates}
        prioritiseUids={prioritiseUids}
        placeholder="Add a comment — @ to mention someone"
        testID="comment-editor"
        minHeight={72}
      />

      {/* Submit sits DIRECTLY under the field. The mention hint used to be
          between them, pushing the button ~50dp lower — far enough that the
          keyboard covered it while the field itself stayed clear, so there was
          nothing to scroll and no way to reach Comment without dismissing the
          keyboard. The hint is guidance, not a step, so it reads fine after. */}
      <Button
        label="Comment"
        disabled={draft.trim().length === 0 || busy}
        busy={busy}
        onPress={() => {
          // Clear the box IMMEDIATELY rather than after the server
          // acknowledges. `addDoc` resolves on server ack, which on a phone
          // can take many seconds — during which the draft sat there, the
          // button stayed enabled, and nothing indicated progress. It looked
          // dead, so you tap it again. Firestore applies the write locally
          // first, so the comment appears on its own.
          //
          // The text is restored if the write actually fails, because losing
          // what someone typed is far worse than a second of uncertainty.
          const body = draft;
          setDraft('');
          setComposerKey((k) => k + 1);
          void run(async () => {
            try {
              await addComment({ cardId, body, candidates, user });
            } catch (e) {
              // Restore what they typed, and remount so the box shows it
              // again — losing it is far worse than a second of uncertainty.
              setDraft(body);
              setComposerKey((k) => k + 1);
              throw e;
            }
          }, 'addComment');
        }}
      />

      {/* You can only mention people who can open the card, which is board
          members. If you are the only one, say so rather than letting the
          autocomplete look broken. */}
      {candidates.length <= 1 ? (
        <Hint>
          You are the only member of this board, so there is nobody to mention
          yet. Add people in Board settings → People.
        </Hint>
      ) : null}
    </Panel>
  );
}

/**
 * The card's comment thread.
 *
 * NOT memoised, and that is a deliberate removal rather than an oversight. It
 * used to be, because the card screen held the description draft and so
 * re-rendered this whole list on every keystroke. The draft now lives in the
 * editor that owns it, so there is no per-character render here to prevent —
 * and a memo kept for a reason that no longer exists is inert machinery plus a
 * standing requirement that every prop stay referentially stable forever.
 *
 * `scripts/typing-perf-e2e.mjs` measures the property directly, so a re-hoist
 * is caught by a test rather than guarded by a wrapper nobody can evaluate.
 */
export function Comments({
  cardId,
  members,
  prioritiseUids,
  canModerate,
  user,
}: {
  cardId: string;
  members: readonly BoardMemberProfile[];
  /** The card's assignees, floated to the top of the mention list — the people
   *  a comment on this card is most likely to be addressed to. */
  prioritiseUids?: readonly string[];
  /**
   * Whether this person may delete SOMEONE ELSE'S comment — the moderation path.
   *
   * A prop rather than a `sessionCan` call, because it is a property of the
   * BOARD now: its owners moderate it, and an org role grants no part of that.
   * The card screen has the board; this component does not.
   */
  canModerate: boolean;
  user: SessionUser;
}) {
  const comments = useComments(cardId);
  // Which row is open, and nothing about what has been typed into it — the
  // drafts live in the two components below. This is what keeps typing a
  // comment from re-rendering every comment above it.
  const [editing, setEditing] = useState<string | null>(null);
  const { run, busy, error } = useAction('comments');

  const candidates: MentionCandidate[] = useMemo(
    () => members.map((m) => ({ uid: m.uid, displayName: m.displayName, email: m.email })),
    [members],
  );

  const nameFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of candidates) m.set(c.uid, c.displayName);
    return m;
  }, [candidates]);

  if (comments.status === 'loading') return <Spinner label="Loading comments…" />;

  /**
   * A failed read is not an empty thread.
   *
   * `?? []` below turns "we could not find out" into "there are none", and the
   * heading above already says `Comments (3)` from the card's own counter — so a
   * refused or dropped listen rendered a count beside the words "No comments
   * yet", which is a definite claim contradicting the number next to it.
   *
   * It also has to say so ITSELF now: a `permission-denied` no longer raises the
   * app-wide banner, deliberately, because the screen that asked is the right
   * place to explain it.
   */
  if (comments.status === 'error') {
    return <LoadError what="this conversation" code={comments.error} />;
  }

  const list = comments.data ?? [];

  return (
    <>
      {error ? (
        <Panel>
          <Body>{error}</Body>
        </Panel>
      ) : null}

      {list.length === 0 ? <Hint>No comments yet.</Hint> : null}

      {list.map((c) => {
        const mine = c.authorUid === user.uid;
        const canDelete = mine || canModerate;
        return (
          <Panel key={c.id}>
            {/* Actions live ON the byline, not under the comment. Full-size
                Edit/Delete buttons cost a whole row each, so a thread of three
                comments spent more height on chrome than on what people wrote.
                These are quiet text actions with a generous hitSlop — the touch
                target stays finger-sized while the visual footprint is a word. */}
            <Row style={styles.between}>
              <Hint>
                {nameFor.get(c.authorUid) ?? 'Someone'} · {when(c.createdAt)}
                {c.editedAt ? ' · edited' : ''}
              </Hint>
              {editing !== c.id ? (
                <Row style={styles.actions}>
                  {/* Only the author edits: an owner rewriting someone's words
                      under their name would be worse than useless. */}
                  {mine ? (
                    <IconAction
                      icon="edit"
                      label="Edit comment"
                      onPress={() => setEditing(c.id)}
                    />
                  ) : null}
                  {canDelete ? (
                    <IconAction
                      icon="delete-outline"
                      label="Delete comment"
                      danger
                      onPress={() => run(() => deleteComment(cardId, c.id))}
                    />
                  ) : null}
                </Row>
              ) : null}
            </Row>

            {editing === c.id ? (
              <CommentEditor
                initialBody={c.body}
                candidates={candidates}
                prioritiseUids={prioritiseUids}
                busy={busy}
                onSave={(body) =>
                  run(async () => {
                    await editComment({ cardId, commentId: c.id, body, candidates });
                    setEditing(null);
                  })
                }
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <RichText markdown={c.body} />
                {c.mentionUids.length > 0 ? (
                  <Hint>
                    mentioned{' '}
                    {c.mentionUids.map((u) => nameFor.get(u) ?? 'someone').join(', ')}
                  </Hint>
                ) : null}
              </>
            )}
          </Panel>
        );
      })}

      <CommentComposer
        cardId={cardId}
        candidates={candidates}
        prioritiseUids={prioritiseUids}
        user={user}
        run={run}
        busy={busy}
      />
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space.md },
  between: { justifyContent: 'space-between' },
  wrap: { flexWrap: 'wrap' },
});
