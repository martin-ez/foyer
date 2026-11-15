import { DurableObject, env } from "cloudflare:workers";
import { householdMigrations, migrate } from "./migrations";

/** The household's hub, with its own SQLite storage. Starting it runs the storage migrations it
 *  hasn't run yet, before it answers anything. */
export class Household extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, bindings: Env) {
    super(ctx, bindings);
    migrate(ctx.storage, householdMigrations);
  }

  /** Confirms the household's SQLite storage answers. */
  ping(): string {
    return this.ctx.storage.sql.exec<{ status: string }>("SELECT 'ok' AS status").one().status;
  }
}

/** The one household this deployment holds. */
export function theHousehold(): DurableObjectStub<Household> {
  return env.HOUSEHOLD.getByName("household");
}
