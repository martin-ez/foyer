import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import type { CaptureService } from "@foyer/shared/gen/foyer/capture/v1/capture_pb";
import { dailyCaptureLimit } from "./capture";
import { theHousehold } from "./household";
import { signedInMember } from "./signed-in";

const keyNotValid =
  "This capture key doesn't work. Make a new one in Foyer, under Shortcuts in the account menu.";
const keyLimited = `This key has made ${dailyCaptureLimit} captures today. Replace it if you didn't make them.`;

/** Adds tasks to a member's Inbox from outside the app, with a capture key, and lets signed-in
 *  members make, remove and look at their key. */
export const captureService: ServiceImpl<typeof CaptureService> = {
  async capture({ title }, context) {
    const key = context.requestHeader.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const captured = key ? await theHousehold().capture(key, title) : "unauthenticated";
    if (captured === "unauthenticated") throw new ConnectError(keyNotValid, Code.Unauthenticated);
    if (captured === "limited") throw new ConnectError(keyLimited, Code.ResourceExhausted);
    if (captured !== "captured") throw new ConnectError(captured.problem, Code.InvalidArgument);
    return {};
  },

  async makeKey(_, context) {
    const member = await signedInMember(context);
    return { key: await theHousehold().makeCaptureKey(member.id) };
  },

  async removeKey(_, context) {
    const member = await signedInMember(context);
    await theHousehold().removeCaptureKey(member.id);
    return {};
  },

  async getKey(_, context) {
    const member = await signedInMember(context);
    const key = await theHousehold().captureKeyOf(member.id);
    if (!key) return { exists: false };
    return {
      exists: true,
      createdAt: timestampFromMs(key.createdAt),
      lastUsedAt: key.lastUsedAt === null ? undefined : timestampFromMs(key.lastUsedAt),
    };
  },
};
