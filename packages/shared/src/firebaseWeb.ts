/**
 * The Firebase web app config. NOT SECRET: public by design and meant to be
 * committed; access is controlled by the rules, never by hiding these. Here,
 * not in the app, because the MCP server signs in with it too
 * (functions/src/mcp): two copies of a value that has to match would drift.
 *
 * Real values for the `sabeel-institute-kanban` project (registered 2026-07-19).
 */
export const FIREBASE_WEB_CONFIG = {
  apiKey: 'AIzaSyDnHBj4vlBquHotVRjexa2yB1_x18XWqaI',
  // The HOSTING domain, not firebaseapp.com. Hosting serves /__/auth/* itself,
  // so the whole sign-in redirect stays same-origin — required in
  // storage-partitioned browsers (the in-app webviews people arrive in from a
  // WhatsApp or Slack link), where the cross-origin helper dies with
  // "missing initial state". Redirect URI registered on the Web OAuth client
  // 2026-07-19; the firebaseapp.com entries are kept as a working fallback.
  authDomain: 'sabeel-institute-kanban.web.app',
  projectId: 'sabeel-institute-kanban',
  messagingSenderId: '826656438175',
  appId: '1:826656438175:web:d9d89ccb61181de5c5efaa',
};
