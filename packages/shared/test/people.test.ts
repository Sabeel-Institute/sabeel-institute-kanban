import { describe, expect, it } from 'vitest';
import { handleFor, matchPeople } from '../src/people';

const people = [
  { uid: 'u1', displayName: 'Sara Ahmed', email: 'sara@oursabeel.com' },
  { uid: 'u2', displayName: 'Faisal Shah', email: 'faisal@oursabeel.com' },
  { uid: 'u3', displayName: 'Sarah Khan', email: 'skhan@oursabeel.com' },
  { uid: 'u4', displayName: 'Omar Haddad', email: 'omar@oursabeel.com' },
  { uid: 'u5', displayName: 'José Núñez', email: 'jnunez@oursabeel.com' },
];
const ids = (list: readonly { uid: string }[]) => list.map((p) => p.uid);

describe('matchPeople', () => {
  it('keeps everyone, by name, for an empty query', () => {
    expect(ids(matchPeople('  ', people))).toEqual(['u2', 'u5', 'u4', 'u1', 'u3']);
  });

  it('never matches the shared email domain', () => {
    // Matching the whole address made every letter of the domain match
    // everybody, which is what the assignee and Search pickers still did.
    for (const q of ['oursabeel', 'sabeel.com', '.com', '@']) {
      expect(matchPeople(q, people), q).toEqual([]);
    }
  });

  it("matches the handle, the address's local part", () => {
    expect(ids(matchPeople('skhan', people))).toEqual(['u3']);
  });

  it('matches by name alone where a picker has no addresses', () => {
    const names = people.map(({ uid, displayName }) => ({ uid, displayName }));
    expect(ids(matchPeople('haddad', names))).toEqual(['u4']);
  });

  it('needs every word typed, in any order', () => {
    expect(ids(matchPeople('sara k', people))).toEqual(['u3']);
    expect(ids(matchPeople('khan sara', people))).toEqual(['u3']);
    expect(matchPeople('sara omar', people)).toEqual([]);
  });

  it('folds case and accents', () => {
    expect(ids(matchPeople('JOSE nunez', people))).toEqual(['u5']);
  });

  it('puts a match at the start first, then a surname, then anywhere', () => {
    // "sha": Faisal SHAh (a surname starts with it) above nothing else;
    // "a": every name holds an a, but the start of a name wins.
    expect(ids(matchPeople('sh', people))).toEqual(['u2']);
    expect(ids(matchPeople('ha', people))).toEqual(['u4', 'u2', 'u3']);
  });

  it('floats `first` up without bringing back a non-match', () => {
    const first = (p: { uid: string }) => p.uid === 'u4' || p.uid === 'u2';
    expect(ids(matchPeople('sa', people, { first }))).toEqual(['u2', 'u1', 'u3']);
  });
});

describe('handleFor', () => {
  it('is the lower-cased local part', () => {
    expect(handleFor('Sara.Ahmed@oursabeel.com')).toBe('sara.ahmed');
    expect(handleFor('nodomain')).toBe('nodomain');
  });
});
