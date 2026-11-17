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
  const points = Array.from(title);
  return points.length > itemTitleLimit ? points.slice(0, itemTitleLimit).join("") : title;
}
