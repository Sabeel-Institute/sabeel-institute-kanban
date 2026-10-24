import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '../icons';
import { attachmentKind, formatBytes } from '@sabeel/shared';
import {
  attachmentUrl,
  removeAttachment,
  uploadAttachment,
  useAttachments,
  type Attachment,
  type PickedFile,
} from '../attachments';
import { PICK_SOURCES, pickAttachment, type PickSource } from '../filePicker';
import { openAttachment } from '../openAttachment';
import { confirmAction } from '../confirm';
import { useAction } from '../useAction';
import type { SessionUser } from '../session';
import { radius, space, useTheme } from '../theme';
import {
  Body,
  Caption,
  Card as Panel,
  Heading,
  Hint,
  IconAction,
  LoadError,
  ProgressBar,
  Row,
  Spinner,
} from './ui';
import { Sheet, SheetOption } from './Sheet';
import { AttachSheet } from './AttachSheet';


/** A glyph for the file's kind. Decoration inside a pressable row, not an action. */
function glyphFor(contentType: string): IconName {
  if (contentType === 'application/pdf') return 'picture-as-pdf';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'movie';
  if (contentType.startsWith('audio/')) return 'audiotrack';
  if (/zip|compressed|tar|rar|7z/.test(contentType)) return 'folder-zip';
  if (/sheet|excel|csv/.test(contentType)) return 'table-chart';
  if (/word|document|text\//.test(contentType)) return 'description';
  return 'insert-drive-file';
}

const SOURCE_LABELS: Record<PickSource, { label: string; detail: string }> = {
  files: { label: 'Choose a file', detail: 'Documents, PDFs, anything' },
  photos: { label: 'Photo library', detail: 'Pick an existing photo' },
  camera: { label: 'Take a photo', detail: 'Use the camera now' },
};

/**
 * Files on a card.
 *
 * The upload state lives HERE, above the per-row branch, and that placement is
 * load-bearing. An upload spans the moment its record starts existing — the
 * document is created first, because creating it is what authorizes the upload
 * — so the live query flips a row from absent to present *while bytes are still
 * moving*. Anything keyed on "does the row exist" would be destroyed exactly
 * when it is needed, leaving a healthy upload rendering as a broken file for its
 * whole duration.
 *
 * For the same reason a row in `uploading` with nothing in flight is a NORMAL
 * state, not an error: a reload, or an upload that genuinely failed. It says so
 * and offers removal, rather than looking like a file that ought to open.
 */
export function Attachments({
  cardId,
  user,
}: {
  cardId: string;
  user: SessionUser;
}) {
  const t = useTheme();
  const list = useAttachments(cardId);
  const { run, busy, error } = useAction('attachments');
  const [progress, setProgress] = useState<Record<string, number | null>>({});
  const [picking, setPicking] = useState(false);

  /**
   * Which file is being opened — as state so the row can say so, and as a ref so
   * the tap handler can refuse a second one.
   *
   * What shipped had NEITHER, and the open row was also the one control in this
   * panel that never consulted `busy`. So it stayed live for the whole of a slow
   * open, an ordinary second tap started a second one, and on Android that
   * duplicate reached expo-sharing — which keeps exactly ONE pending promise
   * (SharingModule.kt) and rejects anything arriving while a chooser is up. A
   * member was shown "Call to function 'ExpoSharing.shareAsync' has been
   * rejected" (Sentry, 2026-07-27).
   *
   * `busy` alone would have covered that tap. The ref covers what it structurally
   * cannot: `busy` and `opening` are state, so they only reach a handler after a
   * render, and two taps inside one frame both read "idle" and both start.
   *
   * The pair is always written through `beginOpen`/`endOpen`, so it cannot drift.
   */
  const [opening, setOpening] = useState<string | null>(null);
  const openingRef = useRef<string | null>(null);

  /** Claims the open slot, or returns false if a file is already opening. */
  const beginOpen = (id: string) => {
    if (openingRef.current !== null) return false;
    openingRef.current = id;
    setOpening(id);
    return true;
  };
  const endOpen = () => {
    openingRef.current = null;
    setOpening(null);
  };

  /**
   * The naming step, as a promise the sheet settles.
   *
   * Shaped this way so the whole attach stays ONE `run` call: `busy` must span
   * the pick, the naming and the upload, or the attach control takes a second
   * tap while a sheet is already open. `confirmAction` hands a boolean back into
   * a `run` callback the same way — this is that, with a string.
   *
   * The resolver is a ref rather than state because it must be readable by the
   * handler that settles it without waiting for a render.
   */
  const [naming, setNaming] = useState<{ name: string; sizeBytes: number } | null>(null);
  const namingResolve = useRef<((name: string | null) => void) | null>(null);

  const askName = (picked: PickedFile) =>
    new Promise<string | null>((resolve) => {
      namingResolve.current = resolve;
      setNaming({ name: picked.name, sizeBytes: picked.blob.size });
    });

  /** Null is a cancel — the backdrop, Escape, and Android Back all land here. */
  const settleName = (name: string | null) => {
    const resolve = namingResolve.current;
    namingResolve.current = null;
    setNaming(null);
    resolve?.(name);
  };

  /**
   * Settle a pending naming promise on the way out.
   *
   * Without it the `run` callback awaiting `askName` never resumes when this
   * panel unmounts with the sheet open — which browser Back does, since `nav.ts`
   * is wired to `onPopState`. Nothing after the `await` runs: `timed`'s and
   * `useAction`'s `finally` never fire, and the suspended closure pins
   * `picked.blob` — the whole file, up to 10 MB — for the life of the JS
   * context, silently.
   *
   * Refs only, deliberately: `settleName` also calls `setNaming`, which is a
   * no-op on an unmounted component and pointless work to schedule.
   */
  useEffect(
    () => () => {
      const resolve = namingResolve.current;
      namingResolve.current = null;
      resolve?.(null);
    },
    [],
  );

  /**
   * Claims the attach slot synchronously, released when the whole attach ends.
   *
   * `busy` is state, so two taps inside one frame both read "idle" — the same
   * structural gap `beginOpen` above exists for. Here the consequence is worse
   * than a duplicate upload: the second `start` would replace the naming sheet's
   * resolver without the first ever settling, and because `naming` never passes
   * through null the sheet is not remounted — so the field would still hold file
   * A's stem while the extension, the kind, the size and the bytes were all file
   * B's, and Upload would send B under A's name.
   */
  const attaching = useRef(false);

  const start = (source: PickSource) => {
    if (attaching.current) return;
    attaching.current = true;
    setPicking(false);
    let started: string | null = null;
    void run(async (untimed) => {
      // The pick is UNTIMED but still inside `run`, and the split is the point:
      // `busy` must span the picker so the attach control stops taking taps,
      // while the slow-write clock must not — browsing your files, framing a
      // photo or answering the camera prompt is not this app being slow. Shipped
      // charged, and it dominated: ~33s in the picker was filed as
      // `uploadAttachment took 37992ms`, and backing out reported a slow write
      // for a write that never happened.
      const picked = await untimed(() => pickAttachment(source));
      if (!picked) return;
      // UNTIMED for the same reason the pick above is: a person deciding what to
      // call a file is not this app being slow, and charging it would refile the
      // very bug v0.7.8 fixed. The sheet also owns the size limit — it refuses
      // an over-large file before a single byte or document is written, where it
      // reads as a fact about the file rather than as something going wrong.
      const name = await untimed(() => askName(picked));
      if (name === null) return;
      try {
        await uploadAttachment({
          cardId,
          picked: { ...picked, name },
          user,
          untimed,
          onStart: (id) => {
            started = id;
            setProgress((p) => ({ ...p, [id]: null }));
          },
          onProgress: (id, fraction) => setProgress((p) => ({ ...p, [id]: fraction })),
        });
      } finally {
        // Drop the local tracking either way: on success the row is `ready` and
        // renders from the document, and on failure the row is gone.
        if (started) {
          const id = started;
          setProgress((p) => {
            const next = { ...p };
            delete next[id];
            return next;
          });
        }
      }
    }, 'uploadAttachment').finally(() => {
      attaching.current = false;
    });
  };

  const attach = () => {
    if (PICK_SOURCES.length === 1) return start(PICK_SOURCES[0]);
    setPicking(true);
  };

  const remove = (a: Attachment) => {
    void (async () => {
      const ok = await confirmAction(
        'Remove this file?',
        `${a.name} will be deleted for everyone on this board. This cannot be undone.`,
      );
      if (!ok) return;
      void run(() => removeAttachment(cardId, a.id), 'removeAttachment');
    })();
  };

  // NOT awaited before `run`: the tab has to be opened while the tap is still
  // the reason anything is happening, or the browser blocks it silently.
  const open = (a: Attachment) => {
    if (!beginOpen(a.id)) return;
    void run(
      (untimed) =>
        openAttachment(
          { id: a.id, name: a.name, contentType: a.contentType },
          () => attachmentUrl(cardId, a.id),
          untimed,
        ),
      'openAttachment',
    ).finally(endOpen);
  };

  const items = list.data ?? [];

  return (
    <>
      <Heading
        action={
          PICK_SOURCES.length > 0 ? (
            <IconAction
              icon="attach-file"
              label="Attach a file"
              onPress={attach}
              disabled={busy}
            />
          ) : null
        }
      >
        Attachments{items.length > 0 ? ` (${items.length})` : ''}
      </Heading>

      <Panel>
        {/* Body, not Hint: this is a failure the reader has to act on, and
            Hint is the muted style reserved for small supporting copy. Same
            shape Comments and CardScreen use for an action error. */}
        {error ? <Body>{error}</Body> : null}

        {list.status === 'loading' ? <Spinner label="Loading files…" /> : null}
        {list.status === 'error' ? <LoadError what="the files" code={list.error} /> : null}

        {list.status === 'ready' && items.length === 0 ? (
          <Hint>
            {PICK_SOURCES.length > 0
              ? 'No files yet.'
              : 'No files yet. Adding one needs a newer version of the app.'}
          </Hint>
        ) : null}

        {items.map((a) => {
          const tracked = a.id in progress;
          const ready = a.status === 'ready';

          if (!ready && tracked) {
            const fraction = progress[a.id];
            return (
              <View key={a.id} style={styles.uploading}>
                <Body numberOfLines={1}>{a.name}</Body>
                <ProgressBar
                  fraction={fraction}
                  label={
                    fraction === null
                      ? 'Preparing…'
                      : fraction < 1
                        ? `Uploading ${Math.round(fraction * 100)}%`
                        : 'Finishing…'
                  }
                />
              </View>
            );
          }

          // Opening is SLOW and used to be silent. Native mints a signed URL and
          // then downloads the whole file before any viewer appears, so up to
          // 10 MB of phone connection passes with the row looking untouched —
          // which is why someone tapped it again and hit the share rejection.
          // The row now says what it is doing and stops taking taps.
          const isOpening = opening === a.id;
          const openable = ready && !busy;

          return (
            <Row key={a.id} style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isOpening ? `Opening ${a.name}` : ready ? `Open ${a.name}` : a.name
                }
                accessibilityState={{ disabled: !openable, busy: isOpening }}
                onPress={openable ? () => open(a) : undefined}
                disabled={!openable}
                style={({ pressed }) => [styles.face, pressed && openable && { opacity: 0.6 }]}
              >
                {isOpening ? (
                  // Same 20pt box as the glyph it replaces, so the row does not
                  // jump as it starts and stops.
                  <ActivityIndicator size="small" color={t.accent.base} style={styles.glyph} />
                ) : (
                  <Icon
                    name={ready ? glyphFor(a.contentType) : 'error-outline'}
                    size={20}
                    color={ready ? t.text.muted : t.text.danger}
                    style={styles.glyph}
                  />
                )}
                <View style={styles.text}>
                  <Body numberOfLines={1}>{a.name}</Body>
                  {isOpening ? (
                    <Hint>Opening…</Hint>
                  ) : ready ? (
                    <Caption>
                      {attachmentKind(a.name)}
                      {a.sizeBytes ? ` · ${formatBytes(a.sizeBytes)}` : ''}
                    </Caption>
                  ) : (
                    <Hint>Upload didn’t finish</Hint>
                  )}
                </View>
              </Pressable>
              <IconAction
                icon="delete-outline"
                label={`Remove ${a.name}`}
                danger
                disabled={busy}
                onPress={() => remove(a)}
              />
            </Row>
          );
        })}
      </Panel>

      <Sheet visible={picking} title="Where from?" onClose={() => setPicking(false)}>
        {PICK_SOURCES.map((s) => (
          <SheetOption
            key={s}
            label={SOURCE_LABELS[s].label}
            detail={SOURCE_LABELS[s].detail}
            onPress={() => start(s)}
          />
        ))}
      </Sheet>

      <AttachSheet
        name={naming?.name ?? null}
        sizeBytes={naming?.sizeBytes ?? 0}
        onCancel={() => settleName(null)}
        onConfirm={settleName}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { justifyContent: 'space-between', gap: space.xs },
  // The row is the touch target, so it fills the space the delete icon leaves.
  face: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Fixed box for the leading mark, so swapping the file glyph for a spinner
  // while it opens does not shift the name sideways.
  glyph: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  uploading: { gap: space.xs, paddingVertical: space.xs, borderRadius: radius.sm },
});
