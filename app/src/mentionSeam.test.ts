import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE `<mention>` SHAPE IS AN UNDOCUMENTED OUTPUT OF A NATIVE LIBRARY.
 *
 * `packages/shared/src/richtextHtml.ts` converts the native editor's mention
 * node back to `@handle`, and to do that it has to know that
 * `react-native-enriched-html` writes the indicator into an ATTRIBUTE rather
 * than into the element's text:
 *
 *     <mention text="sara" indicator="@">sara</mention>
 *
 * That shape appears in no public API. `setMention(indicator, text, attributes)`
 * is documented; what it serialises to is not. Our converter depends on it
 * anyway, because it must.
 *
 * The unit tests in `packages/shared/test/richtextHtml.test.ts` assert the
 * conversion — but they assert it against a shape WE wrote down, so they would
 * all keep passing if the library renamed the attribute tomorrow, while
 * production silently went back to notifying nobody. That is the same failure
 * this bug already had once: green tests, correct-looking UI, no notification.
 *
 * So this test couples to the library's own source instead. It is deliberately
 * a coarse instrument: it fails on an upgrade, and a failure means "go and
 * re-verify the shape on a device, then update the converter AND the tests" —
 * not "edit this file until it passes". The device check is
 * `maestro/board.yaml`'s mention, which the Native workflow runs on the
 * Android emulator and the iPhone simulator for the upgrade's pull request.
 *
 * Lives in `app/` because that workspace runs plain `.ts` unit tests and this
 * asserts about an installed dependency rather than about our own code.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const LIB = resolve(ROOT, 'node_modules', 'react-native-enriched-html');

/** The version whose serialiser output was actually verified, on a device. */
const VERIFIED_VERSION = '1.1.0';

function read(rel: string): string {
  // No try/catch: a missing file MUST fail. "Cannot check" and "checked, fine"
  // must never look the same — that is the whole lesson of this bug.
  return readFileSync(resolve(LIB, rel), 'utf8');
}

describe('the native mention serialisation contract', () => {
  it('is the library version whose output we verified', () => {
    const version = JSON.parse(read('package.json')).version as string;
    expect(
      version,
      `react-native-enriched-html moved from ${VERIFIED_VERSION} to ${version}. ` +
        'Its <mention> serialisation is undocumented and our HTML seam depends ' +
        'on it. Re-verify on a device that picking a mention still stores ' +
        '"@handle" (maestro/board.yaml does, in the pull request\'s Native ' +
        'run), then update VERIFIED_VERSION here.',
    ).toBe(VERIFIED_VERSION);
  });

  it('still puts the indicator in an attribute, not in the element text', () => {
    // The library's own parser tests carry the canonical shape.
    const fixture = read('cpp/tests/GumboParserTest.cpp');
    expect(fixture, 'no <mention> fixture found in the library tests').toContain(
      '<mention',
    );
    const tag = fixture.slice(fixture.indexOf('<mention'), fixture.indexOf('<mention') + 200);
    // Both attributes our converter reads must still exist by these names.
    expect(tag, 'the `indicator` attribute our converter reads is gone').toMatch(
      /indicator\s*=/,
    );
    expect(tag, 'the `text` attribute our converter reads is gone').toMatch(/text\s*=/);
  });

  it('still takes the indicator as a SEPARATE argument to setMention', () => {
    // If this ever became setMention(text) with the indicator baked in, the
    // converter would double it: "@@sara".
    const types = read('src/types.ts');
    expect(types).toMatch(
      /setMention:\s*\(\s*indicator:\s*string,\s*text:\s*string/,
    );
  });
});
