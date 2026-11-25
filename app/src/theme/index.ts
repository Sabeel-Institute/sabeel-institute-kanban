/**
 * Semantic theme tokens. Every color in the app comes from here.
 *
 * SINGLE LIGHT THEME — no dark mode (decided 2026-07-21, docs/PRODUCT_BRIEF.md
 * "Theming"). `useTheme()` returns the one theme; it is a hook so a stored
 * preference or a second theme could be layered in here later without any screen
 * changing.
 *
 * Usage:
 *   const t = useTheme();
 *   <View style={{ backgroundColor: t.bg.surface }}>
 *
 * Names describe ROLE, not appearance — `text.muted`, never `text.grey`. That
 * keeps every reference honest and makes a future re-theme a one-file change.
 */
import { palette } from './palette';
import type { BoardColor, Priority } from '@sabeel/shared';

function build() {
  const p = palette;
  return {
    bg: {
      /** App background, behind everything. */
      canvas: p.canvas,
      /** Cards, sheets, list rows. */
      surface: p.surface,
      /** Surfaces that sit above other surfaces (menus, dragged card). */
      raised: p.raised,
      /** Recessed areas — text inputs, column bodies. */
      inset: p.inset,
      /** Tint behind selected/active items. */
      accentSoft: p.accentSoft,
      /** Tint behind destructive confirmation. */
      dangerSoft: p.dangerSoft,
    },
    text: {
      primary: p.textPrimary,
      secondary: p.textSecondary,
      /** Timestamps, counts, placeholder text. */
      muted: p.textMuted,
      /** Text on an accent-filled surface. */
      inverse: p.textInverse,
      accent: p.accent,
      danger: p.danger,
    },
    border: {
      subtle: p.borderSubtle,
      strong: p.borderStrong,
    },
    accent: {
      base: p.accent,
      hover: p.accentHover,
      onAccent: p.accentText,
    },
    feedback: {
      danger: p.danger,
      success: p.success,
      warning: p.warning,
    },
    /** Card priority dot. Keyed by the shared Priority union. */
    priority: {
      none: p.priorityNone,
      low: p.priorityLow,
      medium: p.priorityMedium,
      high: p.priorityHigh,
      urgent: p.priorityUrgent,
    } satisfies Record<Priority, string>,
    /** A board's stripe in the Boards list, by its stored key. Nowhere else. */
    board: {
      raspberry: p.boardRaspberry,
      green: p.boardGreen,
      blue: p.boardBlue,
      violet: p.boardViolet,
      orange: p.boardOrange,
      red: p.boardRed,
      gold: p.boardGold,
      taupe: p.boardTaupe,
    } satisfies Record<BoardColor, string>,
    /** Data visualisation. One bar colour — the chart shows one metric at a time. */
    chart: {
      bar: p.chartBar,
    },
    effect: {
      overlay: p.overlay,
      shadow: p.shadow,
    },
  } as const;
}

export type Theme = ReturnType<typeof build>;

const theme: Theme = build();

/**
 * The app theme. A hook by design: if a manual override or a second theme is
 * ever added, this is the single place it layers in and no screen needs
 * touching.
 */
export function useTheme(): Theme {
  return theme;
}

/** Non-hook access, for the rare module (or `.web` seam) that cannot use hooks. */
export function getTheme(): Theme {
  return theme;
}

/** Spacing scale, in points. Use these rather than ad-hoc numbers. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Type scale. */
export const type = {
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '500' },
  caption: { fontSize: 12, fontWeight: '400' },
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;
