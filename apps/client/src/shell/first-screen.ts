import { useSyncExternalStore } from "react";
import { readStoredFirstScreen, storeFirstScreen } from "./first-screen-store";

/** What Foyer opens on when it starts on a device. */
export type FirstScreen = "day-page" | "today-list" | "overview";

/** The first screens a device can choose, in the order they're offered, with their names. */
export const firstScreens: readonly { screen: FirstScreen; name: string }[] = [
  { screen: "day-page", name: "Today's day page" },
  { screen: "today-list", name: "Today list" },
  { screen: "overview", name: "Overview" },
];

/** The first screen a stored value names, or today's day page for anything else. */
export function firstScreenOf(stored: string | null): FirstScreen {
  return firstScreens.find(({ screen }) => screen === stored)?.screen ?? "day-page";
}

/** Where a first screen is: the route to open, and what its address says beyond it. */
export function firstScreenHref(screen: FirstScreen): {
  pathname: "/calendar" | "/tasks" | "/overview";
  params: Record<string, string>;
} {
  switch (screen) {
    case "day-page":
      return { pathname: "/calendar", params: {} };
    case "today-list":
      return { pathname: "/tasks", params: { show: "today" } };
    case "overview":
      return { pathname: "/overview", params: {} };
  }
}

const listeners = new Set<() => void>();
let chosen: FirstScreen | undefined;

/** The first screen chosen on this device. */
export function readFirstScreen(): FirstScreen {
  chosen ??= firstScreenOf(readStoredFirstScreen());
  return chosen;
}

/** The first screen chosen on this device, and a way to choose another, which Foyer opens on from
 *  its next start. */
export function useFirstScreen(): [FirstScreen, (screen: FirstScreen) => void] {
  const screen = useSyncExternalStore(subscribe, readFirstScreen, readFirstScreen);
  return [screen, chooseFirstScreen];
}

/** Chooses what Foyer opens on from its next start on this device. */
export function chooseFirstScreen(screen: FirstScreen): void {
  chosen = screen;
  storeFirstScreen(screen);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
