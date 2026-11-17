import { useEffect } from "react";
import { AppState } from "react-native";
import type { LiveLane } from "./live-lane";

/** Puts this device on a page on the live lane while the page is shown and the app is in the
 *  foreground. It leaves the page once whatever is shown next has entered its own, so moving
 *  between pages sends one message, and a page hidden after another was shown leaves nothing. */
export function useLivePage(live: LiveLane, pageId: string): void {
  useEffect(() => {
    live.enter(pageId);
    return () => queueMicrotask(() => live.leave(pageId));
  }, [live, pageId]);
  useEffect(() => {
    live.setActive(AppState.currentState !== "background");
    const subscription = AppState.addEventListener("change", (state) => {
      live.setActive(state !== "background");
    });
    return () => subscription.remove();
  }, [live]);
}
