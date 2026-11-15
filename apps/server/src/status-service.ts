import type { ServiceImpl } from "@connectrpc/connect";
import { appName } from "@foyer/shared";
import type { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";
import { theHousehold } from "./household";

/** Reports the app's name once the household's storage answers. */
export const statusService: ServiceImpl<typeof StatusService> = {
  async getStatus() {
    const storage = await theHousehold().ping();
    return { app: appName, storage };
  },
};
