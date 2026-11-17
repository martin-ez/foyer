import { timestampMs } from "@bufbuild/protobuf/wkt";
import type { GetKeyResponse } from "@foyer/shared/gen/foyer/capture/v1/capture_pb";

/** Says in a line whether the member has a capture key, when it was made and when it was last
 *  used, writing dates with `formatDate`, by default in the device's language. */
export function describeCaptureKey(
  key: Pick<GetKeyResponse, "exists" | "createdAt" | "lastUsedAt">,
  formatDate: (ms: number) => string = (ms) =>
    new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" }),
): string {
  if (!key.exists) return "You have no capture key.";
  const made = key.createdAt ? ` on ${formatDate(timestampMs(key.createdAt))}` : "";
  const used = key.lastUsedAt
    ? `last used on ${formatDate(timestampMs(key.lastUsedAt))}`
    : "never used";
  return `Your capture key was made${made}, and ${used}.`;
}
