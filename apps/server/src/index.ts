import { DurableObject } from "cloudflare:workers";
import { handleCall } from "./calls";

/** One household's hub, with its own SQLite storage. */
export class Household extends DurableObject<Env> {
  /** Confirms the household's SQLite storage answers. */
  ping(): string {
    return this.ctx.storage.sql.exec<{ status: string }>("SELECT 'ok' AS status").one().status;
  }
}

export default {
  fetch: handleCall,
} satisfies ExportedHandler<Env>;
