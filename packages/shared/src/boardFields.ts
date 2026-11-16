import { localId } from './boards';
import type { BoardField, BoardFieldType } from './types';

/**
 * A board's details: a short list of typed fields, such as a start date, the
 * teachers or a meeting link (Faisal, 2026-11-15). Everyone on the board reads
 * them; its owners and admins change them.
 *
 * Rules can bound the list and the map but cannot look inside either, so
 * every shape here (a name's length, a date being a date, a link being http)
 * is the app's to keep, as a board's own labels are. Only the board's owners
 * and admins can write a board, which is what makes that acceptable.
 */

/** At most twenty fields on a board. Restated in firestore.rules. */
export const BOARD_FIELDS_MAX = 20;
export const BOARD_FIELD_NAME_MAX = 40;
export const DETAIL_VALUE_MAX = 500;
/** A link may be longer than any other value: real meeting links are. */
export const DETAIL_LINK_MAX = 2000;

/** In the order a new field's type is offered. */
export const FIELD_TYPES: readonly BoardFieldType[] = ['text', 'number', 'date', 'link', 'start', 'end'];

export const FIELD_TYPE_LABELS: Record<BoardFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  link: 'Link',
  start: 'Start date',
  end: 'End date',
};

const NAMED_TYPES = ['start', 'end'] as const;

/** Start date and End date: one of each at most, under these names always. */
export function isNamedType(type: BoardFieldType): type is 'start' | 'end' {
  return (NAMED_TYPES as readonly string[]).includes(type);
}

/** Whether values of this type are dates (`YYYY-MM-DD`). */
export function isDateType(type: BoardFieldType): boolean {
  return type === 'date' || isNamedType(type);
}

/** The types a new field may take now: Start date and End date only while the board has none. */
export function addableFieldTypes(fields: readonly BoardField[]): BoardFieldType[] {
  return FIELD_TYPES.filter((t) => !isNamedType(t) || !fields.some((f) => f.type === t));
}

/** Why another field cannot be added, or null. */
export function fieldAddBlocked(fields: readonly BoardField[]): string | null {
  return fields.length >= BOARD_FIELDS_MAX
    ? `A board can have at most ${BOARD_FIELDS_MAX} details.`
    : null;
}

/**
 * Why `name` cannot be a field's name, or null. Start date and End date are
 * the two names other screens read, so no field of another type may take
 * either: a Text field called "Start date" would read as the board's start
 * date to a person and to nobody else, and would stop the real one being added.
 */
export function validateFieldName(
  name: string,
  existing: readonly BoardField[],
  type?: BoardFieldType,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Give the field a name.';
  if (trimmed.length > BOARD_FIELD_NAME_MAX)
    return `Keep the field name under ${BOARD_FIELD_NAME_MAX} characters.`;
  const reserved = NAMED_TYPES.find(
    (t) => FIELD_TYPE_LABELS[t].toLowerCase() === trimmed.toLowerCase(),
  );
  if (reserved && reserved !== type)
    return `${FIELD_TYPE_LABELS[reserved]} is kept for the board's ${FIELD_TYPE_LABELS[reserved].toLowerCase()}: add it as that type.`;
  if (existing.some((f) => f.name.toLowerCase() === trimmed.toLowerCase()))
    return 'There is already a field with that name.';
  return null;
}

export type FieldResult = { ok: true; fields: BoardField[] } | { ok: false; error: string };

/**
 * The fields with a new one at the end, or why not. Start date and End date
 * take their own names and ignore `name`; every other type needs one.
 */
export function addField(
  fields: readonly BoardField[],
  type: BoardFieldType,
  name: string,
): FieldResult {
  const blocked = fieldAddBlocked(fields);
  if (blocked) return { ok: false, error: blocked };
  if (isNamedType(type)) {
    if (fields.some((f) => f.type === type))
      return { ok: false, error: `The board already has a ${FIELD_TYPE_LABELS[type]}.` };
    const fixed = FIELD_TYPE_LABELS[type];
    // A field someone named "Start date" by hand would read as a second one.
    const clash = validateFieldName(fixed, fields, type);
    if (clash) return { ok: false, error: clash };
    return { ok: true, fields: [...fields, { id: localId('fld'), name: fixed, type }] };
  }
  const problem = validateFieldName(name, fields, type);
  if (problem) return { ok: false, error: problem };
  return { ok: true, fields: [...fields, { id: localId('fld'), name: name.trim(), type }] };
}

/**
 * Rename one field, or explain why not. Start date and End date keep their
 * names; the field being renamed is left out of its own duplicate check.
 */
export function renameField(
  fields: readonly BoardField[],
  fieldId: string,
  rawName: string,
): FieldResult {
  const field = fields.find((f) => f.id === fieldId);
  if (field && isNamedType(field.type)) {
    return { ok: false, error: `${field.name} keeps its name.` };
  }
  const problem = validateFieldName(
    rawName,
    fields.filter((f) => f.id !== fieldId),
    field?.type,
  );
  if (problem) return { ok: false, error: problem };
  const trimmed = rawName.trim();
  return { ok: true, fields: fields.map((f) => (f.id === fieldId ? { ...f, name: trimmed } : f)) };
}

export type DetailResult = { ok: true; value: string | null } | { ok: false; error: string };

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** A link as typed, if it is one anything here may open: http or https, nothing else. */
export function safeLink(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // The scheme is the whole of the risk (`javascript:`, `data:`), and it is
  // pinned by the start of the pattern.
  return /^https?:\/\/[^\s/?#][^\s]*$/i.test(trimmed) ? trimmed : null;
}

/**
 * A value as stored, null to clear the field, or why it cannot be saved.
 * Empty clears. Numbers are kept as typed, less the commas between groups of
 * three; dates are
 * `YYYY-MM-DD` and real; a link must be http or https, which is also checked
 * again before one is opened (`safeLink`), since another client could have
 * written anything.
 */
export function validateDetailValue(type: BoardFieldType, raw: string): DetailResult {
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  switch (type) {
    case 'number': {
      // A comma only between groups of three, as in 1,200: "7,5" is a
      // decimal comma or a slip, and taking it out would save 75.
      if (!/^-?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/.test(value))
        return { ok: false, error: 'Enter a number, such as 1,200 or 7.5.' };
      return { ok: true, value: value.replace(/,/g, '') };
    }
    case 'date':
    case 'start':
    case 'end':
      return isRealDate(value) ? { ok: true, value } : { ok: false, error: 'Choose a date.' };
    case 'link':
      if (value.length > DETAIL_LINK_MAX)
        return { ok: false, error: `Keep the link under ${DETAIL_LINK_MAX} characters.` };
      return safeLink(value)
        ? { ok: true, value }
        : { ok: false, error: 'Enter a web address starting with http:// or https://.' };
    case 'text':
      return value.length > DETAIL_VALUE_MAX
        ? { ok: false, error: `Keep it under ${DETAIL_VALUE_MAX} characters.` }
        : { ok: true, value };
  }
}

/** How many fields have a value, for the settings list's summary. */
export function filledFields(
  fields: readonly BoardField[],
  details: Readonly<Record<string, string>> | undefined,
): number {
  return fields.filter((f) => (details?.[f.id] ?? '') !== '').length;
}

/**
 * A board's Start date or End date, the only details anything else reads (the
 * overview). Null when the board has no such field, no value, or a value that
 * is not a real date.
 */
export function namedFieldValue(
  board: { fields?: readonly BoardField[]; details?: Readonly<Record<string, string>> },
  type: 'start' | 'end',
): string | null {
  const field = board.fields?.find((f) => f.type === type);
  const value = field ? board.details?.[field.id] : undefined;
  return value && isRealDate(value) ? value : null;
}
