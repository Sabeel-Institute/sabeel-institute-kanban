import { isBoardColor, type BoardColor } from './boardColors';
import { FIELD_TYPES } from './boardFields';
import type { BoardField, BoardLane } from './types';

/**
 * A board's lanes, fields and values as read, with anything not in the shape
 * the app writes left out.
 *
 * The rules bound these lists and cannot look inside them, so their contents
 * are the app's to keep (CLAUDE.md, "Contents are app-kept"). A board's owners
 * are trusted, but a malformed entry from any client would otherwise reach
 * every reader: the overview of every admin, which lists every board, would
 * throw on a lane with no name, and so would the history trigger on every
 * write to that board. So every reader takes the board through here: the app's
 * `toBoard` and each function that reads a board.
 */
export interface BoardExtras {
  lanesOn: boolean;
  lanes: BoardLane[];
  doneColumnId?: string;
  fields: BoardField[];
  details: Record<string, string>;
  /** Left out when it is not one this build knows: a newer build's colour draws as none. */
  color?: BoardColor;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * A lane with a string id and a name that is not blank (the app never writes
 * one, and a blank name has nothing to measure or show). Kept as stored, any
 * other property included: the lists are written back whole, and a property
 * a later build adds must survive this one's writes.
 */
export function cleanLanes(raw: unknown): BoardLane[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (l): l is BoardLane =>
      isObject(l) && typeof l.id === 'string' && typeof l.name === 'string' && l.name.trim() !== '',
  );
}

/**
 * A field of a type this build knows, kept as stored. A field of a type it
 * does not know is left out, and its value goes with the next write of the
 * fields: a new type needs the version floor raised with it, so no build
 * that would do that is still in use.
 */
export function cleanFields(raw: unknown): BoardField[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is BoardField =>
      isObject(f) &&
      typeof f.id === 'string' &&
      typeof f.name === 'string' &&
      (FIELD_TYPES as readonly unknown[]).includes(f.type),
  );
}

export function cleanDetails(raw: unknown): Record<string, string> {
  if (!isObject(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as Record<
    string,
    string
  >;
}

/** The lane, detail and colour parts of a board document, cleaned. */
export function boardExtras(data: Record<string, unknown>): BoardExtras {
  return {
    lanesOn: data.lanesOn === true,
    lanes: cleanLanes(data.lanes),
    ...(typeof data.doneColumnId === 'string' ? { doneColumnId: data.doneColumnId } : {}),
    fields: cleanFields(data.fields),
    details: cleanDetails(data.details),
    ...(isBoardColor(data.color) ? { color: data.color } : {}),
  };
}

/** A board document with its lane, detail and colour parts cleaned, for a reader on the server. */
export function withCleanExtras<T extends Record<string, unknown>>(data: T): T & BoardExtras {
  // `color` is optional, so a colour this build does not know is taken out,
  // not merely left unreplaced.
  const { color: _stored, ...rest } = data;
  return { ...rest, ...boardExtras(data) } as T & BoardExtras;
}
