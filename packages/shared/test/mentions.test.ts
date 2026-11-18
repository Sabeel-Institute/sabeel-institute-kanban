import { describe, it, expect } from 'vitest';
import {
  activeMentionQuery,
  completeMention,
  extractMentions,
  isMentionQuery,
  mentionSuggestions,
} from '../src/mentions';
import { handleFor } from '../src/people';

const people = [
  { uid: 'u1', displayName: 'Sara Ahmed', email: 'sara@oursabeel.com' },
  { uid: 'u2', displayName: 'Faisal Shah', email: 'faisal@oursabeel.com' },
  { uid: 'u3', displayName: 'Sarah Khan', email: 'sarah@oursabeel.com' },
  { uid: 'u4', displayName: 'Omar Ali', email: 'omar.ali@oursabeel.com' },
];

describe('handleFor', () => {
  it('uses the email local part, lowercased', () => {
    expect(handleFor('Sara@OurSabeel.com')).toBe('sara');
    expect(handleFor('omar.ali@oursabeel.com')).toBe('omar.ali');
  });
});

describe('extractMentions', () => {
  it('finds a mention', () => {
    expect(extractMentions('hey @sara can you look?', people)).toEqual(['u1']);
  });

  it('finds several, without duplicates', () => {
    const found = extractMentions('@sara and @faisal and @sara again', people);
    expect(found.sort()).toEqual(['u1', 'u2']);
  });

  it('does not confuse @sara with @sarah', () => {
    // The bug that would quietly notify the wrong colleague.
    expect(extractMentions('@sarah please review', people)).toEqual(['u3']);
    expect(extractMentions('@sara please review', people)).toEqual(['u1']);
  });

  it('handles a handle containing a dot', () => {
    expect(extractMentions('cc @omar.ali', people)).toEqual(['u4']);
  });

  it('ignores trailing punctuation', () => {
    expect(extractMentions('thanks @sara!', people)).toEqual(['u1']);
    expect(extractMentions('thanks @sara, much appreciated', people)).toEqual(['u1']);
  });

  it('ignores unknown handles', () => {
    expect(extractMentions('@nobody here', people)).toEqual([]);
  });

  it('ignores an email address written in full', () => {
    // "mail sara@oursabeel.com" is not a mention of sara — there is no @handle
    // token at a word boundary.
    expect(extractMentions('mail sara@oursabeel.com about it', people)).toEqual([]);
  });

  it('returns nothing for text with no mentions', () => {
    expect(extractMentions('a plain comment', people)).toEqual([]);
  });
});

describe('mentionSuggestions', () => {
  it('offers everyone for an empty query', () => {
    expect(mentionSuggestions('', people)).toHaveLength(4);
  });

  it('matches on handle', () => {
    expect(mentionSuggestions('sar', people).map((p) => p.uid).sort()).toEqual([
      'u1',
      'u3',
    ]);
  });

  it('matches on display name', () => {
    expect(mentionSuggestions('khan', people).map((p) => p.uid)).toEqual(['u3']);
  });

  it('does not match the shared email DOMAIN, which would match everybody', () => {
    // Every account is @oursabeel.com. Matching the whole address meant that
    // typing `@o` — or s, e, a, u, r, b, l, c, m — returned every account and
    // the list appeared not to narrow at all.
    for (const q of ['o', 'u', 'r', 'b', 'l', 'ours', 'oursabeel', '.com']) {
      expect(
        mentionSuggestions(q, people).length,
        `"${q}" must not match everyone`,
      ).toBeLessThan(people.length);
    }
    // The handle IS the local part, so nothing that mattered was lost.
    expect(mentionSuggestions('omar', people).map((p) => p.uid)).toEqual(['u4']);
  });

  it('ranks a match at the START above one in the middle', () => {
    // "@s" matches Sara Ahmed at the start and Faisal Shah in the middle
    // ("fai-s-al"). Alphabetical alone put Faisal first, which is not who you
    // meant. Both are still offered — surnames are a real way to search.
    expect(mentionSuggestions('s', people).map((p) => p.uid)).toEqual([
      'u1', // Sara Ahmed  — handle starts with s
      'u3', // Sarah Khan  — handle starts with s
      'u2', // Faisal Shah — "Shah" and "faisal" both contain s
    ]);
  });

  it('prefers the prioritised person even over a start-match', () => {
    // Being on the card outranks how well the letters line up.
    expect(mentionSuggestions('s', people, { prioritise: ['u2'] })[0].uid).toBe('u2');
  });

  it('is case-insensitive', () => {
    expect(mentionSuggestions('FAISAL', people).map((p) => p.uid)).toEqual(['u2']);
  });

  it('returns EVERY match, because the list scrolls', () => {
    // It used to stop at five. On a board carrying the whole organisation that
    // left people unreachable unless you guessed enough of a prefix — the
    // report this change came from.
    const many = Array.from({ length: 12 }, (_, i) => ({
      uid: `m${i}`,
      displayName: `Person ${String(i).padStart(2, '0')}`,
      email: `person${i}@oursabeel.com`,
    }));
    expect(mentionSuggestions('', many)).toHaveLength(12);
    expect(mentionSuggestions('person', many)).toHaveLength(12);
  });

  it('sorts by display name', () => {
    expect(mentionSuggestions('', people).map((p) => p.displayName)).toEqual([
      'Faisal Shah',
      'Omar Ali',
      'Sara Ahmed',
      'Sarah Khan',
    ]);
  });

  it('floats prioritised people to the top, each group alphabetical', () => {
    const out = mentionSuggestions('', people, { prioritise: ['u3', 'u4'] });
    expect(out.map((p) => p.uid)).toEqual([
      'u4', // Omar Ali     — on the card
      'u3', // Sarah Khan   — on the card
      'u2', // Faisal Shah
      'u1', // Sara Ahmed
    ]);
  });

  it('only REORDERS — a prioritised person who does not match stays out', () => {
    // Being on the card must not resurrect someone the query excludes, or
    // typing a name would start showing people who do not have it.
    const out = mentionSuggestions('khan', people, { prioritise: ['u1', 'u2'] });
    expect(out.map((p) => p.uid)).toEqual(['u3']);
  });

  it('prioritising someone absent from the candidates changes nothing', () => {
    const out = mentionSuggestions('', people, { prioritise: ['nobody'] });
    expect(out.map((p) => p.uid)).toEqual(['u2', 'u4', 'u1', 'u3']);
  });
});

describe('completeMention truncation', () => {
  const sara = { uid: 'u1', displayName: 'Sara Ahmed', email: 'sara@oursabeel.com' };

  it('leaves a comfortable comment alone', () => {
    expect(completeMention('hey @sa', '', sara, 100)).toBe('hey @sara ');
  });

  it('clamps a completion that would exceed the cap', () => {
    // The field caps TYPING; nothing capped the value the completion sets, so
    // the post failed with a bare permission-denied from the rules.
    const out = completeMention('hey @sa', '', sara, 8);
    expect(out).toHaveLength(8);
    expect(out).toBe('hey @sar');
  });

  it('is unbounded when no cap is given', () => {
    expect(completeMention('hey @sa', '', sara)).toBe('hey @sara ');
  });
});

describe('activeMentionQuery', () => {
  it('detects a mention being typed', () => {
    expect(activeMentionQuery('hey @sa')).toBe('sa');
    expect(activeMentionQuery('@')).toBe('');
  });

  it('returns null when the caret is not in a mention', () => {
    expect(activeMentionQuery('hey @sara ')).toBeNull();
    expect(activeMentionQuery('plain text')).toBeNull();
  });

  it('does not fire mid-word (an email address is not a mention)', () => {
    expect(activeMentionQuery('mail sara@ours')).toBeNull();
  });
});

describe('completeMention', () => {
  it('replaces the partial handle and adds a space', () => {
    expect(completeMention('hey @sa', '', people[0])).toBe('hey @sara ');
  });

  it('keeps text after the caret', () => {
    expect(completeMention('hey @sa', ' please look', people[0])).toBe(
      'hey @sara  please look',
    );
  });

  it('works at the very start', () => {
    expect(completeMention('@f', '', people[1])).toBe('@faisal ');
  });
});

/**
 * The rule the two editors have to agree on.
 *
 * Web derives the query from the text up to the caret, so a non-handle simply
 * fails to match and the popover never opens. Native is TOLD there is a mention
 * by the editor library, whose own rule differs — it looks at the word before
 * the caret with `Character.isWhitespace` boundaries, which include `\n`. On a
 * device, placing the caret on the line below a bare `@` walked back over the
 * newline and reported an active mention with a line break as its query; that
 * trims to empty, empty means "no query yet", and the whole roster opened with
 * the caret on the wrong line.
 *
 * These cases are paired with `activeMentionQuery` deliberately: they are two
 * expressions of one rule, and the pairing is what stops them drifting apart.
 */
describe('isMentionQuery', () => {
  it('accepts what a handle may contain, including the empty just-typed-@ case', () => {
    for (const q of ['', 'sara', 'faisal.shah', 'a_b', 'x%y', 'a+b', 'a-b', 'A1']) {
      expect(isMentionQuery(q), q).toBe(true);
    }
  });

  it('rejects anything with whitespace — a handle has none', () => {
    for (const q of ['\n', ' ', '\t', '\nLong', 'two words', 'sara ']) {
      expect(isMentionQuery(q), JSON.stringify(q)).toBe(false);
    }
  });

  it('agrees with activeMentionQuery, which is the same rule stated for web', () => {
    // Whatever web is willing to call a query, native must accept.
    for (const text of ['@', '@sa', 'hello @faisal.shah', 'a\n@x']) {
      const q = activeMentionQuery(text);
      expect(q, text).not.toBeNull();
      expect(isMentionQuery(q as string), text).toBe(true);
    }
    // And where web refuses to see a mention, the query native would be handed
    // is one this rejects.
    expect(activeMentionQuery('@sara\n')).toBeNull();
    expect(isMentionQuery('\n')).toBe(false);
  });

  it('is what stops a trimmed line break reading as "show everyone"', () => {
    // The actual device symptom, in one line: this query must never reach
    // mentionSuggestions, because mentionSuggestions would return the roster.
    const roster = [
      { uid: 'u1', email: 'a@x.com', displayName: 'A' },
      { uid: 'u2', email: 'b@x.com', displayName: 'B' },
    ];
    expect(mentionSuggestions('\n', roster)).toHaveLength(2);
    expect(isMentionQuery('\n')).toBe(false);
  });
});
