import { env } from "cloudflare:workers";
import type { ServiceImpl } from "@connectrpc/connect";
import { appName } from "@foyer/shared";
import type { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";

/** Reports the app's name once the development household's storage answers. */
export const statusService: ServiceImpl<typeof StatusService> = {
  async getStatus() {
    const storage = await env.HOUSEHOLD.getByName("development").ping();
    return { app: appName, storage };
  },
};
