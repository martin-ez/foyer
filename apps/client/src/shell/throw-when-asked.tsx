import { useEffect, useState } from "react";

declare global {
  /** Hooks that checks call in development builds, reached in the web app as `window.foyerTest`. */
  var foyerTest: { throwInOpenView?: () => void } | undefined;
}

/** Draws nothing until a check calls `foyerTest.throwInOpenView()`, then throws, as a bug in the
 *  open view would. Put it beside the open view. Null in production builds, which leave it out. */
export const ThrowWhenAsked = __DEV__ ? Thrower : null;

function Thrower() {
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    globalThis.foyerTest ??= {};
    const hooks = globalThis.foyerTest;
    hooks.throwInOpenView = () => setAsked(true);
    return () => {
      hooks.throwInOpenView = undefined;
    };
  }, []);

  if (asked) throw new Error("A check asked the open view to throw.");
  return null;
}
