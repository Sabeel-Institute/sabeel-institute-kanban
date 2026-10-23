/**
 * What a signed-in-but-not-approved person sees.
 *
 * These screens exist because a blank screen is the worst possible answer to
 * "why can't I get in?". Each states the situation and what happens next, and
 * each updates LIVE — the moment an admin approves someone, session.ts refreshes
 * the token and the app un-gates without a sign-out.
 */
import { Linking, Platform, StyleSheet, Text } from 'react-native';
import { ALLOWED_EMAIL_DOMAIN, APP_ID, APP_NAME } from '@sabeel/shared';
import { BUILD_INFO } from '../build-info';
import type { SessionUser } from '../session';
import { retryProvisioning, signOut } from '../session';
import { acceptRules } from '../reports';
import { useAction } from '../useAction';
import { Body, Button, Card, Hint, Screen, Spinner, Title } from '../components/ui';

/**
 * Signed in, waiting for the profile the server writes on a first sign-in.
 *
 * Usually a second. Past session.ts's PROVISIONING_PATIENCE_MS, `slow` says
 * so and offers Try again, a fresh connection (on the web, the cache emptied
 * and the page reloaded): a late profile is a slow server or a missed write,
 * never a refused account, so this screen never says "wrong account". Sign
 * out is here too, so nobody is stuck.
 */
export function ProvisioningScreen({ slow }: { slow: boolean }) {
  const { run, busy } = useAction('retryProvisioning');
  if (!slow) {
    return (
      <Screen scroll={false} width="read">
        <Spinner label="Setting up your account…" />
      </Screen>
    );
  }
  return (
    <Screen width="read">
      <Title>Still setting up your account</Title>
      <Card>
        <Body>This is taking longer than usual. Try again in a minute.</Body>
      </Card>
      <Button label="Try again" busy={busy} onPress={() => void run(retryProvisioning)} />
      <Button label="Sign out" variant="secondary" disabled={busy} onPress={signOut} />
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

/**
 * Where an update comes from: Play for an Android build, TestFlight (which
 * opens on the build list) for an iPhone one. Never `GET_APP_URL`: that page
 * carries the "sign in on the website first" instruction the app must not point
 * at (docs/STORE-RELEASE.md).
 */
const UPDATE = Platform.OS === 'ios'
  ? { label: 'Open TestFlight', url: 'itms-beta://' }
  : { label: 'Open Google Play', url: `https://play.google.com/store/apps/details?id=${APP_ID}` };

/**
 * A build the institute has retired (`useMinVersion`).
 *
 * Shown before sign-in, in place of the whole app, so nothing behind it runs
 * on rules it no longer matches. Sign out is offered because the person may be
 * signed in already and on a shared phone.
 */
export function UpdateScreen({ signedIn }: { signedIn: boolean }) {
  return (
    <Screen width="read">
      <Title>Update needed</Title>
      <Card>
        <Body>
          This version of {APP_NAME} is out of date. Install the current one to
          keep using the app; nothing on your boards is lost by updating.
        </Body>
      </Card>
      <Button
        label={UPDATE.label}
        onPress={() => void Linking.openURL(UPDATE.url).catch(() => undefined)}
      />
      {signedIn ? <Button label="Sign out" variant="secondary" onPress={signOut} /> : null}
      <Hint>
        Installed: v{BUILD_INFO.version} · {BUILD_INFO.commit}
      </Hint>
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
 * rating up. Change what the rules MEAN here and raise `RULES_VERSION` in the
 * same commit, so everyone reads the new text once; a rewording that keeps the
 * meaning (2026-10-16: naming both things the institute does not tolerate)
 * keeps the version.
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
          belongs to your work, post nothing abusive, harassing, hateful, sexual
          or otherwise objectionable, and never abuse another member. The
          institute tolerates neither.
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
