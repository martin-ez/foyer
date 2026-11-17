import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { createContext, type ReactNode, use } from "react";
import type { HouseholdSync, SyncState } from "../sync/household-sync";
import { useHouseholdSync } from "../sync/use-household-sync";

/** The signed-in member, what this device knows of their household, and ways to change it. */
export type Household = {
  member: Member;
  state: SyncState;
  sync: HouseholdSync;
  signOut: () => void;
};

const HouseholdContext = createContext<Household | null>(null);

/** Keeps this device in sync with the household while it's shown, for every view inside it to read
 *  with `useHousehold`. Calls `onSignedOut` when the household says the session has ended. */
export function HouseholdProvider({
  member,
  onSignOut,
  onSignedOut,
  children,
}: {
  member: Member;
  onSignOut: () => void;
  onSignedOut: () => void;
  children: ReactNode;
}) {
  const { state, sync } = useHouseholdSync(member.id, onSignedOut);
  return (
    <HouseholdContext value={{ member, state, sync, signOut: onSignOut }}>
      {children}
    </HouseholdContext>
  );
}

/** The household of the `HouseholdProvider` around the calling component. */
export function useHousehold(): Household {
  const household = use(HouseholdContext);
  if (!household) throw new Error("useHousehold needs a HouseholdProvider around it.");
  return household;
}
