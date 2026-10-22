import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { LABEL_COLORS, newLabel, sortLabels, type Label } from '@sabeel/shared';
import { db, functions } from './firebase';
import { useLiveQuery } from './liveQuery';
import type { SessionUser } from './session';

/**
 * The org-wide label set.
 *
 * One collection for the whole organisation — every board offers every label, so
 * there is nothing to scope this by. That is also what fixes My Work and Search:
 * both are cross-board, and both used to resolve a card's chips against a single
 * loaded board document, so a card from anywhere else rendered no chips at all.
 */
const labelsRef = () => collection(db, 'labels');

export function useLabels() {
  return useLiveQuery<Label[]>(
    () => labelsRef(),
    [],
    'labels',
    // Sorted here rather than with `orderBy('name')`: Firestore orders by UTF-16
    // code unit, which would file the dozen emoji-prefixed names together and far
    // from the words they belong beside. See `sortLabels` in @sabeel/shared.
    (docs) =>
      sortLabels(
        docs.map((d) => ({
          id: d.id,
          name: (d.data.name as string) ?? '',
          // Rules require a hex, so a missing colour means a document that
          // predates them or was written by the Admin SDK. Fall back to the
          // palette rather than a literal — the lint rule is right to refuse one.
          color: (d.data.color as string) ?? LABEL_COLORS[0],
          createdAt: (d.data.createdAt as number) ?? 0,
          createdBy: (d.data.createdBy as string) ?? '',
        })),
      ),
  );
}

/**
 * Any active member may add one. Returns the new id so the caller can apply it
 * to the card in the same breath — which is the whole point of the `+` in the
 * card's label picker.
 */
export async function createLabel(params: {
  name: string;
  color: string;
  user: SessionUser;
}): Promise<string> {
  const created = await addDoc(
    labelsRef(),
    newLabel({
      name: params.name,
      color: params.color,
      createdBy: params.user.uid,
      now: Date.now(),
    }),
  );
  return created.id;
}

/**
 * Rename or recolour — ADMINS only, enforced in rules. A label is org-wide, so
 * renaming one changes cards on boards the renamer may not even be a member of.
 * The id never moves, so
 * every card carrying the label follows the change rather than losing it.
 */
export async function updateLabel(
  labelId: string,
  patch: { name?: string; color?: string },
): Promise<void> {
  await updateDoc(doc(db, 'labels', labelId), {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
  });
}

/** How many cards carry a label, split by whether they are live or archived. */
export interface LabelUsage {
  active: number;
  archived: number;
}

const countUsageFn = httpsCallable<{ labelId: string }, LabelUsage>(
  functions,
  'countLabelUsage',
);

/**
 * "Delete Finance Request?" and "Delete it, removing it from 12 cards?" are
 * different questions — and so are "12 cards" and "2 cards plus 10 in the
 * archive", which is why the two come back separately.
 */
export async function countLabelUsage(labelId: string): Promise<LabelUsage> {
  const res = await countUsageFn({ labelId });
  return res.data;
}

const deleteLabelFn = httpsCallable<
  { labelId: string },
  { ok: boolean; strippedFromCards: number }
>(functions, 'deleteLabel');

/**
 * A callable, not a client delete: the label has to come off every card that
 * carries it, and only the server can do that completely and still record WHO
 * did it. `firestore.rules` denies the direct delete outright.
 *
 * `not-found` is success HERE, though the server reports it on purpose: the
 * label list trails the server, so a quick second tap names a label that was
 * deleted a moment ago, and what the person asked for is already true. The
 * server deletes the document only after the sweep, so it cannot be missing
 * while cards still carry it.
 */
export async function deleteLabel(labelId: string): Promise<number> {
  try {
    const res = await deleteLabelFn({ labelId });
    return res.data.strippedFromCards;
  } catch (e) {
    if ((e as { code?: unknown }).code === 'functions/not-found') return 0;
    throw e;
  }
}
