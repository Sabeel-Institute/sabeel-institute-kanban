/**
 * Narrowing a list of people by what was typed: ONE matcher for every place
 * the app picks a person — adding someone to a board, assigning a card,
 * Search's "Assigned to" filter and the @mention list.
 *
 * Each of those used to match its own way. The mention list had learnt not to
 * match the shared email domain (every address ends `@oursabeel.com`, so typing
 * "o" or "s" matched everybody) and to put a match at the start of a name
 * first; the others still matched the whole address, and adding someone could
 * not be narrowed at all. Typing the same letters now finds the same people in
 * the same order everywhere.
 */

/**
 * The handle shown in text. Derived from the email local part rather than the
 * display name, because names collide and contain spaces, and because everyone
 * already knows their own address.
 */
export function handleFor(email: string): string {
  const at = email.indexOf('@');
  return (at === -1 ? email : email.slice(0, at)).toLowerCase();
}

/** Anything with a name; an address, when the picker has one. */
export interface PersonLike {
  displayName: string;
  /**
   * Matched by its HANDLE only, never the domain. Absent where a picker holds
   * names alone (the add-someone list is sent no addresses).
   */
  email?: string;
}

/** Case and accents fold away: "jose" finds José. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * How well one person matches: 0 = not at all, then higher is better. Every
 * word typed must appear in the name or the handle ("sara k" finds Sara Khan,
 * and so does "khan sara"); among those, the name or handle STARTING with what
 * was typed comes first, then a later word of the name starting with it (a
 * surname), then a match anywhere.
 */
function score(words: readonly string[], whole: string, p: PersonLike): number {
  const name = fold(p.displayName);
  const handle = p.email ? fold(handleFor(p.email)) : '';
  if (!words.every((w) => name.includes(w) || handle.includes(w))) return 0;
  if (name.startsWith(whole) || (handle && handle.startsWith(whole))) return 3;
  if (name.split(/\s+/).some((part) => part.startsWith(words[0]))) return 2;
  return 1;
}

/**
 * The people who match `query`, best first, ties by name. An empty query keeps
 * everyone, by name. `first` floats some people above the rest (the mention
 * list puts those already on the card there); it only REORDERS — nobody who
 * does not match comes back for being in it.
 */
export function matchPeople<T extends PersonLike>(
  query: string,
  people: readonly T[],
  opts: { first?: (person: T) => boolean } = {},
): T[] {
  const whole = fold(query.trim());
  const words = whole.split(/\s+/).filter(Boolean);
  const ranked = people
    .map((p) => ({ p, s: words.length === 0 ? 1 : score(words, whole, p) }))
    .filter((r) => r.s > 0);
  const first = opts.first;
  return ranked
    .sort((a, b) => {
      if (first) {
        const af = first(a.p);
        const bf = first(b.p);
        if (af !== bf) return af ? -1 : 1;
      }
      if (a.s !== b.s) return b.s - a.s;
      return a.p.displayName.localeCompare(b.p.displayName);
    })
    .map((r) => r.p);
}

/** The words every person picker uses, so the four read as one control. */
export const PEOPLE_FILTER_LABEL = 'Filter people';
export const NO_PEOPLE_MATCH = 'No one matches.';
