import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MAX_WATCHED_COLUMNS,
  NOTICE_MAX_WAIT_MS,
  NOTICE_QUIET_MS,
  arrivalOf,
  arrivalText,
  changeNoticeText,
  noticeAllowed,
  noticeDue,
  noticeEntriesFor,
  noticeFollowers,
  watchKey,
  watchKeyOnBoard,
  type NoticeEntry,
} from '../src/notices';

const T = 1_000_000;
const e = (type: NoticeEntry['type'], actorUid: string, at: number, more: Partial<NoticeEntry> = {}) =>
  ({ type, actorUid, at, ...more }) as NoticeEntry;

const names: Record<string, string> = { sara: 'Sara', omar: 'Omar', faisal: 'Faisal' };
const columns: Record<string, string> = { todo: 'To Do', review: 'Review', done: 'Done' };
const text = (entries: NoticeEntry[], recipientUid: string, cardTitle = 'Budget') =>
  changeNoticeText({
    cardTitle,
    entries: noticeEntriesFor(entries, recipientUid),
    recipientUid,
    nameFor: (u) => names[u] ?? 'Someone',
    columnNameFor: (c) => columns[c] ?? 'a column',
  });

describe('noticeDue', () => {
  it('waits for two quiet minutes after the last entry', () => {
    const burst = [e('edited', 'sara', T, { to: 'Budget' }), e('due', 'sara', T + 30_000)];
    expect(noticeDue(burst, T + 30_000 + NOTICE_QUIET_MS - 1)).toBe(false);
    expect(noticeDue(burst, T + 30_000 + NOTICE_QUIET_MS)).toBe(true);
  });

  it('sends ten minutes after the first entry however busy the card stays', () => {
    // An entry every minute would otherwise hold the notice back for ever.
    const burst = Array.from({ length: 12 }, (_, i) => e('labels', 'sara', T + i * 60_000));
    expect(noticeDue(burst, T + NOTICE_MAX_WAIT_MS - 1)).toBe(false);
    expect(noticeDue(burst, T + NOTICE_MAX_WAIT_MS)).toBe(true);
  });

  it('treats an empty burst as due, so the sweep clears it', () => {
    expect(noticeDue([], T)).toBe(true);
  });
});

describe('noticeAllowed: archived cards are dormant', () => {
  it('announces anything on a card that is not archived', () => {
    expect(noticeAllowed([e('due', 'sara', T)], { archived: false })).toBe(true);
  });

  it('still sends the burst that archived the card, as its last notice', () => {
    const burst = [e('due', 'sara', T), e('archived', 'sara', T + 1, { from: 'false', to: 'true' })];
    expect(noticeAllowed(burst, { archived: true })).toBe(true);
  });

  it('sends nothing for changes to a card that was already archived', () => {
    expect(noticeAllowed([e('labels', 'sara', T)], { archived: true })).toBe(false);
  });

  it('sends nothing when a burst restored the card and archived it again', () => {
    const burst = [
      e('archived', 'sara', T, { from: 'true', to: 'false' }),
      e('archived', 'sara', T + 1, { from: 'false', to: 'true' }),
    ];
    // The last archive entry put it away, so this is the archiving burst.
    expect(noticeAllowed(burst, { archived: true })).toBe(true);
    expect(noticeAllowed(burst.slice(0, 1), { archived: true })).toBe(false);
  });
});

describe('noticeFollowers', () => {
  const card = { subscriberUids: ['faisal'], assigneeUids: ['omar'], memberUids: ['faisal', 'omar', 'sara'] };

  it('is the subscribers and the assignees, once each', () => {
    expect(
      noticeFollowers({ ...card, subscriberUids: ['faisal', 'omar'], entries: [] }).sort(),
    ).toEqual(['faisal', 'omar']);
  });

  it('includes someone the burst unassigned, for their last notice', () => {
    const entries = [e('unassigned', 'faisal', T, { to: 'sara' })];
    expect(noticeFollowers({ ...card, entries })).toContain('sara');
  });

  it('never includes someone no longer on the board', () => {
    // Removing a member unassigns them; they must not be sent the card's title.
    const entries = [e('unassigned', 'faisal', T, { to: 'gone' })];
    expect(noticeFollowers({ ...card, entries })).not.toContain('gone');
  });
});

describe('noticeEntriesFor', () => {
  it('leaves out what the recipient did themselves', () => {
    const burst = [e('due', 'sara', T), e('labels', 'omar', T + 1)];
    expect(noticeEntriesFor(burst, 'sara').map((x) => x.type)).toEqual(['labels']);
  });

  it('leaves out the recipient’s own assignment and everything before it', () => {
    // The assignment went out at once; they will see the card as it stood.
    const burst = [
      e('created', 'sara', T),
      e('assigned', 'sara', T + 1, { to: 'omar' }),
      e('due', 'sara', T + 1),
      e('labels', 'sara', T + 2),
    ];
    expect(noticeEntriesFor(burst, 'omar').map((x) => x.type)).toEqual(['labels']);
  });

  it('leaves out the card’s creation, which is never news to a follower', () => {
    const burst = [e('created', 'sara', T), e('due', 'sara', T + 1, { to: '2026-11-05' })];
    expect(noticeEntriesFor(burst, 'faisal').map((x) => x.type)).toEqual(['due']);
  });

  it('reports a state that changed twice at its last value', () => {
    const burst = [
      e('moved', 'sara', T, { from: 'todo', to: 'review' }),
      e('moved', 'sara', T + 1, { from: 'review', to: 'done' }),
    ];
    expect(noticeEntriesFor(burst, 'faisal')).toEqual([burst[1]]);
  });

  it('keeps a rename and a description edit apart', () => {
    const burst = [e('edited', 'sara', T, { from: 'Old', to: 'Budget' }), e('edited', 'sara', T + 1)];
    expect(noticeEntriesFor(burst, 'faisal')).toHaveLength(2);
  });

  it('keeps every file attached', () => {
    const burst = [e('attached', 'sara', T, { to: 'a.pdf' }), e('attached', 'sara', T + 1, { to: 'b.pdf' })];
    expect(noticeEntriesFor(burst, 'faisal')).toHaveLength(2);
  });
});

describe('changeNoticeText', () => {
  it('names the card, then the changes in the history’s words', () => {
    const burst = [
      e('moved', 'sara', T, { from: 'todo', to: 'done' }),
      e('due', 'sara', T + 1, { to: '2026-11-05' }),
    ];
    expect(text(burst, 'faisal')).toBe(
      '“Budget”: Sara moved it to Done, set the due date to 2026-11-05',
    );
  });

  it('gives each person their own part', () => {
    const burst = [e('attached', 'sara', T, { to: 'plan.pdf' }), e('labels', 'omar', T + 1)];
    expect(text(burst, 'faisal')).toBe('“Budget”: Sara attached plan.pdf; Omar changed the labels');
  });

  it('says "you" when the change was to the recipient', () => {
    expect(text([e('unassigned', 'sara', T, { to: 'omar' })], 'omar')).toBe(
      '“Budget”: Sara unassigned you',
    );
  });

  it('spells out four changes and counts the rest', () => {
    const burst = [
      e('moved', 'sara', T, { from: 'todo', to: 'done' }),
      e('due', 'sara', T + 1, { to: '2026-11-05' }),
      e('labels', 'sara', T + 2),
      e('priority', 'sara', T + 3, { to: 'high' }),
      e('attached', 'sara', T + 4, { to: 'a.pdf' }),
      e('attached', 'sara', T + 5, { to: 'b.pdf' }),
    ];
    expect(text(burst, 'faisal')).toBe(
      '“Budget”: Sara moved it to Done, set the due date to 2026-11-05, changed the labels, set priority to high, and 2 more changes',
    );
  });
});

describe('arrivalOf', () => {
  const live = (columnId: string) => ({ columnId, archived: false });

  it('is a move from another column', () => {
    const burst = [e('moved', 'sara', T, { from: 'todo', to: 'review' })];
    expect(arrivalOf(burst, live('review'))).toEqual({ kind: 'moved', actorUid: 'sara' });
  });

  it('is not a card dragged through the column on its way elsewhere', () => {
    const burst = [
      e('moved', 'sara', T, { from: 'todo', to: 'review' }),
      e('moved', 'sara', T + 1, { from: 'review', to: 'done' }),
    ];
    // Review's watchers hear nothing; Done's do.
    expect(arrivalOf(burst, live('done'))).toEqual({ kind: 'moved', actorUid: 'sara' });
  });

  it('is not a card moved out and back again', () => {
    const burst = [
      e('moved', 'sara', T, { from: 'review', to: 'done' }),
      e('moved', 'omar', T + 1, { from: 'done', to: 'review' }),
    ];
    expect(arrivalOf(burst, live('review'))).toBeNull();
  });

  it('is a card created in the column', () => {
    expect(arrivalOf([e('created', 'sara', T)], live('todo'))).toEqual({
      kind: 'created',
      actorUid: 'sara',
    });
  });

  it('is a card restored into the column, named for whoever restored it', () => {
    const burst = [e('archived', 'omar', T, { from: 'true', to: 'false' })];
    expect(arrivalOf(burst, live('todo'))).toEqual({ kind: 'restored', actorUid: 'omar' });
  });

  it('is nothing for an edit that left the card where it was', () => {
    expect(arrivalOf([e('due', 'sara', T)], live('todo'))).toBeNull();
  });

  it('is nothing for an archived card', () => {
    const burst = [e('moved', 'sara', T, { from: 'todo', to: 'review' })];
    expect(arrivalOf(burst, { columnId: 'review', archived: true })).toBeNull();
  });

  it('pairs the name with that person’s own action', () => {
    // Sara restores it, Omar moves it into Review: Omar moved it.
    const restoredThenMoved = [
      e('archived', 'sara', T, { from: 'true', to: 'false' }),
      e('moved', 'omar', T + 1, { from: 'todo', to: 'review' }),
    ];
    expect(arrivalOf(restoredThenMoved, live('review'))).toEqual({
      kind: 'moved',
      actorUid: 'omar',
    });
    // Sara adds it to To Do, Omar moves it into Review: the same.
    const createdThenMoved = [
      e('created', 'sara', T),
      e('moved', 'omar', T + 1, { from: 'todo', to: 'review' }),
    ];
    expect(arrivalOf(createdThenMoved, live('review'))).toEqual({
      kind: 'moved',
      actorUid: 'omar',
    });
    // Restored, then edited in place: still the restore, and its restorer.
    const restoredThenEdited = [
      e('archived', 'sara', T, { from: 'true', to: 'false' }),
      e('due', 'omar', T + 1),
    ];
    expect(arrivalOf(restoredThenEdited, live('todo'))).toEqual({
      kind: 'restored',
      actorUid: 'sara',
    });
  });

  it('names the last person to move it in, not the first to touch it', () => {
    const burst = [
      e('due', 'omar', T),
      e('moved', 'sara', T + 1, { from: 'todo', to: 'review' }),
    ];
    expect(arrivalOf(burst, live('review'))?.actorUid).toBe('sara');
  });
});

describe('arrivalText', () => {
  const args = { actorName: 'Sara', cardTitle: 'Budget', columnName: 'Review' };
  it('reads for each way a card arrives', () => {
    expect(arrivalText({ ...args, kind: 'moved' })).toBe('Sara moved “Budget” into Review');
    expect(arrivalText({ ...args, kind: 'created' })).toBe('Sara added “Budget” to Review');
    expect(arrivalText({ ...args, kind: 'restored' })).toBe('Sara restored “Budget” to Review');
  });
});

describe('watchKey', () => {
  it('joins the board and column with a character no Firestore id contains', () => {
    expect(watchKey('b1', 'c1')).toBe('b1/c1');
  });

  it('tells which board a key is on, without mistaking one id for the start of another', () => {
    expect(watchKeyOnBoard(watchKey('b1', 'c1'), 'b1')).toBe(true);
    expect(watchKeyOnBoard(watchKey('b10', 'c1'), 'b1')).toBe(false);
  });
});

describe('MAX_WATCHED_COLUMNS', () => {
  it('is the bound firestore.rules holds, since rules cannot import it', () => {
    const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
    expect(rules).toContain(`watchedColumns.size() <= ${MAX_WATCHED_COLUMNS}`);
  });
});
