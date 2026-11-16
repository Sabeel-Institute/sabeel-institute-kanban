import { describe, expect, it } from 'vitest';
import {
  BOARD_FIELDS_MAX,
  addField,
  addableFieldTypes,
  filledFields,
  namedFieldValue,
  renameField,
  safeLink,
  validateDetailValue,
  validateFieldName,
  type BoardField,
} from '../src';

const fields: BoardField[] = [
  { id: 'f1', name: 'Teachers', type: 'text' },
  { id: 'f2', name: 'Start date', type: 'start' },
];

describe('adding a field', () => {
  it('adds a named field at the end, under a new id', () => {
    const r = addField(fields, 'link', ' Zoom link ');
    expect(r.ok && r.fields.map((f) => [f.name, f.type])).toEqual([
      ['Teachers', 'text'],
      ['Start date', 'start'],
      ['Zoom link', 'link'],
    ]);
    expect(r.ok && r.fields[2].id).toMatch(/^fld_/);
  });

  it('gives Start date and End date their own names, whatever was typed', () => {
    const r = addField([], 'end', 'ignored');
    expect(r.ok && r.fields[0]).toMatchObject({ name: 'End date', type: 'end' });
  });

  it('allows one Start date and one End date, and offers neither once there', () => {
    expect(addField(fields, 'start', '')).toEqual({
      ok: false,
      error: 'The board already has a Start date.',
    });
    expect(addableFieldTypes(fields)).toEqual(['text', 'number', 'date', 'link', 'end']);
  });

  it('refuses a field someone named Start date by hand', () => {
    const hand: BoardField[] = [{ id: 'x', name: 'start date', type: 'text' }];
    expect(addField(hand, 'start', '')).toEqual({
      ok: false,
      error: 'There is already a field with that name.',
    });
  });

  it('refuses a blank, an over-long or a duplicate name', () => {
    expect(validateFieldName(' ', fields)).toBe('Give the field a name.');
    expect(validateFieldName('x'.repeat(41), fields)).toMatch(/under 40/);
    expect(addField(fields, 'text', 'teachers')).toEqual({
      ok: false,
      error: 'There is already a field with that name.',
    });
  });

  it('refuses a field past the most a board may have', () => {
    const many = Array.from({ length: BOARD_FIELDS_MAX }, (_, i) => ({
      id: `f${i}`,
      name: `F${i}`,
      type: 'text' as const,
    }));
    expect(addField(many, 'text', 'One more')).toEqual({
      ok: false,
      error: 'A board can have at most 20 details.',
    });
  });
});

describe('renaming a field', () => {
  it('renames, allowing a change of capitals to itself', () => {
    const r = renameField(fields, 'f1', 'TEACHERS');
    expect(r.ok && r.fields[0].name).toBe('TEACHERS');
  });

  it('leaves Start date and End date their names', () => {
    expect(renameField(fields, 'f2', 'Begins')).toEqual({
      ok: false,
      error: 'Start date keeps its name.',
    });
  });
});

describe('a value', () => {
  it('clears when empty, whatever the type', () => {
    for (const t of ['text', 'number', 'date', 'link', 'start', 'end'] as const) {
      expect(validateDetailValue(t, '   ')).toEqual({ ok: true, value: null });
    }
  });

  it('keeps text as typed, trimmed, up to its limit', () => {
    expect(validateDetailValue('text', ' Sara, Omar ')).toEqual({ ok: true, value: 'Sara, Omar' });
    expect(validateDetailValue('text', 'x'.repeat(501)).ok).toBe(false);
  });

  it('takes a number with or without commas, and nothing else', () => {
    expect(validateDetailValue('number', '1,200')).toEqual({ ok: true, value: '1200' });
    expect(validateDetailValue('number', '-7.5')).toEqual({ ok: true, value: '-7.5' });
    expect(validateDetailValue('number', '120 dollars').ok).toBe(false);
  });

  it('takes only a real date', () => {
    expect(validateDetailValue('start', '2027-06-01')).toEqual({ ok: true, value: '2027-06-01' });
    expect(validateDetailValue('date', '2027-02-30').ok).toBe(false);
    expect(validateDetailValue('end', 'June 1').ok).toBe(false);
  });

  it('takes a link only when it is http or https', () => {
    expect(validateDetailValue('link', 'https://zoom.example/j/1')).toEqual({
      ok: true,
      value: 'https://zoom.example/j/1',
    });
    expect(validateDetailValue('link', 'javascript:alert(1)').ok).toBe(false);
    expect(validateDetailValue('link', 'zoom.example/j/1').ok).toBe(false);
  });
});

describe('safeLink', () => {
  it('opens http and https and nothing else, whoever wrote the value', () => {
    expect(safeLink('http://example.org')).toBe('http://example.org');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('data:text/html,hi')).toBeNull();
    expect(safeLink('https://exa mple.org')).toBeNull();
    expect(safeLink(undefined)).toBeNull();
  });
});

describe('what other screens read', () => {
  const board = {
    fields: [...fields, { id: 'f3', name: 'End date', type: 'end' as const }],
    details: { f1: 'Sara', f2: '2027-06-01', f3: 'soon' },
  };

  it('reads Start date and End date, and only when they are real dates', () => {
    expect(namedFieldValue(board, 'start')).toBe('2027-06-01');
    expect(namedFieldValue(board, 'end')).toBeNull();
    expect(namedFieldValue({}, 'start')).toBeNull();
  });

  it('counts the fields filled in', () => {
    expect(filledFields(board.fields, board.details)).toBe(3);
    expect(filledFields(board.fields, {})).toBe(0);
    expect(filledFields(board.fields, undefined)).toBe(0);
  });
});

describe('the fixed names', () => {
  it('are kept for Start date and End date, in any capitals', () => {
    expect(addField([], 'text', 'Start date')).toMatchObject({ ok: false });
    expect(addField([], 'date', 'end DATE')).toMatchObject({ ok: false });
    const withText = addField([], 'text', 'Teachers');
    if (!withText.ok) throw new Error('setup');
    expect(renameField(withText.fields, withText.fields[0].id, 'End date')).toMatchObject({ ok: false });
  });

  it('still let the real Start date and End date be added', () => {
    const start = addField([], 'start', '');
    expect(start.ok).toBe(true);
    if (!start.ok) throw new Error('setup');
    expect(addField(start.fields, 'end', '')).toMatchObject({ ok: true });
  });
});

describe('a number', () => {
  it('takes commas between groups of three only', () => {
    expect(validateDetailValue('number', '1,200')).toEqual({ ok: true, value: '1200' });
    expect(validateDetailValue('number', '1,200,000.50')).toEqual({ ok: true, value: '1200000.50' });
    expect(validateDetailValue('number', '-3,500')).toEqual({ ok: true, value: '-3500' });
    expect(validateDetailValue('number', '7,5')).toMatchObject({ ok: false });
    expect(validateDetailValue('number', '1,2,3')).toMatchObject({ ok: false });
    expect(validateDetailValue('number', '12,00')).toMatchObject({ ok: false });
  });
});
