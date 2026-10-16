/**
 * A first sign-in, settled: the screen this account should land on, or the
 * app's own "Still setting up your account", answered with the app's own Try
 * again (on the web, the Firestore cache emptied and the page reloaded).
 * Returns whether it took Try again, for the caller to COUNT and print, never
 * to hide.
 *
 * Why the suites need it: on the Firestore emulator, a profile the
 * auth-create trigger writes while the page's listen for it is still being
 * registered is never heard by that listen (measured 2026-10-16: 21 of 48 cold
 * first sign-ins). The app used to call that "Wrong account" after ten
 * seconds; it now waits, says "still setting up" (app/src/session.ts,
 * PROVISIONING_PATIENCE_MS) and offers Try again, which cures it. A person
 * would press it; so does the suite, and says so.
 */
export async function settle(page, landing, timeout = 60000) {
  const slow = page.getByText('Still setting up your account', { exact: true });
  await landing.or(slow).first().waitFor({ timeout });
  if (!(await slow.isVisible().catch(() => false))) return false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await landing.first().waitFor({ timeout });
  return true;
}

/** Each suite's tally of sign-ins that took Try again, printed with its results. */
export function tryAgainTally() {
  const took = [];
  return {
    note(who, tookTryAgain) {
      if (!tookTryAgain) return;
      took.push(who);
      console.log(`  note: ${who}'s first sign-in took the app's Try again (a profile write the listener missed)`);
    },
    summary() {
      return took.length
        ? `${took.length} first sign-in(s) took the app's Try again: ${took.join(', ')}`
        : 'no sign-in needed Try again';
    },
  };
}
