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
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function cleanLanes(raw: unknown): BoardLane[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .filter((l) => typeof l.id === 'string' && typeof l.name === 'string')
    .map((l) => ({ id: l.id as string, name: l.name as string }));
}

export function cleanFields(raw: unknown): BoardField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .filter(
      (f) =>
        typeof f.id === 'string' &&
        typeof f.name === 'string' &&
        (FIELD_TYPES as readonly unknown[]).includes(f.type),
    )
    .map((f) => ({ id: f.id as string, name: f.name as string, type: f.type as BoardField['type'] }));
}

export function cleanDetails(raw: unknown): Record<string, string> {
  if (!isObject(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as Record<
    string,
    string
  >;
}

/** The lane and detail parts of a board document, cleaned. */
export function boardExtras(data: Record<string, unknown>): BoardExtras {
  return {
    lanesOn: data.lanesOn === true,
    lanes: cleanLanes(data.lanes),
    ...(typeof data.doneColumnId === 'string' ? { doneColumnId: data.doneColumnId } : {}),
    fields: cleanFields(data.fields),
    details: cleanDetails(data.details),
  };
}

/** A board document with its lane and detail parts cleaned, for a reader on the server. */
export function withCleanExtras<T extends Record<string, unknown>>(data: T): T & BoardExtras {
  return { ...data, ...boardExtras(data) };
}
