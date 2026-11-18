const key = "calendar-space";

/** The space last picked for something added from the calendar, which the browser keeps for this
 *  device, or null when none was picked or the browser keeps nothing. */
export async function readLastSpace(): Promise<string | null> {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Keeps the space last picked for something added from the calendar in this browser. */
export async function keepLastSpace(spaceId: string): Promise<void> {
  try {
    localStorage.setItem(key, spaceId);
  } catch {}
}
