import { DurableObject } from "cloudflare:workers";
import { appName } from "@foyer/shared";

/** One household's hub, with its own SQLite storage. */
export class Household extends DurableObject<Env> {
  /** Confirms the household's SQLite storage answers. */
  ping(): string {
    return this.ctx.storage.sql.exec<{ status: string }>("SELECT 'ok' AS status").one().status;
  }
}

export default {
  async fetch(_request, env): Promise<Response> {
    const storage = await env.HOUSEHOLD.getByName("development").ping();
    return Response.json({ app: appName, storage });
  },
} satisfies ExportedHandler<Env>;
