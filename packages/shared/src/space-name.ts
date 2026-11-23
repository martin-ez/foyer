/** The most characters a space's name can have, counted as Unicode code points. */
export const spaceNameLimit = 120;

/** Why a space can't have this name, as a sentence, or null if it can. Expects the name trimmed:
 *  names are stored without spaces at their start and end. */
export function spaceNameProblem(name: string): string | null {
  if (name === "") return "A space's name can't be blank.";
  if (codePoints(name).length > spaceNameLimit) {
    return `A space's name can't be longer than ${spaceNameLimit} characters.`;
  }
  return null;
}

/** The first of `names` that clashes with `name`, ignoring case, if any. */
export function clashingName(name: string, names: Iterable<string>): string | undefined {
  const folded = name.toLowerCase();
  for (const each of names) if (each.toLowerCase() === folded) return each;
  return undefined;
}

/** Why a space can't be renamed to `name`, as a sentence, because one of `others`, the other spaces
 *  the person renaming it sees, has that name, ignoring case, or null if none does. An archived
 *  space's name still counts, and the sentence says it's archived. */
export function nameClashProblem(
  name: string,
  others: Iterable<{ name: string; archived: boolean }>,
): string | null {
  const clashes = Array.from(others).filter(
    (other) => clashingName(name, [other.name]) !== undefined,
  );
  const shown = clashes.find(({ archived }) => !archived);
  if (shown) return `Another space you see is called “${shown.name}”.`;
  const archived = clashes[0];
  return archived ? `An archived space is called “${archived.name}”.` : null;
}

/** `name` if none of `names` clashes with it, or else the first of "name 2", "name 3" and so on
 *  that none clashes with. A name that would grow past the limit is shortened before its number. */
export function freeSpaceName(name: string, names: Iterable<string>): string {
  const taken = new Set(Array.from(names, (each) => each.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let number = 2; ; number++) {
    const suffix = ` ${number}`;
    const numbered = `${limitSpaceName(name, spaceNameLimit - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(numbered.toLowerCase())) return numbered;
  }
}

/** The start of `name`, cut to at most `limit` characters, counted as code points. */
export function limitSpaceName(name: string, limit = spaceNameLimit): string {
  const points = codePoints(name);
  return points.length > limit ? points.slice(0, limit).join("") : name;
}

function codePoints(text: string): string[] {
  return Array.from(text);
}
