import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
} from '../components/ui';
import { Sheet, SheetOption } from '../components/Sheet';
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
 * Compact rows, as the LMS's People → Staff (#125): one card, a person per
 * row, the name over the address, and the ROLE as a coloured chip so the
 * admins and organizers stand out at a glance. Changes live behind the row's
 * ⋮, in a sheet that SHOWS the current role as selected, so it is still a
 * state editor rather than verbs; and every change asks for confirmation that
 * spells out the actual consequence, because "Are you sure?" teaches people to
 * click yes. People waiting for approval keep Approve and Reject in view: that
 * decision is what an admin came here for.
 */
export function UsersScreen({ actor }: { actor: SessionUser }) {
  const nav = useNav();
  const users = useAllUsers();
  const [error, setError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  /** Whose ⋮ sheet is open. */
  const [menuFor, setMenuFor] = useState<string | null>(null);

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
  const others = sorted.filter((u) => u.status !== 'pending');
  const editing = others.find((u) => u.uid === menuFor) ?? null;

  /** Role changes: the consequence in the confirmation, then the write. */
  async function askRole(user: AdminUserRow, next: Role) {
    setMenuFor(null);
    const ok = await confirmAction(
      next === 'admin' ? `Make ${user.displayName} an admin?` : `Change role to ${next}?`,
      next === 'admin'
        ? `This is full control. ${user.displayName} will be able to approve, reject and disable ANY account including yours, promote others to admin, manage the institute's labels, read Stats, and see and run every board. Only grant this to someone you fully trust.`
        : next === 'organizer'
          ? `${user.displayName} will be able to create new boards, and will own the ones they create. It grants nothing on any other board — they still see only boards they are added to.`
          : `${user.displayName} will no longer be able to create boards. They keep whatever boards they already own, and still see only boards they are added to.`,
    );
    if (ok) await change(user.uid, next, user.status);
  }

  /**
   * Disabling does NOT touch board ownership — the board keeps its owner, that
   * owner just cannot act. So there is nothing broken to prevent, only a
   * situation to point at: name the boards that will be left with nobody able
   * to run them, then proceed. Asked BEFORE the dialog, so the consequence is
   * IN it rather than a surprise afterwards.
   */
  async function askAccess(user: AdminUserRow, next: boolean) {
    setMenuFor(null);
    let orphaned: { id: string; name: string }[] = [];
    if (!next) orphaned = await boardsSolelyOwnedBy(user.uid).catch(() => []);
    const stranded =
      orphaned.length > 0
        ? ` They are the only owner of ${orphaned.map((b) => `“${b.name}”`).join(', ')} — nobody but an admin will be able to change ${
            orphaned.length === 1 ? 'it' : 'them'
          } until you give someone else ownership.`
        : '';
    const ok = await confirmAction(
      next ? 'Restore access?' : `Disable ${user.displayName}?`,
      next
        ? `${user.displayName} will be able to sign in again. Any cards still assigned to them stay assigned.`
        : `${user.displayName} will be signed out immediately and unable to sign back in. Their card assignments are KEPT, so nothing loses its owner — a board owner can reassign them.${stranded}`,
    );
    if (ok) await change(user.uid, user.role, next ? 'active' : 'disabled');
  }

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
        in Board settings → People, and has nothing to do with the role here.
      </Hint>

      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      <Text style={[type.label, styles.section]}>Waiting for approval ({pending.length})</Text>
      {pending.length === 0 ? <Hint>Nobody is waiting.</Hint> : null}
      {pending.map((u) => (
        <Card key={u.uid} style={styles.pending}>
          <PersonLines user={u} isSelf={u.uid === actor.uid} />
          <Hint>They cannot see anything until you approve them.</Hint>
          <Row style={styles.wrap}>
            <Button
              label={`Approve`}
              busy={busyUid === u.uid}
              onPress={async () => {
                if (
                  await confirmAction(
                    `Approve ${u.displayName}?`,
                    `${u.email} will be able to sign in and see the boards they are added to.`,
                  )
                ) {
                  await change(u.uid, u.role, 'active');
                }
              }}
            />
            <Button
              label="Reject"
              variant="danger"
              busy={busyUid === u.uid}
              onPress={async () => {
                if (
                  await confirmAction(
                    `Reject ${u.displayName}?`,
                    `${u.email} will be signed out and refused access. You can restore them later.`,
                  )
                ) {
                  await change(u.uid, u.role, 'rejected');
                }
              }}
            />
          </Row>
        </Card>
      ))}

      <Text style={[type.label, styles.section]}>Everyone ({others.length})</Text>
      {others.length === 0 ? <Hint>Nobody has signed in yet.</Hint> : null}
      {others.length > 0 ? (
        <Card style={styles.list}>
          {others.map((u, i) => (
            <PersonRow
              key={u.uid}
              user={u}
              isSelf={u.uid === actor.uid}
              first={i === 0}
              busy={busyUid === u.uid}
              onMenu={() => setMenuFor(u.uid)}
            />
          ))}
        </Card>
      ) : null}

      <Sheet visible={editing !== null} title={editing?.displayName ?? ''} onClose={() => setMenuFor(null)}>
        {editing && editing.status === 'active'
          ? ROLES.map((r) => (
              <SheetOption
                key={r}
                label={ROLE_WORDS[r]}
                detail={ROLE_DETAIL[r]}
                selected={editing.role === r}
                onPress={() => void askRole(editing, r)}
              />
            ))
          : null}
        {editing ? (
          <SheetOption
            label={editing.status === 'active' ? 'Disable access' : 'Restore access'}
            detail={
              editing.status === 'active'
                ? 'Signed out now, and cannot sign back in. Assignments are kept.'
                : 'Able to sign in again, with the role they had.'
            }
            onPress={() => void askAccess(editing, editing.status !== 'active')}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

const ROLE_WORDS: Record<Role, string> = { admin: 'Admin', organizer: 'Organizer', member: 'Member' };
const ROLE_DETAIL: Record<Role, string> = {
  admin: 'Approves people, sets roles, sees and runs every board.',
  organizer: 'Creates boards, and owns the ones they create.',
  member: 'Sees the boards they are added to.',
};

/** The name, its chips, and the address: the two lines every row shows. */
function PersonLines({ user, isSelf }: { user: AdminUserRow; isSelf: boolean }) {
  const t = useTheme();
  return (
    <View style={styles.lines}>
      <View style={styles.nameLine}>
        <Text style={[type.body, styles.name, { color: t.text.primary }]} numberOfLines={1}>
          {user.displayName}
          {isSelf ? ' (you)' : ''}
        </Text>
        <RoleChip role={user.role} />
        {user.status === 'disabled' || user.status === 'rejected' ? <StatusChip status={user.status} /> : null}
      </View>
      <Text style={[type.caption, { color: t.text.secondary }]} numberOfLines={1}>
        {user.email}
      </Text>
    </View>
  );
}

function PersonRow({
  user,
  isSelf,
  first,
  busy,
  onMenu,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  first: boolean;
  busy: boolean;
  onMenu: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.row, !first && { borderTopColor: t.border.subtle, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <PersonLines user={user} isSelf={isSelf} />
      {/* No menu on your own row: you cannot change your own access (ask
          another admin), which also stops an admin locking themselves out. */}
      {isSelf ? (
        <View style={styles.menuSpace} />
      ) : (
        <IconAction icon="more-vert" label={`Change ${user.displayName}`} disabled={busy} onPress={onMenu} />
      )}
    </View>
  );
}

/**
 * The role, coloured so it stands out (#125): an admin filled in the brand's
 * raspberry, an organizer tinted, a member outlined. Always in words too, so
 * colour is never the only signal; every pair reaches 4.5:1 (the sweep checks).
 */
function RoleChip({ role }: { role: Role }) {
  const t = useTheme();
  const look =
    role === 'admin'
      ? { backgroundColor: t.accent.base, borderColor: t.accent.base, color: t.text.inverse }
      : role === 'organizer'
        ? { backgroundColor: t.bg.accentSoft, borderColor: t.bg.accentSoft, color: t.text.accent }
        : { backgroundColor: 'transparent', borderColor: t.border.strong, color: t.text.secondary };
  return (
    <View style={[styles.chip, { backgroundColor: look.backgroundColor, borderColor: look.borderColor }]}>
      <Text style={[type.caption, styles.chipText, { color: look.color }]}>{ROLE_WORDS[role]}</Text>
    </View>
  );
}

function StatusChip({ status }: { status: 'disabled' | 'rejected' }) {
  const t = useTheme();
  return (
    <View style={[styles.chip, { borderColor: t.feedback.danger }]}>
      <Text style={[type.caption, styles.chipText, { color: t.feedback.danger }]}>
        {status === 'disabled' ? 'Disabled' : 'Rejected'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  wrap: { flexWrap: 'wrap' },
  section: { marginTop: space.md, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: '700' },
  pending: { gap: space.xs },
  list: { paddingVertical: 0, gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    minHeight: 56,
  },
  lines: { flex: 1, minWidth: 0, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  // Shrinks beside the chips: Yoga's flexShrink defaults to 0.
  name: { fontWeight: '600', flexShrink: 1 },
  menuSpace: { width: 44 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  chipText: { fontWeight: '600' },
});
