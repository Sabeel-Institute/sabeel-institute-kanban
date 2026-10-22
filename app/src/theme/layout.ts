import { Platform, useWindowDimensions } from 'react-native';

/**
 * Layout decisions are driven by AVAILABLE WIDTH, not by platform.
 *
 * This was originally got wrong: the board was split into a web component and a
 * native component, which meant a tablet running the Android app got the phone's
 * swipe layout despite having room for four columns, and a phone browser got the
 * desktop drag board on a 380px screen. "Android" is not a synonym for "small",
 * and "web" is not a synonym for "large".
 *
 * Platform still decides one thing — whether HTML5 drag-and-drop exists — but
 * that is a CAPABILITY, layered on top of a layout chosen by width.
 */

/**
 * 700px.
 *
 * The wide board scrolls horizontally, so it needs room for TWO columns to be
 * useful, not all of them: 2 x 300px + gutter + screen padding is about 648.
 *
 * Chosen against real device profiles rather than by feel (see
 * scripts/device-shots.mjs). The binding case is the Galaxy Tab S4 at 712px
 * portrait — a 10.5" tablet, which at a 768 breakpoint fell to the phone's
 * one-column layout despite easily fitting two. The largest phone in the set is
 * the iPhone 14 Pro Max at 430px, so there is a wide margin before any handset
 * could reach this.
 */
const WIDE_BREAKPOINT = 700;

/** Where a single column of forms and lists stops being comfortable to read. */
export const CONTENT_MAX_WIDTH = 840;

/**
 * A narrow column for text and forms (card detail, settings, sign-in). Long
 * lines are tiring to read, and a form field or button stretched across a
 * desktop looks like a phone screen someone pulled sideways. ~68 characters.
 */
export const READ_MAX_WIDTH = 640;

/**
 * The cap for card GRIDS (boards, search, my work). Wide enough to lay several
 * cards across a laptop or desktop, capped so an ultra-wide monitor does not
 * stretch the grid into one enormous row.
 */
export const LIST_MAX_WIDTH = 1160;

/** Target width of one card in a responsive grid; the grid fits as many as it can. */
export const GRID_CARD_MIN_WIDTH = 250;

export interface Layout {
  width: number;
  height: number;
  /** Enough room for a multi-column board: desktop, or a tablet in landscape. */
  isWide: boolean;
  /** One column at a time: phones, and narrow browser windows. */
  isCompact: boolean;
  /**
   * Whether HTML5 drag-and-drop is available. True only on the web — React
   * Native has no equivalent, so a wide NATIVE board (a tablet) offers the same
   * explicit "Move to…" affordance the phone uses.
   */
  canDragAndDrop: boolean;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  return {
    width,
    height,
    isWide,
    isCompact: !isWide,
    canDragAndDrop: Platform.OS === 'web',
  };
}
