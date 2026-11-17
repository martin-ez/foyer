/** The most characters an item's title can have, counted as Unicode code points. */
export const itemTitleLimit = 500;

/** Why an item can't have this title, as a sentence, or null if it can. Expects the title trimmed:
 *  titles are stored without spaces at their start and end. */
export function itemTitleProblem(title: string): string | null {
  if (title === "") return "A task's title can't be blank.";
  if (Array.from(title).length > itemTitleLimit) {
    return `A task's title can't be longer than ${itemTitleLimit} characters.`;
  }
  return null;
}

/** The start of `title`, cut to at most `itemTitleLimit` characters, counted as code points. */
export function limitItemTitle(title: string): string {
  return limitText(title, itemTitleLimit);
}

/** The most characters an item's description can have, counted as Unicode code points. */
export const itemDescriptionLimit = 10_000;

/** Why an item can't have this description, as a sentence, or null if it can. */
export function itemDescriptionProblem(description: string): string | null {
  if (Array.from(description).length <= itemDescriptionLimit) return null;
  return "A task's description can't be longer than 10,000 characters.";
}

/** The start of `description`, cut to at most `itemDescriptionLimit` characters, counted as code
 *  points. */
export function limitItemDescription(description: string): string {
  return limitText(description, itemDescriptionLimit);
}

function limitText(text: string, limit: number): string {
  const points = Array.from(text);
  return points.length > limit ? points.slice(0, limit).join("") : text;
}
