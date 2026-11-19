import { useCallback, useMemo, useState } from 'react';
import type { Card } from './cards';

/**
 * Card multi-selection, shared by the web and mobile boards so the two surfaces
 * cannot drift apart on what "selected" means.
 *
 * The interaction differs by platform (checkbox and shift-click on web,
 * long-press to enter selection mode on a phone) but the STATE is identical, and
 * so is every bulk action performed on it.
 */
export function useSelection(allCards: readonly Card[]) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  /** The last card touched, so shift-click knows where a range starts. */
  const [anchor, setAnchor] = useState<string | null>(null);

  const clear = useCallback(() => {
    setIds(new Set());
    setAnchor(null);
  }, []);

  const toggle = useCallback((cardId: string) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
    setAnchor(cardId);
  }, []);

  /**
   * Select every card between the anchor and this one, within the SAME column.
   * A range spanning columns would be ambiguous — the visual order between two
   * columns is not a sequence — so it degrades to a plain toggle.
   */
  const selectRangeTo = useCallback(
    (cardId: string, columnCards: readonly Card[]) => {
      if (!anchor) {
        toggle(cardId);
        return;
      }
      const from = columnCards.findIndex((c) => c.id === anchor);
      const to = columnCards.findIndex((c) => c.id === cardId);
      if (from === -1 || to === -1) {
        toggle(cardId);
        return;
      }
      const [lo, hi] = from < to ? [from, to] : [to, from];
      setIds((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(columnCards[i].id);
        return next;
      });
    },
    [anchor, toggle],
  );

  /** Unselect these cards, if selected: a lane folding away hides them (#115). */
  const deselect = useCallback((cardIds: readonly string[]) => {
    if (cardIds.length === 0) return;
    setIds((prev) => {
      if (!cardIds.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of cardIds) next.delete(id);
      return next;
    });
  }, []);

  const selectAllIn = useCallback((columnCards: readonly Card[]) => {
    setIds((prev) => {
      const next = new Set(prev);
      for (const c of columnCards) next.add(c.id);
      return next;
    });
  }, []);

  const selected = useMemo(
    () => allCards.filter((c) => ids.has(c.id)),
    [allCards, ids],
  );

  return {
    /** True once anything is selected — the phone uses this as "selection mode". */
    active: ids.size > 0,
    count: ids.size,
    ids,
    selected,
    isSelected: useCallback((cardId: string) => ids.has(cardId), [ids]),
    toggle,
    selectRangeTo,
    selectAllIn,
    deselect,
    clear,
  };
}

export type Selection = ReturnType<typeof useSelection>;
