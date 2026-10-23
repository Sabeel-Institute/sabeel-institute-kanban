/**
 * App shell and the access gate.
 *
 * Every route below the gate can assume an ACTIVE user, so no screen has to
 * re-check status. The gate keys off the session's claims — which session.ts
 * keeps fresh by force-refreshing the token whenever the server stamps
 * claimsUpdatedAt — so an admin approval un-gates the app live.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { KeyboardHost } from './src/components/KeyboardHost';
import { OverlayLayer } from './src/components/MentionOverlay';
import { SafeAreaProvider, type Edge } from 'react-native-safe-area-context';
import { sessionCan, useSession, type SessionUser } from './src/session';
import { initErrorReporting, setErrorUser } from './src/sentry';
import { useNav, useHardwareBack, type Route } from './src/nav';
import { useDeepLinks } from './src/useDeepLinks';
import { usePushOpens } from './src/usePushOpens';
import { useLayout } from './src/theme/layout';
import { AppNav, isTabRoot } from './src/components/AppNav';
import { SignInScreen } from './src/screens/SignInScreen';
import {
  DisabledScreen,
  PendingScreen,
  ProvisioningScreen,
  RejectedScreen,
  RulesScreen,
  UpdateScreen,
  WrongDomainScreen,
} from './src/screens/GateScreens';
import { useMinVersion } from './src/minVersion';
import { BoardsScreen } from './src/screens/BoardsScreen';
import { BoardScreen } from './src/screens/BoardScreen';
import { BoardSettingsScreen } from './src/screens/BoardSettingsScreen';
import { BoardArchiveScreen } from './src/screens/BoardArchiveScreen';
import { CardScreen } from './src/screens/CardScreen';
import { MyWorkScreen } from './src/screens/MyWorkScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { UsersScreen } from './src/screens/UsersScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { ReportScreen } from './src/screens/ReportScreen';
import {
  Body,
  Card,
  Hint,
  IconAction,
  NavClaimedEdgesContext,
  Row,
  Screen,
  Spinner,
  Title,
} from './src/components/ui';

/** What an admin-only route shows anyone else. Says whose it is, and offers a way out. */
function NotForYou({ what }: { what: string }) {
  const nav = useNav();
  return (
    <Screen width="read">
      <Row style={styles.notForYou}>
        <Title>{what}</Title>
        <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
      </Row>
      <Card>
        <Body>{what} is for administrators.</Body>
        <Hint>If you need something from it, ask an admin.</Hint>
      </Card>
    </Screen>
  );
}

function renderScreen(route: Route, user: SessionUser) {
  switch (route.name) {
    case 'board':
      return <BoardScreen boardId={route.boardId} user={user} />;
    case 'boardSettings':
      return <BoardSettingsScreen boardId={route.boardId} user={user} />;
    case 'boardArchive':
      return <BoardArchiveScreen boardId={route.boardId} user={user} />;
    case 'card':
      // KEYED BY CARD ID, deliberately. Only the top of the stack renders, so a
      // card → card push (which subtasks make routine) puts the same component
      // type in the same position and React KEEPS its local state. Without the
      // key: start editing card A's title — `dirty` is now true, so the seeding
      // effect `if (card.data && !dirty)` stops re-seeding — tap a subtask, and
      // card B renders showing A's typed title. Pressing "Save title" then writes
      // A's text onto B. The key forces a fresh mount per card.
      return (
        <CardScreen
          key={route.cardId}
          boardId={route.boardId}
          cardId={route.cardId}
          user={user}
        />
      );
    case 'myWork':
      return <MyWorkScreen user={user} />;
    case 'notifications':
      return <NotificationsScreen user={user} />;
    case 'search':
      return <SearchScreen user={user} />;
    // Both admin-only, and gated HERE as well as in the More menu.
    //
    // The reachable case is a LIVE DEMOTION: role comes from a claim the session
    // watches, so an admin sitting on Stats when another admin demotes them
    // re-renders through this switch with `role: 'member'`. Gated only by the
    // menu, that screen stays mounted and fills with permission errors — the
    // server is the real boundary either way (`users/*` and `stats/*` are
    // admin-only in firestore.rules), but "you cannot see this" is a better
    // answer than a screen of red. The menu hiding an entry does nothing for a
    // route already on the stack.
    case 'users':
      return sessionCan.administerUsers(user) ? (
        <UsersScreen actor={user} />
      ) : (
        <NotForYou what="Managing people" />
      );
    case 'stats':
      return sessionCan.viewStats(user) ? (
        <StatsScreen user={user} />
      ) : (
        <NotForYou what="Stats" />
      );
    case 'report':
      return <ReportScreen />;
    default:
      return <BoardsScreen user={user} />;
  }
}

const NO_EDGES: readonly Edge[] = [];
const BOTTOM_CLAIMED: readonly Edge[] = ['bottom'];
const LEFT_CLAIMED: readonly Edge[] = ['left'];

/**
 * The signed-in shell: the app-wide nav chrome plus the current screen. Wide gets
 * a persistent left rail (which owns the left safe-area edge); a phone gets a
 * bottom bar on the tab-root screens only (which owns the bottom edge), and none
 * on the immersive board/card screens. Each layout tells `Screen`, via
 * `NavClaimedEdgesContext`, which edge the chrome already inset so it is not
 * doubled.
 */
function SignedInRoutes({ user }: { user: SessionUser }) {
  const { route } = useNav();
  const { isWide } = useLayout();
  // Open a shared card/board link now that the user is active (see useDeepLinks).
  useDeepLinks();
  // Same, for a push notification the user tapped (see usePushOpens).
  usePushOpens(user.uid);
  const screen = renderScreen(route, user);

  if (isWide) {
    return (
      <View style={styles.row}>
        <AppNav user={user} variant="rail" />
        <NavClaimedEdgesContext.Provider value={LEFT_CLAIMED}>
          <View style={styles.fill}>{screen}</View>
        </NavClaimedEdgesContext.Provider>
      </View>
    );
  }

  const showBar = isTabRoot(route.name);
  return (
    <View style={styles.fill}>
      <NavClaimedEdgesContext.Provider value={showBar ? BOTTOM_CLAIMED : NO_EDGES}>
        <View style={styles.fill}>{screen}</View>
      </NavClaimedEdgesContext.Provider>
      {showBar ? <AppNav user={user} variant="bar" /> : null}
    </View>
  );
}

function Routes() {
  const session = useSession();
  // The institute's floor for phone builds, read before anything else: a
  // retired build shows the update screen whether or not anyone is signed in.
  const outdated = useMinVersion();
  // Android Back / edge-swipe pops this stack instead of exiting the app.
  useHardwareBack();

  // Tag events with WHO hit them — uid only, never email (see src/sentry.ts).
  // Cleared on sign-out so a shared browser cannot attribute one person's
  // errors to the last person who used it.
  const uid = session.state === 'signed-in' ? session.user.uid : null;
  useEffect(() => {
    setErrorUser(uid);
  }, [uid]);

  if (outdated) return <UpdateScreen signedIn={session.state === 'signed-in'} />;

  switch (session.state) {
    case 'loading':
      return (
        <Screen scroll={false}>
          <Spinner />
        </Screen>
      );

    case 'signed-out':
      return <SignInScreen />;

    // Signed in, but the profile the auth-create trigger writes is not here
    // yet. Slow is still setting up, with Try again: never a refusal.
    case 'provisioning':
      return <ProvisioningScreen slow={session.slow} />;

    // The server refused the account: the auth-create trigger deleted it (a
    // non-org address), which Auth confirms (`lookUpAccount`). Say so.
    case 'not-provisioned':
      return <WrongDomainScreen />;

    case 'signed-in': {
      const { user } = session;
      switch (user.status) {
        case 'pending':
          return <PendingScreen user={user} />;
        case 'rejected':
          return <RejectedScreen user={user} />;
        case 'disabled':
          return <DisabledScreen user={user} />;
        // The institute's rules come after approval and before anything else:
        // until they are accepted, nothing that could post is even mounted —
        // not the nav, not a deep link, not a tapped notification.
        case 'active':
          return user.rulesAccepted ? <SignedInRoutes user={user} /> : <RulesScreen />;
      }
    }
  }
}

export default function App() {
  // Once, before anything renders — an error thrown during the first paint is
  // exactly the kind worth catching, and initialising inside Routes would miss
  // it. No-ops without a DSN.
  useEffect(() => {
    initErrorReporting();
  }, []);

  return (
    /* Wraps everything so KeyboardScroll receives IME insets on native; a
       no-op on web, where the browser handles this itself. */
    <KeyboardHost>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Routes />
      </SafeAreaProvider>
      {/* LAST, at the root, and OUTSIDE SafeAreaProvider: the @mention popover
          is drawn here rather than inside the editor, because every
          react-native-web View is a stacking context and no zIndex inside a card
          can lift it clear of the section drawn after that card. Outside the
          provider because it is positioned in SCREEN coordinates, and an inset
          parent would shift every one of them. See MentionOverlay.tsx. */}
      <OverlayLayer />
    </KeyboardHost>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  notForYou: { justifyContent: 'space-between' },
});
