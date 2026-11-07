import { DEFAULT_COLUMNS } from './constants';
import type { BoardColumn, BoardDoc, Label, LabelDoc } from './types';

/**
 * Board construction and validation, shared so the client and any server-side
 * code agree on what a well-formed board looks like.
 */

/** Short random id for embedded columns (not Firestore doc ids). */
export function localId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Label colors: a fixed palette, not a free picker.
 *
 * Two constraints. They must stay legible on BOTH the light and dark app
 * backgrounds — a free picker guarantees someone chooses pale yellow and it
 * vanishes on ivory. And they should sit comfortably beside the Sabeel brand
 * palette (see docs/BRAND.md), so the first entries are drawn from it and the
 * rest are muted, earthy tones rather than saturated primaries.
 */
export const LABEL_COLORS = [
  '#83114F', // Dark Raspberry — brand (Option 1)
  '#C6A15B', // Antique Gold — brand (Option 1)
  '#4E7A43', // Sage, darkened to read on ivory
  '#A58D7A', // Mushroom Taupe — brand (Option 1)
  '#A32218', // clay red
  '#C2611F', // burnt orange
  '#3E6B8A', // slate blue
  '#6B4C8A', // violet plum (kept distinct from the raspberry plum above)
] as const;

export function defaultColumns(): BoardColumn[] {
  // A blank board is a worse first run than a wrong-but-editable one.
  return DEFAULT_COLUMNS.map((name) => ({ id: localId('col'), name }));
}

export function newBoard(params: {
  name: string;
  description?: string;
  createdBy: string;
  createdByProfile?: { displayName: string; email: string };
  now: number;
}): BoardDoc {
  const columns = defaultColumns();
  return {
    name: params.name.trim(),
    description: params.description?.trim() ?? '',
    archived: false,
    columns,
    columnIds: columns.map((c) => c.id),
    // The creator is always a member: a board nobody can see is a support ticket.
    memberUids: [params.createdBy],
    memberProfiles: params.createdByProfile
      ? { [params.createdBy]: params.createdByProfile }
      : {},
    // …and always its first OWNER, for the same reason one step further: a board
    // nobody can administer is a support ticket too, and the create rule refuses
    // one without this. That refusal is deliberate — it is what turns "an app too
    // old to know about ownership made a board only an admin can ever manage"
    // from a silent, permanent condition into a visible failure at creation.
    boardOwnerUids: [params.createdBy],
    // A fresh board has no cards; the onCardBoardCount trigger takes it from here.
    activeCardCount: 0,
    createdAt: params.now,
    createdBy: params.createdBy,
  };
}

/**
 * Columns and their flat id list must always move together — rules check card
 * writes against `columnIds`, so a desynced pair would either reject valid cards
 * or accept invented columns. Never write `columns` without this.
 */
export function columnsPatch(columns: BoardColumn[]): {
  columns: BoardColumn[];
  columnIds: string[];
} {
  return { columns, columnIds: columns.map((c) => c.id) };
}

export const BOARD_NAME_MAX = 120;

export function validateBoardName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Give the board a name.';
  if (trimmed.length > BOARD_NAME_MAX)
    return `Keep the name under ${BOARD_NAME_MAX} characters.`;
  return null;
}

export const COLUMN_NAME_MAX = 60;

export function validateColumnName(name: string, existing: BoardColumn[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Give the column a name.';
  if (trimmed.length > COLUMN_NAME_MAX)
    return `Keep the column name under ${COLUMN_NAME_MAX} characters.`;
  if (existing.some((c) => c.name.toLowerCase() === trimmed.toLowerCase()))
    return 'There is already a column with that name.';
  return null;
}

/**
 * Rename one column, or explain why not.
 *
 * The subtlety this exists to contain: `validateColumnName` rejects a name any
 * existing column already has — and the column being renamed is itself one of
 * those. Validating against the whole list would reject re-saving a column's own
 * name, and (less obviously) reject fixing only its CAPITALISATION, because the
 * duplicate check is case-insensitive. So the column being renamed is excluded
 * from the comparison, and every surface offering a rename goes through here
 * rather than re-deriving that.
 *
 * Returns the full column array so the caller can hand it straight to
 * `columnsPatch` — renaming must never write `columns` without `columnIds`.
 */
/**
 * Why this column cannot be deleted yet, or null if it can.
 *
 * A column delete is irreversible and would strand whatever is in it, so the
 * rule is: empty first, then confirm. All three board surfaces asked this
 * question with their own slightly different wording; it belongs in one place so
 * the answer — and the sentence explaining it — cannot drift between them.
 */
export function columnDeleteBlocked(name: string, cardCount: number): string | null {
  if (cardCount <= 0) return null;
  return (
    `“${name}” still has ${cardCount} card${cardCount === 1 ? '' : 's'}. ` +
    'Move or archive them first — deleting a column must never take cards with it.'
  );
}

export type RenameColumnResult =
  | { ok: true; columns: BoardColumn[] }
  | { ok: false; error: string };

export function renameColumn(
  columns: readonly BoardColumn[],
  columnId: string,
  rawName: string,
): RenameColumnResult {
  const problem = validateColumnName(
    rawName,
    columns.filter((c) => c.id !== columnId),
  );
  if (problem) return { ok: false, error: problem };
  const trimmed = rawName.trim();
  return {
    ok: true,
    columns: columns.map((c) => (c.id === columnId ? { ...c, name: trimmed } : c)),
  };
}

/**
 * Shorter than a column's 60: a label is a TAG, and it renders as a chip on the
 * card face beside other chips. A chip is a box drawn around its text, so an
 * over-long name makes a chip wider than the card it sits on — which react-
 * native-web clips and Android draws anyway. Capping the name is what makes that
 * unreachable; nothing downstream has to defend against it.
 *
 * Now that a label is its own document this IS expressible in firestore.rules,
 * and the rules check it too — a per-entry check on an embedded array never was.
 */
export const LABEL_NAME_MAX = 40;

/**
 * Names are unique within what one board shows, case-insensitively: pass the
 * institute labels and that board's own, or the institute labels alone for a
 * new institute label. Two labels
 * differing only in case are indistinguishable on a card face — the chip shows
 * the name and nothing else — so the pair is unusable rather than merely untidy.
 *
 * `exceptId` excludes the label being renamed, the same self-exclusion
 * `renameColumn` needs; omit it when creating.
 *
 * Client-side only: Firestore rules cannot see across documents, so a
 * simultaneous double-create yields two same-named labels. An admin deletes
 * one. Documented in docs/PRODUCT_BRIEF.md as an accepted residual.
 */
export function validateLabelName(
  name: string,
  existing: readonly Label[],
  exceptId?: string,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Give the label a name.';
  if (trimmed.length > LABEL_NAME_MAX)
    return `Keep the label name under ${LABEL_NAME_MAX} characters.`;
  if (
    existing.some(
      (l) => l.id !== exceptId && l.name.toLowerCase() === trimmed.toLowerCase(),
    )
  )
    return 'There is already a label with that name.';
  return null;
}

/** The document body. The id is Firestore's, not ours — labels are real docs. */
export function newLabel(params: {
  name: string;
  color: string;
  createdBy: string;
  now: number;
  /** The board that owns it, or `null` for an institute label. */
  boardId: string | null;
}): LabelDoc {
  return {
    ...(params.boardId !== null ? { boardId: params.boardId } : {}),
    name: params.name.trim(),
    color: params.color,
    createdAt: params.now,
    createdBy: params.createdBy,
  };
}

/**
 * The sentence shown before deleting a label.
 *
 * Live and archived cards are counted separately because they read completely
 * differently: three cards on boards you can see is a very different prospect
 * from three cards nobody will ever look at again. Here rather than inline in
 * the screen so the plurals and the zero cases can be tested.
 */
export function describeLabelUsage(usage: { active: number; archived: number }): string {
  const card = (n: number) => `${n} card${n === 1 ? '' : 's'}`;
  if (usage.active === 0 && usage.archived === 0) return 'No cards use it.';
  if (usage.archived === 0) return `It is on ${card(usage.active)}.`;
  if (usage.active === 0) return `It is on ${card(usage.archived)}, all archived.`;
  return `It is on ${card(usage.active)}, plus ${card(usage.archived)} in the archive.`;
}

/**
 * Display order.
 *
 * Sorted HERE rather than with a Firestore `orderBy('name')` because that orders
 * by UTF-16 code unit — but `localeCompare` alone is not enough either. A dozen
 * of these names carry a ClickUp emoji prefix, and either way every one of them
 * files under the emoji: "📋 Governance" lands at the top of the list instead of
 * under G, which is where someone looking for it will look.
 *
 * So the sort key ignores anything leading that is not a letter or digit. The
 * emoji still SHOWS — the team chose to keep them — it just stops deciding where
 * the label sits.
 */
function sortKey(name: string): string {
  const trimmed = name.replace(/^[^\p{L}\p{N}]+/u, '');
  // A name that is nothing BUT punctuation still has to sort somewhere.
  return trimmed.length > 0 ? trimmed : name;
}

export function sortLabels<T extends { name: string }>(labels: readonly T[]): T[] {
  return [...labels].sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
}

/**
 * What a board offers: the institute labels first, then the board's own, each
 * in `sortLabels` order. Another board's labels never appear, which is the
 * point of having them.
 */
export function labelsForBoard<T extends { name: string; boardId?: string }>(
  labels: readonly T[],
  boardId: string,
): T[] {
  return [
    ...sortLabels(labels.filter((l) => !l.boardId)),
    ...sortLabels(labels.filter((l) => l.boardId === boardId)),
  ];
}

/**
 * A card's labels once it lands on another board, by a move or a copy.
 *
 * Institute labels come along, the source board's own stay behind, and an id
 * that resolves to no label is dropped rather than carried as dead weight. One
 * of the destination board's own is kept, which only a card that once lived
 * there can hold.
 *
 * `labels` must be the LOADED list. Called with an empty one, because a list
 * still loading read as "no labels", it would strip every label off the card;
 * the callers wait for it.
 */
export function labelIdsAfterBoardChange(
  labelIds: readonly string[],
  labels: readonly { id: string; boardId?: string }[],
  destBoardId: string,
): string[] {
  const byId = new Map(labels.map((l) => [l.id, l]));
  return labelIds.filter((id) => {
    const l = byId.get(id);
    return l !== undefined && (!l.boardId || l.boardId === destBoardId);
  });
}

/**
 * Board list ordering: favourites first, then most-recently-opened, then the
 * rest alphabetically. With no board cap the flat list is what degrades first,
 * and this is the cheapest structure that scales without asking anyone to
 * curate folders.
 */
export function sortBoardsForList<T extends { id: string; name: string }>(
  boards: T[],
  favouriteIds: readonly string[],
  recentIds: readonly string[],
): { favourites: T[]; recents: T[]; others: T[] } {
  const fav = new Set(favouriteIds);
  const favourites = boards.filter((b) => fav.has(b.id));

  const recentRank = new Map(recentIds.map((id, i) => [id, i]));
  const recents = boards
    .filter((b) => !fav.has(b.id) && recentRank.has(b.id))
    .sort((a, b) => (recentRank.get(a.id) ?? 0) - (recentRank.get(b.id) ?? 0));

  const seen = new Set([...favourites, ...recents].map((b) => b.id));
  const others = boards
    .filter((b) => !seen.has(b.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    favourites: favourites.sort((a, b) => a.name.localeCompare(b.name)),
    recents,
    others,
  };
}

/** Most-recent-first, capped, no duplicates. */
export function pushRecent(
  recents: readonly string[],
  boardId: string,
  max: number,
): string[] {
  return [boardId, ...recents.filter((id) => id !== boardId)].slice(0, max);
}
