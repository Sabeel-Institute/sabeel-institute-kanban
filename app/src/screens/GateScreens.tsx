/**
 * What a signed-in-but-not-approved person sees.
 *
 * These screens exist because a blank screen is the worst possible answer to
 * "why can't I get in?". Each states the situation and what happens next, and
 * each updates LIVE — the moment an admin approves someone, session.ts refreshes
 * the token and the app un-gates without a sign-out.
 */
import { StyleSheet, Text } from 'react-native';
import { ALLOWED_EMAIL_DOMAIN } from '@sabeel/shared';
import type { SessionUser } from '../session';
import { signOut } from '../session';
import { acceptRules } from '../reports';
import { useAction } from '../useAction';
import { Body, Button, Card, Screen, Spinner, Title } from '../components/ui';

export function ProvisioningScreen() {
  return (
    <Screen scroll={false} width="read">
      <Spinner label="Setting up your account…" />
    </Screen>
  );
}

export function PendingScreen({ user }: { user: SessionUser }) {
  return (
    <Screen width="read">
      <Title>Waiting for approval</Title>
      <Card>
        <Body>
          You&rsquo;re signed in as {user.email}. An administrator needs to
          approve your account before you can see any boards.
        </Body>
        <Body>
          This page updates by itself the moment that happens — no need to sign
          out or refresh.
        </Body>
      </Card>
      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

export function RejectedScreen({ user }: { user: SessionUser }) {
  return (
    <Screen width="read">
      <Title>Access not granted</Title>
      <Card>
        <Body>
          The request from {user.email} was declined. If you think that&rsquo;s a
          mistake, speak to an administrator.
        </Body>
      </Card>
      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

export function DisabledScreen({ user }: { user: SessionUser }) {
  return (
    <Screen width="read">
      <Title>Account disabled</Title>
      <Card>
        <Body>
          {user.email} no longer has access. Any cards still assigned to you stay
          where they are — an administrator can restore your account.
        </Body>
      </Card>
      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

/** Shown when someone signs in with an address outside the Workspace. */
export function WrongDomainScreen() {
  return (
    <Screen width="read">
      <Title>Wrong account</Title>
      <Card>
        <Body>
          Only @{ALLOWED_EMAIL_DOMAIN} accounts can use this app. Sign out and
          try again with your work account.
        </Body>
      </Card>
      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

/**
 * The institute's rules, accepted once per account, before anything can be
 * posted (decided by Faisal 2026-10-16; docs/STORE-RELEASE.md § 4).
 *
 * App.tsx renders this INSTEAD of the signed-in app for an active account that
 * has not accepted the current `RULES_VERSION`: no navigation, no deep link and
 * no notification can open a board or a card behind it, because none of them
 * is mounted. "I agree" asks the acceptRules callable to record it; the screen
 * goes when the user document says so, on every device the account is open on.
 *
 * The text is the shared decision's, with this app's words in its brackets. It
 * states no minimum age: an age above the store's own rating would force that
 * rating up. Change a word here and raise `RULES_VERSION` in the same commit,
 * so everyone reads the new text once.
 */
export function RulesScreen() {
  const { run, busy, error } = useAction('acceptRules');
  return (
    <Screen width="read">
      <Title>Before you continue</Title>
      <Card>
        <Body>
          Kanban is for Sabeel Institute&rsquo;s staff, and what you post is seen
          only by members of your board.
        </Body>
        <Body>
          By continuing you agree to the institute&rsquo;s rules: post only what
          belongs to your work or class, and nothing abusive, harassing, hateful,
          sexual or otherwise objectionable. The institute does not tolerate
          either.
        </Body>
        <Body>
          Administrators may remove content and suspend accounts that break these
          rules.
        </Body>
        <Body>
          To report something or someone, use{' '}
          <Text style={styles.strong}>Report a problem</Text> in More;
          administrators respond within 24 hours.
        </Body>
      </Card>
      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}
      <Button label="I agree" busy={busy} onPress={() => void run(acceptRules)} />
      <Button label="Sign out" variant="secondary" disabled={busy} onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  strong: { fontWeight: '700' },
});
