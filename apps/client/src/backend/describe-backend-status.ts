import { type Client, ConnectError } from "@connectrpc/connect";
import type { StatusService } from "@foyer/shared/gen/foyer/status/v1/status_pb";

/** Asks the backend for its status and describes the answer, or why there was none, in a line. */
export async function describeBackendStatus(status: Client<typeof StatusService>) {
  try {
    const { app, storage } = await status.getStatus({});
    return `${app} backend: storage ${storage}`;
  } catch (error) {
    return `Backend unreachable: ${ConnectError.from(error).message}`;
  }
}
