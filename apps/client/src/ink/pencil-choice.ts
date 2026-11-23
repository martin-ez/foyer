import { useSyncExternalStore } from "react";
import type { PencilTool } from "../../modules/foyer-ink";

/** The inks the Pencil writes in, by name. */
export const inkColours = [
  { name: "Black", colour: 0x1a1a1a },
  { name: "Blue", colour: 0x2255aa },
  { name: "Red", colour: 0xb0302a },
] as const;

/** What the Pencil does on every page, and whether the mouse draws instead, in the simulator. */
export type PencilChoice = { tool: PencilTool; colour: number; mouseDraws: boolean };

let current: PencilChoice = { tool: "pen", colour: inkColours[0].colour, mouseDraws: false };
const listeners = new Set<() => void>();

/** What the Pencil does, kept while the app runs, and a way to change it. */
export function usePencilChoice(): [PencilChoice, (change: Partial<PencilChoice>) => void] {
  return [useSyncExternalStore(subscribe, () => current), choose];
}

function choose(change: Partial<PencilChoice>): void {
  current = { ...current, ...change };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
