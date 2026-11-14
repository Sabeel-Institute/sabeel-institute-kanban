import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ROLES, type Role, type UserStatus } from '@sabeel/shared';
import { setUserAccess, useAllUsers, type AdminUserRow } from '../users';
import { boardsSolelyOwnedBy } from '../boards';
import { confirmAction } from '../confirm';
import { toUserMessage } from '../errors';
import type { SessionUser } from '../session';
import { useNav } from '../nav';
import {
  Body,
  Button,
  Hint,
  IconAction,
  LoadError,
  Card,
  Row,
  Screen,
  Spinner,
  Title,
  Toggle,
} from '../components/ui';
import { radius, space, type, useTheme } from '../theme';

/** Pending first — they are the thing an admin came here to act on. */
const statusRank: Record<UserStatus, number> = {
  pending: 0,
  active: 1,
  rejected: 2,
  disabled: 3,
};

/**
 * Account administration.
 *
 * Follows the sibling time-tracker app's conventions, deliberately: the two
 * apps share the same admins, and controls that behave differently between them
 * would be a trap.
 *
 * The core idea is **state editors, not verb buttons**. Each row SHOWS the
 * current value — a toggle that is on, a segment that is selected — and changing
 * it asks for confirmation. A mistap is then a visible flip you decline, rather
 * than an action you discover afterwards. Every confirmation spells out the
 * actual consequence, because "Are you sure?" teaches people to click yes.
 */
export function UsersScreen({ actor }: { actor: SessionUser }) {
  const nav = useNav();
  const users = useAllUsers();
  const [error, setError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...(users.data ?? [])].sort(
        (a, b) =>
          statusRank[a.status] - statusRank[b.status] ||
          a.displayName.localeCompare(b.displayName),
      ),
    [users.data],
  );

  async function change(uid: string, role: Role, status: UserStatus) {
    setBusyUid(uid);
    setError(null);
    try {
      await setUserAccess(uid, role, status);
    } catch (e) {
      setError(toUserMessage(e, 'setUserAccess'));
    } finally {
      setBusyUid(null);
    }
  }

  if (users.status === 'loading') return <Spinner label="Loading people…" />;

  /**
   * A failed read is not an empty organisation.
   *
   * `users.data ?? []` sorts to nothing, and the screen then renders "Nobody has
   * signed in yet" — a definite claim about the whole company, made from an
   * absence of information, on the screen an admin opens to find out who is
   * waiting for approval. The documented three-states trap, on the one screen
   * where being wrong about it matters most.
   */
  if (users.status === 'error') {
    return (
      <Screen width="read">
        <Row style={styles.between}>
          <Title>People</Title>
          <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
        </Row>
        <LoadError what="the list of people" code={users.error} />
      </Screen>
    );
  }

  const pending = sorted.filter((u) => u.status === 'pending');

  return (
    <Screen width="read">
      <Row style={styles.between}>
        <Title>People</Title>
        <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
      </Row>
      <Hint>
        Only admins approve accounts, change roles, manage the institute&rsquo;s
        labels and see every board. Organizers create boards; everyone else
        sees only the boards they&rsquo;re added to. Who can RUN a board is set on the board itself,
        in Board settings, and has nothing to do with the role here.
      </Hint>

      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      {pending.length > 0 ? (
        <Hint>
          {pending.length} waiting for approval — they cannot see anything until
          you approve them.
        </Hint>
      ) : null}

      {sorted.map((u) => (
        <UserCard
          key={u.uid}
          user={u}
          isSelf={u.uid === actor.uid}
          busy={busyUid === u.uid}
          onChange={change}
        />
      ))}

      {sorted.length === 0 ? <Hint>Nobody has signed in yet.</Hint> : null}

    </Screen>
  );
}

function UserCard({
  user,
  isSelf,
  busy,
  onChange,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  busy: boolean;
  onChange: (uid: string, role: Role, status: UserStatus) => void;
}) {
  const t = useTheme();
  const active = user.status === 'active';

  return (
    <Card
      style={
        user.status === 'pending'
          ? { borderColor: t.feedback.warning, borderWidth: 2 }
          : undefined
      }
    >
      <Body>
        {user.displayName}
        {isSelf ? '  (you)' : ''}
      </Body>
      <Hint>{user.email}</Hint>
      <Row style={styles.wrap}>
        <Badge label={user.status} tone={active ? 'good' : 'muted'} />
        <Badge label={user.role} tone={user.role === 'admin' ? 'accent' : 'muted'} />
      </Row>

      {isSelf ? (
        <Hint>
          You cannot change your own access — ask another admin. That guard also
          stops an admin locking themselves out.
        </Hint>
      ) : null}

      {/* Pending is a decision, not a state to edit: approve or reject. */}
      {!isSelf && user.status === 'pending' ? (
        <Row style={styles.wrap}>
          <Button
            label="Approve"
            busy={busy}
            onPress={async () => {
              if (
                await confirmAction(
                  `Approve ${user.displayName}?`,
                  `${user.email} will be able to sign in and see the boards they are added to.`,
                )
              ) {
                onChange(user.uid, user.role, 'active');
              }
            }}
          />
          <Button
            label="Reject"
            variant="danger"
            busy={busy}
            onPress={async () => {
              if (
                await confirmAction(
                  `Reject ${user.displayName}?`,
                  `${user.email} will be signed out and refused access. You can restore them later.`,
                )
              ) {
                onChange(user.uid, user.role, 'rejected');
              }
            }}
          />
        </Row>
      ) : null}

      {!isSelf && user.status !== 'pending' ? (
        <>
          <StateRow label="Role">
            <Segmented
              options={ROLES}
              value={user.role}
              disabled={!active || busy}
              onChange={async (next) => {
                const ok = await confirmAction(
                  next === 'admin'
                    ? `Make ${user.displayName} an admin?`
                    : `Change role to ${next}?`,
                  next === 'admin'
                    ? `This is full control. ${user.displayName} will be able to approve, reject and disable ANY account including yours, promote others to admin, manage the institute's labels, read Stats, and see and run every board. Only grant this to someone you fully trust.`
                    : next === 'organizer'
                      ? `${user.displayName} will be able to create new boards, and will own the ones they create. It grants nothing on any other board — they still see only boards they are added to.`
                      : `${user.displayName} will no longer be able to create boards. They keep whatever boards they already own, and still see only boards they are added to.`,
                );
                if (ok) onChange(user.uid, next, user.status);
              }}
            />
          </StateRow>

          <StateRow label={active ? 'Active' : 'No access'}>
            <Toggle
              value={active}
              disabled={busy}
              label={`Account access for ${user.displayName}`}
              onValueChange={async (next) => {
                /**
                 * Disabling does NOT touch board ownership — the board keeps its
                 * owner, that owner just cannot act. So there is nothing broken
                 * to prevent, only a situation to point at: name the boards that
                 * will be left with nobody able to run them, then proceed.
                 * Blocking would mean not being able to disable a departing
                 * colleague until every board they touched had been reassigned.
                 *
                 * Asked BEFORE the dialog, so the consequence is IN it rather
                 * than a surprise afterwards — the shape countMemberAssignments
                 * already uses on the board settings screen.
                 */
                let orphaned: { id: string; name: string }[] = [];
                if (!next) {
                  orphaned = await boardsSolelyOwnedBy(user.uid).catch(() => []);
                }
                const stranded =
                  orphaned.length > 0
                    ? ` They are the only owner of ${orphaned
                        .map((b) => `“${b.name}”`)
                        .join(', ')} — nobody but an admin will be able to change ${
                        orphaned.length === 1 ? 'it' : 'them'
                      } until you give someone else ownership.`
                    : '';
                const ok = await confirmAction(
                  next ? 'Restore access?' : `Disable ${user.displayName}?`,
                  next
                    ? `${user.displayName} will be able to sign in again. Any cards still assigned to them stay assigned.`
                    : `${user.displayName} will be signed out immediately and unable to sign back in. Their card assignments are KEPT, so nothing loses its owner — a board owner can reassign them.${stranded}`,
                );
                if (ok) onChange(user.uid, user.role, next ? 'active' : 'disabled');
              }}
            />
          </StateRow>
        </>
      ) : null}
    </Card>
  );
}

function StateRow({ label, children }: { label: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.stateRow}>
      <Text style={[type.label, styles.stateLabel, { color: t.text.muted }]}>
        {label}
      </Text>
      {children}
    </View>
  );
}

/** Segmented control that SHOWS the current value rather than offering verbs. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.seg,
        { borderColor: t.border.subtle, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            disabled={disabled || on}
            accessibilityRole="button"
            accessibilityLabel={`Set role ${o}`}
            onPress={() => onChange(o)}
            style={[
              styles.segOpt,
              on && { backgroundColor: t.accent.base },
            ]}
          >
            <Text
              style={[
                type.caption,
                { color: on ? t.accent.onAccent : t.text.secondary },
              ]}
            >
              {o}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: 'good' | 'accent' | 'muted' }) {
  const t = useTheme();
  const color =
    tone === 'good' ? t.feedback.success : tone === 'accent' ? t.accent.base : t.text.muted;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[type.caption, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  wrap: { flexWrap: 'wrap' },
  // Label and control sit TOGETHER on the left. They were previously pushed to
  // opposite edges with space-between, which on a wide card left a gulf between
  // "Role" and the control it names — the two read as unrelated, and the eye had
  // to travel the width of the card to connect them.
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xs,
  },
  stateLabel: { minWidth: 56 },
  seg: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  segOpt: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 36,
    justifyContent: 'center',
  },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
});
