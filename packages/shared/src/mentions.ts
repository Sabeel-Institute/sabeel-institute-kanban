/**
 * @mention parsing for comments.
 *
 * Mentions are stored twice: as text inside the comment body, and as a
 * `mentionUids` array. The array is what rules validate and what notification
 * triggers read — parsing the body server-side on every write would be slower
 * and would have to agree exactly with the client's parser anyway.
 */

import { handleFor, matchPeople } from './people';

export interface MentionCandidate {
  uid: string;
  displayName: string;
  email: string;
}


/** What a handle may contain. The ONE definition; everything else derives. */
const HANDLE_CHARS = '[A-Za-z0-9._%+-]';

/**
 * `@all` is everyone on the board (Faisal, 2026-11-19). A reserved handle,
 * not a person: it expands to every candidate's uid, so the rules, the
 * notice, its preference and the board mute need nothing new.
 */
const ALL = 'all';

/** The suggestion row for `@all`, inserted like anyone else's handle. Its uid is no one's. */
export const MENTION_ALL: MentionCandidate = {
  uid: '*all',
  displayName: 'Everyone on this board',
  email: `${ALL}@`,
};

/**
 * Every handle written as `@handle`, lower-cased. A handle runs to the first
 * character that cannot appear in an email local part, and trailing dots are
 * the sentence's, so "@sara," and "@sara." are sara; "@sarah" is not.
 */
function handlesIn(body: string): Set<string> {
  const tokens = body.match(new RegExp(`@${HANDLE_CHARS}+`, 'g')) ?? [];
  return new Set(tokens.map((t) => withoutTrailingDots(t.slice(1).toLowerCase())));
}

/** A loop, not /\.+$/: that pattern is polynomial on a run of dots (CodeQL js/polynomial-redos). */
function withoutTrailingDots(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '.') end -= 1;
  return s.slice(0, end);
}

/** Whether the text mentions everyone on the board. */
export function mentionsAll(body: string): boolean {
  return handlesIn(body).has(ALL);
}

/** Everyone the text mentions: by handle, or all of them for `@all`. */
export function extractMentions(
  body: string,
  candidates: readonly MentionCandidate[],
): string[] {
  const handles = handlesIn(body);
  return candidates
    .filter((c) => handles.has(ALL) || handles.has(handleFor(c.email)))
    .map((c) => c.uid);
}

/**
 * Candidates for the autocomplete, given what has been typed after the "@".
 *
 * The matching is every person picker's (`matchPeople` in people.ts): the
 * handle and the display name, never the shared email domain, best match first.
 *
 * EVERY match is returned. This used to stop at five, which on a board with the
 * whole organisation on it meant eight people were unreachable unless you
 * guessed enough of a prefix — a silent cap the reader has no way to notice.
 * The list scrolls now, so there is nothing to cap.
 *
 * `prioritise` floats people already on the card to the top. With a small
 * organisation that is usually the whole fix: the person you want is the first
 * row rather than somewhere in a scroll. It only REORDERS — someone who does
 * not match the query is not resurrected by being on the card.
 */
export function mentionSuggestions(
  partial: string,
  candidates: readonly MentionCandidate[],
  opts: { prioritise?: readonly string[] } = {},
): MentionCandidate[] {
  const top = new Set(opts.prioritise ?? []);
  const people = matchPeople(partial, candidates, { first: (c) => top.has(c.uid) });
  // Everyone, first, when what is typed could be "all" or "everyone", and
  // there is more than one person to mean.
  const q = partial.trim().toLowerCase();
  const offersAll = candidates.length > 1 && (ALL.startsWith(q) || 'everyone'.startsWith(q));
  return offersAll ? [MENTION_ALL, ...people] : people;
}

/** The trigger character. One definition; both editors and the parser derive. */
export const MENTION_INDICATOR = '@';

/**
 * How a picked candidate is inserted — defined ONCE, for both editors.
 *
 * This existed twice, and the copies disagreed. Web inserted the literal text
 * `@handle`; native called the editor library's `setMention('@', handle)`,
 * which keeps the indicator in an attribute of a `<mention>` node. Our HTML
 * seam had no case for that node, so it was unwrapped, the "@" was lost, and
 * the stored body read "Cc sara". `extractMentions` scans for /@handle/, so it
 * found nobody and every native @mention since 2026-07-30 notified no one —
 * silently, because the popover, the chip and the posted comment all looked
 * right.
 *
 * The lesson is not "add a case to the converter". It is that two editors were
 * each deciding what a mention IS at the moment of insertion, with nothing
 * holding them to the same answer. They now derive it from here, and
 * `richtextHtml.test.ts` asserts the two shapes converge on identical markdown
 * and the same uid.
 */
export function mentionInsertion(candidate: MentionCandidate): {
  /** For the native editor's `setMention(indicator, text)`. */
  indicator: string;
  /** The native mention node's display text — NO indicator; it is an attribute. */
  text: string;
  /** What web types, and what BOTH surfaces must end up storing. */
  literal: string;
} {
  const handle = handleFor(candidate.email);
  return {
    indicator: MENTION_INDICATOR,
    text: handle,
    literal: `${MENTION_INDICATOR}${handle}`,
  };
}

/**
 * The partial handle currently being typed, or null when the caret is not in a
 * mention. Used to decide whether to show the autocomplete at all.
 */
export function activeMentionQuery(textUpToCaret: string): string | null {
  const m = textUpToCaret.match(new RegExp(`(?:^|\\s)@(${HANDLE_CHARS}*)$`));
  return m ? m[1] : null;
}

/**
 * Is this text a mention query at all?
 *
 * The rule was always here, hidden inside `activeMentionQuery`'s character
 * class: a handle has no whitespace, so a "query" containing any is not a
 * mention being typed. Web got this for free because it derives the query from
 * the text up to the caret and the pattern simply fails to match. NATIVE does
 * not derive it — the editor library decides, and its rule is different:
 * it looks at the word before the caret, and its word boundaries use
 * `Character.isWhitespace`, which includes `\n`. So placing the caret on the
 * line BELOW a bare `@` walked back over the newline, found the `@`, and
 * reported an active mention whose query was a line break. `mentionSuggestions`
 * trims, a trimmed line break is empty, and empty means "show everyone" — so
 * the whole roster opened with the caret nowhere near the `@`, and picking
 * someone would have inserted the handle on the wrong line and orphaned the
 * `@`.
 *
 * Exported so the native editor can apply the SAME rule as web rather than
 * trusting a third-party heuristic about our domain. Two surfaces disagreeing
 * about what a mention is, is precisely what one shared definition prevents.
 */
export function isMentionQuery(text: string): boolean {
  return new RegExp(`^${HANDLE_CHARS}*$`).test(text);
}

/**
 * Replace the mention being typed with a complete handle.
 *
 * `maxLength` truncates the RESULT. The field's own `maxLength` caps typing but
 * says nothing about a value set programmatically, so completing a mention on a
 * comment already at the limit produced a body a few characters over — and the
 * only symptom was a bare permission-denied when posting, because the rules cap
 * it too.
 *
 * Truncating can land inside the handle, leaving a mention that resolves to
 * nobody. That is the accepted trade at this size: it needs a comment within a
 * few characters of 5000 to happen at all, and losing the tail of a mention is
 * better than a write that fails with nothing to explain it.
 */
export function completeMention(
  textUpToCaret: string,
  rest: string,
  candidate: MentionCandidate,
  maxLength?: number,
): string {
  const replaced = textUpToCaret.replace(
    /(^|\s)@([A-Za-z0-9._%+-]*)$/,
    `$1@${handleFor(candidate.email)} `,
  );
  const full = replaced + rest;
  return maxLength === undefined ? full : full.slice(0, maxLength);
}
