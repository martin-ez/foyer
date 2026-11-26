const key = "first-screen";

/** The first screen chosen in this browser, or null when none was chosen or the browser keeps
 *  nothing. */
export function readStoredFirstScreen(): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Keeps the first screen chosen in this browser. */
export function storeFirstScreen(screen: string): void {
  try {
    localStorage.setItem(key, screen);
  } catch {}
}
