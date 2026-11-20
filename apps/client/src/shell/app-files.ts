/** What to do about an app file that didn't load: reload to get the current files, say the
 *  device is offline, or say the file is still missing after reloading for it. */
export type FailedFileCheck = "reload" | "offline" | "missing";

/** Always null on the iPad, whose app carries all its files in one bundle. The web app loads
 *  each view's file when it's first opened, and a deploy can replace it meanwhile. */
export function fileThatFailedToLoad(_error: unknown): string | null {
  return null;
}

/** Never needed on the iPad, where no file fails to load. */
export async function checkFailedFile(_file: string): Promise<FailedFileCheck> {
  return "missing";
}

/** Never needed on the iPad, where no file fails to load. */
export function reloadForFile(_file: string): boolean {
  return false;
}

/** Never needed on the iPad, where no file fails to load. */
export function reloadApp(): void {}
