import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * WHAT THE PHONES' RENDERER RELIES ON IN A NATIVE LIBRARY.
 *
 * `RichDocView.tsx` draws comments and descriptions with
 * `react-native-enriched-html`'s `EnrichedText`, and selection working at all
 * rests on details no test of ours can see, because a browser never runs them.
 * So this couples to the library's own source. It fails on an upgrade, and a
 * failure means "re-run the select-all step in `maestro/board.yaml` on the
 * emulator", not "edit this until it passes". `mentionSeam.test.ts` pins the
 * version; this file names what to look at when that moves, including the one
 * line `patches/` changes in it.
 */
const LIB = resolve(import.meta.dirname, '..', '..', 'node_modules', 'react-native-enriched-html');
const read = (rel: string) => readFileSync(resolve(LIB, rel), 'utf8');

describe('the native text view', () => {
  const view = read('android/src/main/java/com/swmansion/enriched/text/EnrichedTextView.kt');

  it('still makes `selectable` a real text-view selection', () => {
    expect(read('android/src/main/java/com/swmansion/enriched/text/EnrichedTextViewManager.kt')).toMatch(
      /setTextIsSelectable\(value\)/,
    );
  });

  it('still parses <html>-wrapped input directly, skipping its normaliser', () => {
    expect(view).toMatch(/text\.startsWith\("<html>"\)\s*&&\s*text\.endsWith\("<\/html>"\)/);
  });

  it('is patched so the layout and UI threads cannot share the parser’s list state', () => {
    // HtmlToSpannedConverter keeps its list counter and empty-item flag in
    // STATIC fields, and a text view is parsed on the layout thread and on the
    // UI thread at once. Unpatched, five cold starts in fourteen drew a numbered
    // list with numbers out of order and phantom rows. patches/ makes fromHtml
    // synchronized; this fails if the patch did not apply.
    const parser = read('android/src/main/java/com/swmansion/enriched/common/parser/EnrichedParser.java');
    expect(parser, 'patches/react-native-enriched-html+*.patch did not apply; run npm install').toMatch(
      /public static synchronized <T> Spanned fromHtml\(/,
    );
    // And the reason for it is still there. When this fails, upstream fixed the
    // parser: drop the patch, then this test.
    expect(parser).toMatch(/private static Integer currentOrderedListItemIndex/);
  });

  it('still parses HTML on iOS the way richDocToDisplayHtml works around', () => {
    // Each of these is a workaround in packages/shared/src/richtextHtml.ts. When
    // one fails, upstream changed it: re-check that workaround on an iPhone.
    const ios = read('ios/htmlParser/HtmlParser.mm');
    // <br> becomes a newline only beside another tag: a <p> per line.
    expect(ios).toMatch(/stringByAddingNewlinesToTag:@"<br>"/);
    // An href is cut out of the attribute as written, escapes and all:
    // decodeDisplayHref, on iOS only.
    expect(ios).toMatch(/substringWithRange:NSMakeRange\(hrefRange\.location \+ 6,/);
    // Open tags are kept by name: a mark is never written inside itself.
    expect(ios).toMatch(/ongoingTags\[currentTagName\] = tagArr;/);
  });

  it('still takes selectable and a link callback from JavaScript', () => {
    const spec = read('src/spec/EnrichedTextNativeComponent.ts');
    expect(spec).toMatch(/selectable: boolean/);
    expect(spec).toMatch(/onLinkPress\?:/);
  });
});
