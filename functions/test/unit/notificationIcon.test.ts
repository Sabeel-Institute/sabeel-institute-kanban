import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two components draw a push on Android, and each reads its own manifest keys.
 *
 * A message that arrives with the app in the background or closed is drawn by
 * the FCM SDK from `com.google.firebase.messaging.default_notification_*`. One
 * that arrives with the app OPEN reaches `onMessageReceived` instead and is
 * drawn by expo-notifications — `notify.ts`'s handler says to show it — from
 * `expo.modules.notifications.default_notification_*`; with that pair absent,
 * `ExpoNotificationBuilder` falls back to `applicationInfo.icon`, the launcher
 * mipmap, with no tint. Both paths post the notification, correctly worded, on
 * the right channel, so nothing fails — the app just shows two different small
 * icons depending on whether it happened to be open, which is what a phone
 * showed on 2026-09-16 with only the FCM pair set.
 *
 * No suite renders a status bar, and a device pass sends its test push to a
 * closed app, which is the configured path — so the foreground presenter was
 * never exercised and nothing could catch the split. This is the check that
 * can: it reads the manifest and holds the two pairs to one resource. It goes
 * red if either expo key is dropped, or pointed somewhere else, or the icon is
 * ever the launcher mipmap — the exact three ways the drift can come back.
 *
 * Paths resolve from the functions workspace, which is vitest's cwd here — the
 * same convention `suite-coverage.test.ts` uses.
 */
const manifest = readFileSync(
  resolve('..', 'app/android/app/src/main/AndroidManifest.xml'),
  'utf8',
);

/** The `android:resource` of the `<meta-data>` element with this name. */
function resourceOf(name: string): string | undefined {
  for (const [element] of manifest.matchAll(/<meta-data\b[^>]*\/?>/g)) {
    if (element.includes(`android:name="${name}"`)) {
      return element.match(/android:resource="([^"]+)"/)?.[1];
    }
  }
  return undefined;
}

const FCM = 'com.google.firebase.messaging.default_notification_';
const EXPO = 'expo.modules.notifications.default_notification_';

describe('the push small icon', () => {
  it.each(['icon', 'color'])('%s: both presenters read one resource', (key) => {
    const fcm = resourceOf(FCM + key);
    expect(fcm, `${FCM + key} missing`).toBeTruthy();
    expect(resourceOf(EXPO + key), `${EXPO + key} must match ${fcm}`).toBe(fcm);
  });

  it('is a drawable silhouette, not the launcher mipmap', () => {
    expect(resourceOf(FCM + 'icon')).toMatch(/^@drawable\//);
  });
});
