/**
 * The institute's rules screen, as the browser suites meet it.
 *
 * Every account sees it once, after approval and before any board
 * (`RulesScreen` in app/src/screens/GateScreens.tsx), so a suite that signs a
 * new account in goes through it like a person does: here, by the screen's
 * own title and button. Strict on purpose: a suite that expected the screen
 * and did not get it fails, rather than carrying on as if it had agreed.
 */

/** The screen's title: drawn in the same render as its buttons. */
export const RULES_TITLE = 'Before you continue';

/** Wait for the rules screen, agree, and wait for it to go. */
export async function agreeToRules(page, timeout = 40000) {
  await page.getByText(RULES_TITLE, { exact: true }).waitFor({ timeout });
  await page.getByRole('button', { name: 'I agree', exact: true }).click();
  await page.getByText(RULES_TITLE, { exact: true }).waitFor({ state: 'detached', timeout });
}
