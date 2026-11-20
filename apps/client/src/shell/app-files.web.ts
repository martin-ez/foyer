import type { FailedFileCheck } from "./app-files";

const reloadedForKey = "reloaded-for-file";

/** The address of the app's file that didn't load, when `error` is a failed load of one, such as
 *  a view's file that a deploy has replaced since this tab opened; otherwise null. */
export function fileThatFailedToLoad(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== "AsyncRequireError") return null;
  const file: unknown = Reflect.get(error, "request");
  return typeof file === "string" && file !== "" ? file : null;
}

/** Asks the server for a file that didn't load. If it answers, a reload gets the app's current
 *  files, unless this tab already reloaded for the same file and it's still missing. */
export async function checkFailedFile(file: string): Promise<FailedFileCheck> {
  const answered = await fetch(file, { method: "HEAD", cache: "no-store" }).then(
    () => true,
    () => false,
  );
  if (!answered) return "offline";
  return reloadedFor() === file ? "missing" : "reload";
}

/** Reloads the app for a file that didn't load, remembering it so the tab never reloads for it
 *  twice. Returns false, without reloading, when the browser can't remember it. */
export function reloadForFile(file: string): boolean {
  try {
    sessionStorage.setItem(reloadedForKey, file);
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Reloads the app, as the person asks. */
export function reloadApp(): void {
  window.location.reload();
}

function reloadedFor(): string | null {
  try {
    return sessionStorage.getItem(reloadedForKey);
  } catch {
    return null;
  }
}
