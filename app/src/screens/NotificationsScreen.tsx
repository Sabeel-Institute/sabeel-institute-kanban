import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { NOTIFICATION_RETENTION_DAYS, NOTIFY_EVENTS } from '@sabeel/shared';
import {
  alertsView,
  dismiss,
  dismissAll,
  markAllRead,
  markRead,
  markUnread,
  routeForNotification,
  setNotifyPref,
  useInbox,
  useNotifyPrefs,
  type InboxItem,
} from '../notifications';
import { useMyBoards } from '../boards';
import {
  canOpenPushSettings,
  enablePush,
  openPushSettings,
  pushPromptState,
  registerPush,
} from '../notify';
import { setBoardMuted } from '../notifications';
import type { SessionUser } from '../session';
import { useCheckOnForeground } from '../foreground';
import { useNav } from '../nav';
import {
  Body,
  Button,
  Caption,
  Hint,
  Card as Panel,
  Heading,
  IconAction,
  LoadError,
  Row,
  Screen,
  Spinner,
  Title,
  Toggle,
} from '../components/ui';
import { space, useTheme } from '../theme';
import { useAction } from '../useAction';

function when(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The in-app inbox and notification preferences.
 *
 * The inbox exists because push alone is lossy: a notification swiped away, or
 * arriving while the phone is off, would otherwise be gone. Everything sent is
 * recorded here.
 */
export function NotificationsScreen({ user }: { user: SessionUser }) {
  const nav = useNav();
  const { unreadOnly } = alertsView.use();
  const inbox = useInbox(user, unreadOnly);
  const prefsDoc = useNotifyPrefs(user);
  const boards = useMyBoards(user);
  const t = useTheme();
  const [showSettings, setShowSettings] = useState(false);
  // What this device can be offered about notifications. Resolved on mount and
  // on every return to the front — never in the press handler below, which may
  // not await before asking.
  const [push, setPush] = useState<
    'checking' | 'granted' | 'denied' | 'default' | 'unsupported'
  >('checking');
  const [enabling, setEnabling] = useState(false);
  // Emptying the inbox cannot be undone, so it asks first — same shape as
  // deleting a column.
  const [confirmingDismissAll, setConfirmingDismissAll] = useState(false);
  const { run, busy, error } = useAction('notifications');
  /** The account this screen has already filed a token for — see the effect below. */
  const claimedFor = useRef<string | null>(null);

  const items = inbox.data ?? [];
  const prefs = prefsDoc.data?.prefs ?? {};
  const muted = prefsDoc.data?.mutedBoardIds ?? [];


  // Re-read on every return to the foreground, not only on mount. **Open
  // settings** below leaves the app, and coming back remounts nothing — so this
  // panel went on saying "blocked" over a device that had just been unblocked,
  // offering the same button back to the setting the person had already fixed.
  // See useCheckOnForeground.
  useCheckOnForeground(() => {
    let live = true;
    void (async () => {
      const state = await pushPromptState();
      if (!live) return;
      if (state !== 'granted') {
        // Anything but granted retires what we knew. A browser that has its
        // notification permission revoked drops the push subscription with it,
        // so the token we filed is dead — and if permission comes back, the
        // shortcut below would otherwise report "enabled" over a token nothing
        // can be delivered to. Forgetting here makes the next grant re-register.
        claimedFor.current = null;
        return setPush(state);
      }
      // Permission alone is not enough to promise delivery. Claim the token and
      // report what actually happened, or this says "enabled" over a device
      // with nothing registered behind it.
      //
      // But ONCE ONLY, per account. Reading the permission is cheap; claiming a
      // token is a service-worker registration, an FCM round trip and a
      // Firestore write, and this now runs on every return to the front — which
      // on web is every tab switch, because react-native-web maps that onto
      // document visibility. Registering again tells us nothing we did not
      // learn the first time; the token listener is what catches a rotation.
      if (claimedFor.current === user.uid) return setPush('granted');
      const ok = await registerPush(user.uid);
      if (!live) return;
      if (ok) claimedFor.current = user.uid;
      setPush(ok ? 'granted' : 'unsupported');
    })();
    return () => {
      live = false;
    };
  }, [user.uid]);

  // enablePush must be the FIRST thing this handler does — a browser only
  // honours a permission request raised directly from a click, and an await
  // before it loses that. setEnabling is synchronous, so it does not separate
  // the two. See enablePush in notify.web.ts; on native the rule holds for a
  // different reason (notify.ts), which is that Android would let us ask from
  // anywhere and the wrong moment costs one of only two prompts.
  function turnOnPush() {
    setEnabling(true);
    // .catch as well: a rejection reaching here would leave the button spinning
    // with no way back, which is worse than any answer it could have given.
    void enablePush(user.uid)
      .catch(() => 'unavailable' as const)
      .then(async (result) => {
        setEnabling(false);
        if (result === 'granted') {
          claimedFor.current = user.uid;
          return setPush('granted');
        }
        if (result === 'unavailable') return setPush('unsupported');
        // Re-read rather than assuming 'denied': a browser makes a refusal
        // stick, but a dismissed Android dialog leaves this askable, and the
        // button should come back rather than send someone to a settings screen
        // that shows nothing wrong.
        setPush(await pushPromptState());
      });
  }

  function open(item: InboxItem) {
    void markRead(user, item).catch(() => {});
    // Shared with the push-tap handler so both land on the same screen — see
    // routeForNotification.
    const route = routeForNotification(item);
    if (route) nav.push(route);
  }

  if (inbox.status === 'loading') return <Spinner label="Loading notifications…" />;
  if (inbox.status === 'error') {
    return (
      <Screen width="read">
        <Title>Notifications</Title>
        <LoadError what="your notifications" />
      </Screen>
    );
  }

  const unread = items.filter((i) => !i.read).length;

  return (
    <Screen width="read">
      {/* No Back button: Alerts is a tab root reached from the nav bar. */}
      <Row style={styles.between}>
        <Title>Notifications</Title>
        <IconAction
          icon={showSettings ? 'inbox' : 'settings'}
          label={showSettings ? 'Inbox' : 'Notification settings'}
          onPress={() => setShowSettings((s) => !s)}
        />
      </Row>

      {error ? (
        <Panel>
          <Body>{error}</Body>
        </Panel>
      ) : null}

      {showSettings ? (
        <>
          {/* Held back until the state is known. The check opens IndexedDB, so
              rendering the heading first left it standing over an empty gap. */}
          {push !== 'checking' ? <Heading>This device</Heading> : null}
          {push === 'default' ? (
            <Panel>
              <Body>Notifications are not enabled on this device.</Body>
              <Button
                label="Enable notifications"
                busy={enabling}
                onPress={turnOnPush}
              />
            </Panel>
          ) : null}
          {push === 'granted' ? (
            <Panel>
              <Body>Notifications are enabled on this device.</Body>
            </Panel>
          ) : null}
          {push === 'denied' ? (
            <Panel>
              <Body>Notifications are blocked for this app on this device.</Body>
              {/* Native can open its own settings page; a browser cannot, so
                  there it is instructions or nothing. */}
              {canOpenPushSettings ? (
                <Button
                  label="Open settings"
                  variant="secondary"
                  onPress={openPushSettings}
                />
              ) : (
                <Hint>
                  Allow them in your browser’s site settings, then reopen this
                  screen.
                </Hint>
              )}
            </Panel>
          ) : null}
          {push === 'unsupported' ? (
            <Panel>
              {/* Covers two situations that cannot be told apart from here and
                  should not be: a browser that genuinely lacks the capability,
                  and a device that granted permission but could not be
                  registered. "This device can't SHOW notifications" was true of
                  the first and wrong about the second — it blames the hardware
                  for something the app failed at, to someone who has just
                  pressed Allow and would reasonably go looking for a setting.
                  Set up is what failed, in both. */}
              <Body>Notifications can’t be set up on this device.</Body>
            </Panel>
          ) : null}

          <Heading>What you are told about</Heading>
          {NOTIFY_EVENTS.map((spec) => {
            const on = prefs[spec.event] ?? spec.defaultOn;
            return (
              <Panel key={spec.event}>
                <Row style={styles.between}>
                  <View style={styles.grow}>
                    <Body>{spec.label}</Body>
                    <Hint>{spec.description}</Hint>
                  </View>
                  {/* A setting that is on or off is a toggle, not a button that
                      says which way it is currently pointing. */}
                  <Toggle
                    value={on}
                    disabled={busy}
                    label={spec.label}
                    onValueChange={(next) =>
                      run(() => setNotifyPref(user, spec.event, next, prefs))
                    }
                  />
                </Row>
              </Panel>
            );
          })}

          <Hint>
            Alerts keeps the last {NOTIFICATION_RETENTION_DAYS} days. Anything
            older is removed automatically — the card itself keeps its comments
            and history.
          </Hint>

          <Heading>Mute a board</Heading>
          <Hint>
            Muting silences everything from a board without changing what you are
            told about elsewhere.
          </Hint>
          {(boards.data ?? []).map((b) => {
            const isMuted = muted.includes(b.id);
            return (
              <Panel key={b.id}>
                <Row style={styles.between}>
                  {/* Shrinks and wraps beside the bell: Yoga's flexShrink
                      defaults to 0, so a long name pushed the bell off the row
                      (#123). */}
                  <View style={styles.name}>
                    <Body>{b.name}</Body>
                  </View>
                  {/* The bell says the state and changes it in one tap: struck
                      through means silenced. */}
                  <IconAction
                    icon={isMuted ? 'notifications-off' : 'notifications'}
                    label={isMuted ? `Unmute ${b.name}` : `Mute ${b.name}`}
                    danger={isMuted}
                    disabled={busy}
                    onPress={() => run(() => setBoardMuted(user, b.id, !isMuted, muted))}
                  />
                </Row>
              </Panel>
            );
          })}
        </>
      ) : (
        <>
          <Row style={styles.between}>
            <Hint>
              {items.length === 0
                ? unreadOnly
                  ? 'Nothing unread.'
                  : 'Nothing here yet.'
                : unreadOnly
                  ? `${items.length} unread`
                  : `${unread} unread of ${items.length}`}
            </Hint>
            {/* A tight gap: each IconAction is a laid-out 44pt box, so a wide
                one would push this bar past a narrow phone. */}
            <Row style={styles.actions}>
              {/* An icon in `selected`, not a FilterChip: this bar already
                  carries two 44pt boxes and a labelled chip beside them does not
                  fit a 320px phone. `selected` is what keeps the active filter
                  visible AND one tap from gone, which a filter has to be. */}
              <IconAction
                icon="mark-email-unread"
                label={unreadOnly ? 'Show all alerts' : 'Show unread only'}
                selected={unreadOnly}
                disabled={busy}
                onPress={() => alertsView.set((v) => ({ unreadOnly: !v.unreadOnly }))}
              />
              {unread > 0 ? (
                <IconAction
                  icon="done-all"
                  label="Mark all read"
                  disabled={busy}
                  onPress={() => run(() => markAllRead(user, items))}
                />
              ) : null}
              {items.length > 0 ? (
                <IconAction
                  icon="delete-sweep"
                  label="Dismiss all"
                  danger
                  disabled={busy}
                  onPress={() => setConfirmingDismissAll(true)}
                />
              ) : null}
            </Row>
          </Row>

          {confirmingDismissAll ? (
            <Panel>
              <Body>
                Dismiss all {items.length} notification
                {items.length === 1 ? '' : 's'}? They cannot be brought back.
              </Body>
              <Row>
                <Button
                  busy={busy}
                  label="Dismiss all"
                  variant="danger"
                  onPress={() =>
                    run(async () => {
                      await dismissAll(user, items);
                      setConfirmingDismissAll(false);
                    })
                  }
                />
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setConfirmingDismissAll(false)}
                />
              </Row>
            </Panel>
          ) : null}

          {/*
            The ROW IS NOT A BUTTON — only the text is.

            Wrapping the whole row made a Pressable with `accessibilityRole`
            contain the Dismiss IconAction, and on web that is a <button> inside
            a <button>: invalid HTML, and a press on Dismiss can bubble to the
            outer control, so tapping ✕ risks dismissing AND opening the
            notification. Native's touch system does not double-fire, which is
            why it went unnoticed.

            The whole-row target is not worth that. The text column is `flex: 1`,
            so what you actually aim at is nearly unchanged, and Dismiss now sits
            outside it rather than inside the thing it overlaps.
            `scripts/screens-e2e.mjs` fails on any button nested in a button.
          */}
          {items.map((item) => (
            <Panel
              key={item.id}
              style={
                item.read ? undefined : { borderColor: t.accent.base, borderWidth: 2 }
              }
            >
              <Row style={styles.between}>
                <Pressable
                  onPress={() => open(item)}
                  accessibilityRole="button"
                  accessibilityLabel={item.text}
                  style={styles.grow}
                >
                  <Body>{item.text}</Body>
                  <Caption>
                    {when(item.at)}
                    {item.read ? '' : ' · unread'}
                  </Caption>
                </Pressable>
                {/* One control that SHOWS the state and flips it, not two
                    buttons — the same shape the Owner switch and the People
                    screen's access toggle use. No confirmation: it is trivial
                    and undoes itself on the next tap, so the "destructive
                    actions confirm" rule has nothing to bite on.

                    Marking unread notifies NOBODY. Push goes out inline when the
                    entry is created and no trigger watches this collection, so
                    an update here reaches no server code at all. */}
                <IconAction
                  icon={item.read ? 'mark-email-unread' : 'mark-email-read'}
                  label={
                    item.read
                      ? `Mark unread: ${item.text}`
                      : `Mark read: ${item.text}`
                  }
                  disabled={busy}
                  onPress={() =>
                    run(() =>
                      item.read ? markUnread(user, item) : markRead(user, item),
                    )
                  }
                />
                <IconAction
                  icon="close"
                  label={`Dismiss: ${item.text}`}
                  disabled={busy}
                  onPress={() => run(() => dismiss(user, item))}
                />
              </Row>
            </Panel>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between', alignItems: 'center' },
  name: { flex: 1, minWidth: 0 },
  grow: { flex: 1, gap: space.xs },
  actions: { gap: space.xs },
});

