import { describe, expect, it } from 'vitest';
import { foldsIntoSitting, NOTES_SITTING_MS, notesLineCounts, notesVersionLine } from '../src/boardNotes';

const page = [
  '**Forms**',
  '',
  '- [Expense reimbursement](https://example.org/expense)',
  '- [Room booking](https://example.org/rooms) (classroom)',
  '',
  'Ask an owner to add you.',
].join('\n');

describe('a sitting', () => {
  const latest = { by: 'sara', at: 1_000_000 };

  it('takes the same person saving again soon after', () => {
    expect(foldsIntoSitting(latest, { by: 'sara', at: latest.at + NOTES_SITTING_MS - 1 })).toBe(true);
  });

  it('ends ten minutes after the last save', () => {
    expect(foldsIntoSitting(latest, { by: 'sara', at: latest.at + NOTES_SITTING_MS })).toBe(false);
  });

  it('never takes someone else, or an agent acting for the same person', () => {
    expect(foldsIntoSitting(latest, { by: 'omar', at: latest.at + 1 })).toBe(false);
    expect(foldsIntoSitting(latest, { by: 'sara', at: latest.at + 1, via: 'agent' })).toBe(false);
    expect(foldsIntoSitting({ ...latest, via: 'agent' }, { by: 'sara', at: latest.at + 1, via: 'agent' })).toBe(true);
  });

  it('keeps restores and copies as lines of their own', () => {
    expect(foldsIntoSitting(latest, { by: 'sara', at: latest.at + 1, restoredFrom: '3' })).toBe(false);
    expect(foldsIntoSitting({ ...latest, restoredFrom: '3' }, { by: 'sara', at: latest.at + 1 })).toBe(false);
    expect(foldsIntoSitting({ ...latest, copiedFrom: 'Template' }, { by: 'sara', at: latest.at + 1 })).toBe(false);
  });

  it('does not fold a save older than the version it would join', () => {
    expect(foldsIntoSitting(latest, { by: 'sara', at: latest.at - 1 })).toBe(false);
  });
});

describe('lines added and removed', () => {
  it('counts an edited line as one removed and one added, as a diff tool does', () => {
    expect(notesLineCounts(page, page.replace('(classroom)', '(classroom and hall)'))).toEqual({ added: 1, removed: 1 });
  });

  it('counts a first version as every line added, and emptying as every line removed', () => {
    expect(notesLineCounts('', page)).toEqual({ added: 4, removed: 0 });
    expect(notesLineCounts(page, '')).toEqual({ added: 0, removed: 4 });
  });

  it('counts a paragraph’s soft-broken lines one by one, as a phone writes them', () => {
    expect(notesLineCounts('one\ntwo\nthree', 'one\ntwo!\nthree')).toEqual({ added: 1, removed: 1 });
  });

  it('does not renumber a list into a change: an item added at the top is one line', () => {
    expect(notesLineCounts('1. b\n2. c\n3. d', '1. a\n2. b\n3. c\n4. d')).toEqual({ added: 1, removed: 0 });
  });

  it('counts a change of marks alone as no lines', () => {
    expect(notesLineCounts('Ask first', '**Ask** first')).toEqual({ added: 0, removed: 0 });
  });

  it('stays quick on a page pasted whole', () => {
    const before = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join('\n');
    const after = before.split('\n').map((l, i) => (i % 2 ? l : `${l}!`)).join('\n');
    const t = Date.now();
    const counts = notesLineCounts(before, after);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(counts.added).toBe(counts.removed);
  });
});

describe('how a version is listed', () => {
  it('as its counts, git-style', () => {
    expect(notesVersionLine({ added: 3, removed: 1 })).toBe('+3 −1');
    expect(notesVersionLine({ added: 4, removed: 0 })).toBe('+4');
    expect(notesVersionLine({ added: 0, removed: 0 })).toBe('No lines changed');
  });

  it('or by what made it', () => {
    expect(notesVersionLine({ added: 1, removed: 0, copiedFrom: 'Template' })).toBe('Copied from Template');
    expect(notesVersionLine({ added: 1, removed: 2, restoredFrom: '1', restoredAt: Date.UTC(2026, 10, 20, 18) }))
      .toBe('Restored the version of 2026-11-20 · +1 −2');
  });
});
