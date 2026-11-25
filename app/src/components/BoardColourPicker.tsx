import type { BoardColor } from '@sabeel/shared';
import { BoardColourSheet } from './BoardColour';

/**
 * Where a board's colour is picked — NATIVE side of the seam (web sibling:
 * BoardColourPicker.web.tsx). A phone or a tablet takes a dialog: there is no
 * pointer to float a popover beside.
 */
export function BoardColourPicker({
  boardName,
  value,
  onPick,
  onClose,
}: {
  boardName: string;
  value: BoardColor | undefined;
  /** The stripe it was opened from; only the web's popover uses it. */
  anchor: unknown;
  onPick: (color: BoardColor | null) => void;
  onClose: () => void;
}) {
  return <BoardColourSheet boardName={boardName} value={value} onPick={onPick} onClose={onClose} />;
}
