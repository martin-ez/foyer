import type { Scene } from "../page/scene";

/** What checks can call in development builds. Production builds have none of it. */
export type TestHooks = {
  /** Makes the open destination throw while it's drawn, as a bug in it would. */
  throwInOpenView?: () => void;
  /** What's on the open page. */
  scene?: () => Scene;
  /** Adds a stroke fixture's strokes to the open page, as if a pen had drawn them just now, and
   *  returns their new ids. */
  addStrokes?: (fixture: unknown) => string[];
};

declare global {
  /** The hooks checks call in development builds, reached in the web app as `window.foyerTest`. */
  var foyerTest: TestHooks | undefined;
}

/** Sets hooks for checks until the returned function is called, which takes away only those still
 *  set by this call. */
export function setTestHooks(hooks: TestHooks): () => void {
  globalThis.foyerTest ??= {};
  const set = globalThis.foyerTest;
  Object.assign(set, hooks);
  return () => {
    for (const [name, hook] of Object.entries(hooks) as [keyof TestHooks, unknown][]) {
      if (set[name] === hook) set[name] = undefined;
    }
  };
}
