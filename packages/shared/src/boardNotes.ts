/**
 * A board's notes: one page of rich text everyone on the board reads and
 * edits, with a history of who changed it and when (Faisal, 2026-11-25).
 *
 * The page is `boards/{id}/notes/current`, the history its `versions`
 * subcollection. Clients write the page; only the server writes versions
 * (`functions/src/boardNotes.ts`), so a version's name and time are the
 * server's. Everything both sides decide about a version lives here: when a
 * save folds into the one before it, what a save changed, and how that is
 * said in a line.
 */
import { todayInOrgTz } from './due';
import { parseRich, type RichInline } from './richtext';

/** Stored characters, the rich text's markdown included. Restated in firestore.rules. */
export const BOARD_NOTES_MAX = 50000;

/** The one notes document per board. Restated in firestore.rules. */
export const NOTES_DOC_ID = 'current';

/**
 * Saves by one person this close to their last one make one version: people
 * save, spot a typo and save again. The same idea as the quiet window change
 * notices wait for (`NOTICE_QUIET_MS`), longer because a page is edited in
 * sittings.
 */
export const NOTES_SITTING_MS = 10 * 60 * 1000;

/** Boards whose notes panel a person keeps open on a wide screen. Restated in firestore.rules. */
export const NOTES_OPEN_MAX = 500;

/** `boards/{id}/notes/current`, as the client writes it. */
export interface BoardNotesDoc {
  /** Markdown, the five elements (`richtext.ts`). Empty is no notes. */
  text: string;
  /** 1 for the first save, one more for each after; rules hold every save to it. */
  version: number;
  updatedBy: string;
  updatedAt: number;
  /** The id of the version this save put back, when it is a restore. */
  restoredFrom?: string;
  /** Set by an agent's write, equal to `updatedAt` (the robot badge). */
  agentAt?: number;
}

/**
 * `boards/{id}/notes/current/versions/{id}`, written by the server only.
 *
 * One per sitting, so a version's id is the page version that started it and
 * `version` the last one folded in.
 */
export interface NotesVersionDoc {
  text: string;
  version: number;
  by: string;
  /** Stored when it happens (`functions/src/names.ts`): the person may leave the board. */
  byName?: string;
  /** The last save folded in. */
  at: number;
  /** The first save of the sitting. */
  startedAt: number;
  /** Lines the sitting added and removed, git-style (`notesLineCounts`). */
  added: number;
  removed: number;
  restoredFrom?: string;
  /** When the restored version was saved, so the line can name its day. */
  restoredAt?: number;
  /** A clone's first version: the name of the board its notes came from. */
  copiedFrom?: string;
  via?: 'agent';
}

/** The fields of a save that decide whether it folds into the version before it. */
export interface NotesSave {
  by: string;
  at: number;
  via?: 'agent';
  restoredFrom?: string;
}

/**
 * Does this save join the latest version instead of starting a new one?
 *
 * Only the same person, the same way (an agent's edit is never folded into
 * the person's own), within `NOTES_SITTING_MS` of the last save. A restore
 * always stands alone, and nothing joins a restore or a clone's copy: each is
 * a line someone may look for.
 */
export function foldsIntoSitting(
  latest: Pick<NotesVersionDoc, 'by' | 'at' | 'via' | 'restoredFrom' | 'copiedFrom'>,
  next: NotesSave,
): boolean {
  if (next.restoredFrom || latest.restoredFrom || latest.copiedFrom) return false;
  if (latest.by !== next.by || (latest.via ?? null) !== (next.via ?? null)) return false;
  return next.at >= latest.at && next.at - latest.at < NOTES_SITTING_MS;
}

// ---------------------------------------------------------------------------
// What changed, counted
// ---------------------------------------------------------------------------

function flat(nodes: RichInline[]): string {
  return nodes.map((n) => (n.kind === 'text' ? n.text : flat(n.content))).join('');
}

/**
 * The page as lines a reader sees, each with its kind: a paragraph's lines
 * (a phone writes soft breaks), a bullet, a numbered item. A numbered item's
 * number is its place, so it is not part of the line: an item added at the
 * top would otherwise "change" the whole list.
 */
function lines(markdown: string): string[] {
  return parseRich(markdown).flatMap((b) =>
    b.kind === 'paragraph'
      ? flat(b.content).split('\n').map((t) => `p ${t}`)
      : b.items.map((item) => `${b.kind === 'bullets' ? 'b' : 'n'} ${flat(item)}`),
  );
}

/**
 * Past this many comparisons the middle of a page is not searched for lines
 * the two versions share: each of its lines counts as removed and added. A
 * pasted page cannot make the trigger, or a phone, spend more than a moment.
 */
const COUNT_CELLS_MAX = 25_000_000;

/**
 * Lines added and removed from one version to the next, as a diff tool
 * counts them: an edited line is one removed and one added.
 *
 * The longest run of lines the two share, in two rows of memory. A shared
 * start and end are matched first, since an edit touches a small part of a
 * page, and only the rest is searched.
 */
export function notesLineCounts(before: string, after: string): { added: number; removed: number } {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  let middle = 0;
  if (x.length > 0 && y.length > 0 && x.length * y.length <= COUNT_CELLS_MAX) {
    let prev = new Uint32Array(y.length + 1);
    let row = new Uint32Array(y.length + 1);
    for (let i = 1; i <= x.length; i += 1) {
      for (let j = 1; j <= y.length; j += 1) {
        row[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
      }
      [prev, row] = [row, prev];
    }
    middle = prev[y.length];
  }
  const shared = start + (a.length - endA) + middle;
  return { added: b.length - shared, removed: a.length - shared };
}

/** A version's counts as a list shows them: "+3 −1", or what made it. */
export function notesVersionLine(
  v: Pick<NotesVersionDoc, 'added' | 'removed' | 'copiedFrom' | 'restoredFrom' | 'restoredAt'>,
): string {
  if (v.copiedFrom) return `Copied from ${v.copiedFrom}`;
  const counts =
    v.added || v.removed
      ? [v.added ? `+${v.added}` : '', v.removed ? `\u2212${v.removed}` : ''].filter(Boolean).join(' ')
      : 'No lines changed';
  if (v.restoredFrom) {
    const day = v.restoredAt ? ` of ${todayInOrgTz(new Date(v.restoredAt))}` : '';
    return `Restored the version${day} · ${counts}`;
  }
  return counts;
}
