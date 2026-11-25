import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoardColor } from '@sabeel/shared';
import { getTheme, radius, space } from '../theme';
import { useLayout } from '../theme/layout';
import { BoardColourSheet, BoardColourSwatches } from './BoardColour';

/** Five 36-point swatches a row, `space.sm` apart, inside the padding and border. */
const WIDTH = 5 * 36 + 4 * space.sm + 2 * space.md + 2;

/**
 * Where a board's colour is picked — WEB side of the seam (native sibling:
 * BoardColourPicker.tsx).
 *
 * On a wide screen, a small popover at the stripe that was clicked: a
 * dialog over the whole page is a lot of ceremony for one click. It closes
 * on a pick, on Escape, or on a click anywhere else, and gives focus back to
 * the stripe. A narrow browser takes the same dialog a phone does.
 */
export function BoardColourPicker({
  boardName,
  value,
  anchor,
  onPick,
  onClose,
}: {
  boardName: string;
  value: BoardColor | undefined;
  anchor: unknown;
  onPick: (color: BoardColor | null) => void;
  onClose: () => void;
}) {
  const { isWide } = useLayout();
  if (!isWide || !(anchor instanceof HTMLElement)) {
    return <BoardColourSheet boardName={boardName} value={value} onPick={onPick} onClose={onClose} />;
  }
  return <Popover boardName={boardName} value={value} anchor={anchor} onPick={onPick} onClose={onClose} />;
}

function Popover({
  boardName,
  value,
  anchor,
  onPick,
  onClose,
}: {
  boardName: string;
  value: BoardColor | undefined;
  anchor: HTMLElement;
  onPick: (color: BoardColor | null) => void;
  onClose: () => void;
}) {
  const t = getTheme();
  const box = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Under the card the stripe edges, so the board's name stays in sight (over
  // it, the popover hid which board it was colouring), or above it where the
  // page has no room below. Kept on screen, and following the stripe through
  // a scroll or a resize rather than being left where it was.
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = box.current?.offsetHeight ?? 0;
      const below = r.bottom + space.xs;
      const top = below + h + space.md <= window.innerHeight ? below : r.top - h - space.xs;
      setAt({
        left: Math.max(space.md, Math.min(r.left, window.innerWidth - WIDTH - space.md)),
        top: Math.max(space.md, top),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      // Tab goes round the swatches, as in any dialog, rather than out to the
      // end of the page, where the popover has been put.
      if (e.key === 'Tab' && box.current) {
        const stops = [...box.current.querySelectorAll<HTMLElement>('[role="button"], button')];
        if (stops.length === 0) return;
        const at = stops.indexOf(document.activeElement as HTMLElement);
        const next = (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length;
        e.preventDefault();
        stops[at === -1 ? (e.shiftKey ? stops.length - 1 : 0) : next].focus();
      }
    };
    // A press outside, not a click: the stripe's own click would otherwise
    // close the popover it opened, and a press on another stripe opens that
    // board's in its place.
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        close.current();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      if (anchor.isConnected) anchor.focus();
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={`Colour of ${boardName}`}
      style={{
        position: 'fixed',
        left: at?.left ?? -9999,
        top: at?.top ?? -9999,
        zIndex: 50,
        width: WIDTH,
        boxSizing: 'border-box',
        background: t.bg.raised,
        border: `1px solid ${t.border.strong}`,
        borderRadius: radius.lg,
        boxShadow: `0 10px 30px ${t.effect.shadow}`,
        padding: space.md,
      }}
    >
      <BoardColourSwatches value={value} onPick={onPick} size={36} />
    </div>,
    document.body,
  );
}
