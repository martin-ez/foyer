import { createContext, useContext } from "react";

/** How many screen points one point of the open page takes now, as it's zoomed. `PageSheet` gives
 *  it to the views on its page, as a function so that zooming doesn't redraw them. */
export const PageScale = createContext<() => number>(() => 1);

/** How many screen points one point of the page takes now. */
export function usePageScale(): () => number {
  return useContext(PageScale);
}
