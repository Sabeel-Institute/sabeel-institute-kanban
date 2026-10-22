import { useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ALLOWED_EMAIL_DOMAIN, PRIVACY_URL, SIGN_UP_REFUSED } from '@sabeel/shared';
import {
  signInWithGoogle,
  signInWithGoogleRedirect,
  googleSignInAvailable,
  PopupBlockedError,
} from '../auth/google';
import { DEV_ACCOUNTS, devSignIn, devSignInAvailable } from '../auth/devSignIn';
import { EMAIL_SIGN_IN_MESSAGES, signInWithEmail, type EmailSignInRefusal } from '../auth/email';
import { Body, Button, Caption, Card, Hint, Row, Screen, TextField, Title } from '../components/ui';
import { radius, space, useTheme } from '../theme';
import sabeelLogo from '../../assets/brand/sabeel-logo.png';
import { toUserMessage } from '../errors';
import { BUILD_INFO } from '../build-info';

export function SignInScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The popup was blocked, so the way in is being offered rather than taken.
   *
   * This used to redirect automatically, and that is precisely how people got
   * stuck: the redirect returns to Firebase's own `/__/auth/handler`, which
   * needs the `sessionStorage` written before the bounce. An in-app browser —
   * a link tapped in WhatsApp — does not have it on return, so Firebase renders
   * "missing initial state" on a page this app is not running on. No way back,
   * and re-opening the link lands on it again.
   */
  const [popupBlocked, setPopupBlocked] = useState(false);

  /**
   * Signed in with an account this app has never heard of.
   *
   * A STATE, not an error, and kept out of `error` deliberately: that path runs
   * `toUserMessage`, which reports to Sentry, and a colleague who simply has not
   * been set up yet is not an application fault. It would also drown the real
   * sign-in errors in noise.
   */
  const [noAccount, setNoAccount] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setPopupBlocked(false);
    setNoAccount(false);
    try {
      if ((await fn()) === 'no-account') setNoAccount(true);
    } catch (e) {
      if (e instanceof PopupBlockedError) setPopupBlocked(true);
      // The server refused to make the account (functions/src/signUpGate.ts):
      // an address off the org domain, on the web. Expected, so said in a
      // sentence and not reported. It arrives as an internal error carrying
      // the marker.
      else if (e instanceof Error && e.message.includes(SIGN_UP_REFUSED)) {
        setError(`Only @${ALLOWED_EMAIL_DOMAIN} accounts can use this app.`);
      } else setError(toUserMessage(e, 'signIn'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen width="read">
      {/* A sign-in form has one job; stretching it across a monitor makes it
          harder to use, not grander. Capped narrower than the general content
          column. */}
      <View style={styles.pane}>
      <View style={styles.header}>
        {/*
          The logo belongs on the entry screen and nowhere else — inside the app
          the brand is carried by the palette, and a logo repeated on every
          screen is chrome that costs space the board needs.
        */}
        <View style={styles.logoPlate}>
          <Image
            // The dark (ivory) calligraphy on warm ivory. No tint or plate: a
            // flat tintColor would throw away the gold accent strokes. The app
            // is light-only, so the single asset is all we need.
            source={sabeelLogo}
            style={styles.logo}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="Sabeel Institute"
          />
        </View>
        <Title>Kanban</Title>
        <Body>Sign in with your @{ALLOWED_EMAIL_DOMAIN} account.</Body>
      </View>

      <Card>
        <Button
          label="Sign in with Google"
          onPress={() => run(signInWithGoogle)}
          busy={busy}
          disabled={!googleSignInAvailable && !devSignInAvailable}
          // The sign-in screen is the exception to content-width buttons on wide:
          // its single primary action reads better spanning the card.
          block
        />
        {popupBlocked ? (
          <View style={styles.blocked}>
            <Body>Your browser blocked the sign-in window.</Body>
            <Hint>
              If you opened this from a chat app, open{' '}
              {typeof window !== 'undefined' ? window.location.host : ''} in Safari
              or Chrome instead — sign-in cannot finish inside an in-app browser.
            </Hint>
            <Button
              label="Try anyway"
              variant="secondary"
              onPress={() => run(signInWithGoogleRedirect)}
              busy={busy}
              block
            />
          </View>
        ) : null}
        <Hint>
          New accounts need an administrator&rsquo;s approval before you can use
          the boards.
        </Hint>
      </Card>

      <EmailSignIn busy={busy} run={run} />


      {noAccount ? (
        <Card>
          {/*
            DO NOT make this more helpful by naming where to get an account.

            "Sign in on the website first" is, almost verbatim, the second of the
            two things that would put this app back inside the stores' account
            creation rule — and with it, a requirement to build in-app account
            deletion. The instruction belongs in the onboarding email, which is
            out of band and does not count. docs/STORE-RELEASE.md § 1, The app
            never creates an account.
          */}
          <Body>This account isn&rsquo;t set up for the app yet.</Body>
          <Hint>Contact your administrator.</Hint>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      {/*
        Emulator-only. Gated on __DEV__ AND the emulator flag, so it cannot reach
        a release build. Headed "Dev sign-in (emulator only)", testID
        `dev-sign-in`, as in every Sabeel app: the release check
        (`sabeel-ci check-release`) cold-starts the release build and fails if
        this row is on screen.
      */}
      {devSignInAvailable ? (
        <Card testID="dev-sign-in">
          <Hint>Dev sign-in (emulator only)</Hint>
          <Row style={styles.wrap}>
            {DEV_ACCOUNTS.map((name) => (
              <Button
                key={name}
                label={name}
                variant="secondary"
                onPress={() => run(() => devSignIn(name))}
                busy={busy}
              />
            ))}
          </Row>
          <Hint>
            &ldquo;intruder@gmail.com&rdquo; is deliberately outside the org
            domain — the server refuses it before any account exists.
          </Hint>
        </Card>
      ) : null}

      {/* Which build is running — so "what version are you on?" is answerable
          from the screen everyone sees. Stamped at build time by
          `sabeel-ci build-info`. */}
      {/* Also here, not only behind the More menu: an App Review reviewer sees
          this screen before any other, and 5.1.1(i) asks for the policy to be
          easily accessible IN the app. In the footer beside the build stamp,
          which is where a reader expects it and where it does not read as part
          of the sign-in form. */}
      <View style={styles.build}>
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => undefined)}
          hitSlop={space.sm}
        >
          <Caption>Privacy policy</Caption>
        </Pressable>
        <Caption>
          v{BUILD_INFO.version} &middot; {BUILD_INFO.commit}
        </Caption>
      </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The link treatment PushNudge's "Not now" uses: accent and underline, in a
  // real 44pt box rather than hitSlop, centred under the card above it.
  emailLink: { alignSelf: 'center', minHeight: 44, paddingHorizontal: space.xs, justifyContent: 'center' },
  emailLinkText: { fontSize: 14, textDecorationLine: 'underline' },
  blocked: { gap: space.sm, marginTop: space.sm },
  pane: { width: '100%', maxWidth: 460, alignSelf: 'center', gap: space.sm },
  header: { gap: space.xs, marginBottom: space.md, alignItems: 'center' },
  logoPlate: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: space.xl,
    borderRadius: radius.lg,
    marginBottom: space.md,
  },
  logo: { width: 260, height: 130 },
  wrap: { flexWrap: 'wrap' },
  build: { marginTop: space.lg, alignItems: 'center', gap: space.xs },
});

/**
 * The email door: a password sign-in for an account an administrator made
 * (auth/email.ts). It acts as a member, whatever its claims say.
 *
 * A link until asked for, and below Google: the team signs in with Google, and
 * a second form beside that button would ask everyone which one is theirs.
 *
 * The drafts live HERE, not on the screen — the field's own component owns its
 * text (CLAUDE.md, State) — and `run`/`busy` come from the screen, so this and
 * Google share one busy state and one error card. A refusal a person caused
 * (a wrong password) is said here, in a sentence, and not reported.
 */
function EmailSignIn({ busy, run }: { busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [refusal, setRefusal] = useState<EmailSignInRefusal | null>(null);
  const passwordRef = useRef<TextInput>(null);

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign in with email"
        onPress={() => setOpen(true)}
        disabled={busy}
        style={styles.emailLink}
      >
        <Text style={[styles.emailLinkText, { color: t.text.accent, opacity: busy ? 0.45 : 1 }]}>
          Sign in with email
        </Text>
      </Pressable>
    );
  }

  const ready = email.trim().length > 0 && password.length > 0;
  const submit = () => {
    if (!ready || busy) return;
    void run(async () => {
      setRefusal(null);
      setRefusal(await signInWithEmail(email, password));
    });
  };

  return (
    <Card>
      {/* Return moves from the address to the password, and signs in from
          there: on a phone the keyboard covers the button. */}
      <TextField
        kind="email"
        label="Email"
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoFocus
        enterKeyHint="next"
        onSubmit={() => passwordRef.current?.focus()}
      />
      <TextField
        ref={passwordRef}
        kind="password"
        label="Password"
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        enterKeyHint="go"
        onSubmit={submit}
      />
      <Button label="Sign in" onPress={submit} busy={busy} disabled={!ready} block />
      {refusal ? <Body>{EMAIL_SIGN_IN_MESSAGES[refusal]}</Body> : null}
    </Card>
  );
}
