import type { UnsentChanges } from "./household-sync";

/** Nowhere on the iPad yet, which keeps its member's unsent changes in memory only. */
export function unsentChangesOf(_memberId: string): UnsentChanges | undefined {
  return undefined;
}

/** Does nothing on the iPad, which keeps no unsent changes between launches yet. */
export async function forgetUnsentChanges(_memberId: string): Promise<void> {}
