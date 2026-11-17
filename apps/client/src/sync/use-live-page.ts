import { useEffect } from "react";
import { AppState } from "react-native";
import type { LiveLane } from "./live-lane";

/** Puts this device on a page on the live lane while the page is shown and the app is in the
 *  foreground, and takes it off when the page closes or the app goes to the background. */
export function useLivePage(live: LiveLane, pageId: string): void {
  useEffect(() => live.enter(pageId), [live, pageId]);
  useEffect(() => () => live.leave(), [live]);
  useEffect(() => {
    live.setActive(AppState.currentState !== "background");
    const subscription = AppState.addEventListener("change", (state) => {
      live.setActive(state !== "background");
    });
    return () => subscription.remove();
  }, [live]);
}
