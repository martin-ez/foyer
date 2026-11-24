import { useEffect, useMemo, useSyncExternalStore } from "react";
import { connectToHousehold } from "./connect";
import { deviceStorageOf } from "./device-storage";
import { HouseholdSync } from "./household-sync";

/** Keeps this device in sync with the household while the component is shown, for the signed-in
 *  member. Calls `onSignedOut` when the household says the session has ended, and
 *  `onAnotherMember` when it says the connection carries another member's session. */
export function useHouseholdSync(
  memberId: string,
  onSignedOut: () => void,
  onAnotherMember: () => void,
) {
  const sync = useMemo(
    () =>
      new HouseholdSync({ memberId, connect: connectToHousehold, ...deviceStorageOf(memberId) }),
    [memberId],
  );
  useEffect(() => {
    sync.start();
    return () => sync.stop();
  }, [sync]);
  const state = useSyncExternalStore(sync.subscribe, sync.getState);
  useEffect(() => {
    if (state.status === "signed-out") onSignedOut();
    if (state.status === "another-member") onAnotherMember();
  }, [state.status, onSignedOut, onAnotherMember]);
  return { state, sync };
}
