import { useEffect, useState } from "react";
import { setTestHooks } from "./test-hooks";

/** Draws nothing until a check calls `foyerTest.throwInOpenView()`, then throws, as a bug in the
 *  open view would. Put it beside the open view. Null in production builds, which leave it out. */
export const ThrowWhenAsked = __DEV__ ? Thrower : null;

function Thrower() {
  const [asked, setAsked] = useState(false);

  useEffect(() => setTestHooks({ throwInOpenView: () => setAsked(true) }), []);

  if (asked) throw new Error("A check asked the open view to throw.");
  return null;
}
