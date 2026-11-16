import { useEffect, useMemo, useSyncExternalStore } from "react";
import { connectToHousehold } from "./connect";
import { HouseholdSync } from "./household-sync";

/** Keeps this device in sync with the household while the component is shown, for the signed-in
 *  member. Calls `onSignedOut` when the household says the session has ended. */
export function useHouseholdSync(memberId: string, onSignedOut: () => void) {
  const sync = useMemo(
    () => new HouseholdSync({ memberId, connect: connectToHousehold }),
    [memberId],
  );
  useEffect(() => {
    sync.start();
    return () => sync.stop();
  }, [sync]);
  const state = useSyncExternalStore(sync.subscribe, sync.getState);
  useEffect(() => {
    if (state.status === "signed-out") onSignedOut();
  }, [state.status, onSignedOut]);
  return { state, sync };
}
