import type { MessageInitShape } from "@bufbuild/protobuf";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { timestampFromMs, timestampNow } from "@bufbuild/protobuf/wkt";
import { encodeSamples, newId, type StrokeSamples, syncPath } from "@foyer/shared";
import { Input, Tool } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import {
  type ChangeSchema,
  type DeviceMessage,
  DeviceMessageSchema,
  HouseholdMessageSchema,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { expect, type Locator, type Page } from "@playwright/test";

type ChangeInit = MessageInitShape<typeof ChangeSchema>["change"];

type DeviceSocket = { socket: WebSocket; received: number[][] };

declare global {
  var otherDevice: DeviceSocket | undefined;
}

/** The colour the checks' ink is written in, which nothing else on a page is drawn in. */
export const inkColour = 0x1f5fd6;

const changesPerPush = 10;

const committing = { timeout: 60_000 };

/** A stroke, in a page's points: its samples, and its brush unless it's the checks' pen. */
export type CheckStroke = {
  samples: StrokeSamples;
  tool?: Tool;
  size?: number;
};

/** Another device of the member signed in on `page`, which writes and erases ink on a page as the
 *  iPad does, through a sync connection of its own opened from the page with the same session. */
export async function inkDevice(page: Page) {
  const address = new URL(syncPath, page.url());
  address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
  await page.evaluate(async (url) => {
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    const device: DeviceSocket = { socket, received: [] };
    socket.onmessage = ({ data }) => {
      if (typeof data !== "string") device.received.push([...new Uint8Array(data)]);
    };
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    globalThis.otherDevice = device;
  }, address.toString());

  const committed = async () => {
    const received = await page.evaluate(() => globalThis.otherDevice?.received ?? []);
    return received
      .map((bytes) => fromBinary(HouseholdMessageSchema, new Uint8Array(bytes)).message)
      .flatMap((message) => (message.case === "committed" ? message.value.results : []));
  };

  const push = async (changes: ChangeInit[]) => {
    const changeIds: string[] = [];
    const pushes: number[][] = [];
    for (let start = 0; start < changes.length; start += changesPerPush) {
      const batch = changes.slice(start, start + changesPerPush).map((change) => {
        const changeId = newId();
        changeIds.push(changeId);
        return { changeId, at: timestampNow(), change };
      });
      const message: DeviceMessage = create(DeviceMessageSchema, {
        message: { case: "push", value: { pushId: newId(), changes: batch } },
      });
      pushes.push([...toBinary(DeviceMessageSchema, message)]);
    }
    await page.evaluate((sent) => {
      for (const bytes of sent) globalThis.otherDevice?.socket.send(new Uint8Array(bytes));
    }, pushes);
    await expect
      .poll(async () => {
        const results = await committed();
        const refused = results.find(({ result }) => result.case === "refused");
        if (refused?.result.case === "refused") throw new Error(refused.result.value.reason);
        const done = new Set(results.map(({ changeId }) => changeId));
        return changeIds.filter((changeId) => !done.has(changeId)).length;
      }, committing)
      .toBe(0);
  };

  return {
    /** Writes strokes on a page in the checks' colour, and returns their ids once the household
     *  has committed them. */
    async addStrokes(pageId: string, strokes: readonly CheckStroke[]): Promise<string[]> {
      const now = Date.now();
      const changes = strokes.map(({ samples, tool = Tool.PEN, size = 1.4 }, index) => ({
        case: "strokeAdd" as const,
        value: {
          strokeId: newId(),
          pageId,
          drawnAt: timestampFromMs(now - strokes.length + index),
          input: Input.PENCIL,
          tool,
          colour: inkColour,
          size,
          samples: encodeSamples(samples),
        },
      }));
      await push(changes);
      return changes.map(({ value }) => value.strokeId);
    },
    /** Erases strokes, once the household has committed it. */
    async eraseStrokes(strokeIds: readonly string[]) {
      await push([{ case: "strokeErase", value: { strokeIds: [...strokeIds] } }]);
    },
  };
}

/** The page whose ink the web app on `page` pulled last, once it has pulled one. Call it with the
 *  frames `page` sent, which `framesSentBy` collects. */
export async function inkFollowed(sent: () => DeviceMessage["message"][]): Promise<string> {
  let pageId = "";
  await expect
    .poll(() => {
      const pull = sent().findLast(({ case: kind, value }) => kind === "pull" && value.pageId);
      pageId = pull?.case === "pull" ? pull.value.pageId : "";
      return pageId;
    })
    .not.toBe("");
  return pageId;
}

/** Collects the sync messages `page` sends from now on. */
export function framesSentBy(page: Page): () => DeviceMessage["message"][] {
  const sent: DeviceMessage["message"][] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") sent.push(fromBinary(DeviceMessageSchema, payload).message);
    });
  });
  return () => sent;
}

/** How many of the screen's pixels over `over`, such as a page or a sticker, are drawn in the
 *  checks' ink colour, as the browser shows them. */
export async function inkPixels(page: Page, over: Locator): Promise<number> {
  const box = await over.boundingBox();
  if (!box) throw new Error("It isn't shown");
  const png = (await page.screenshot({ clip: box })).toString("base64");
  return page.evaluate(
    async ({ image, colour }) => {
      const blob = await (await fetch(`data:image/png;base64,${image}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D canvas");
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const want = [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff];
      let count = 0;
      for (let at = 0; at < data.length; at += 4) {
        if (want.every((value, channel) => Math.abs((data[at + channel] ?? 0) - value) <= 24)) {
          count += 1;
        }
      }
      return count;
    },
    { image: png, colour: inkColour },
  );
}

/** A line from one point to another, as a pen would draw it, with `count` samples along it. */
export function line(
  from: { x: number; y: number },
  to: { x: number; y: number },
  count = 40,
): StrokeSamples {
  const steps = Array.from({ length: count }, (_, index) => index / (count - 1));
  return {
    x: steps.map((step) => from.x + (to.x - from.x) * step),
    y: steps.map((step) => from.y + (to.y - from.y) * step),
    time: steps.map((step) => Math.round(step * count * 8)),
  };
}

/** Lines of handwriting-like loops filling a page of the given size: `count` strokes of about a
 *  hundred samples each, with pressure, as a page of notes might hold. */
export function handwriting(page: { width: number; height: number }, count: number) {
  const margin = 40;
  const wordWidth = 40;
  const gap = 8;
  const lineHeight = 24;
  const perLine = Math.floor((page.width - 2 * margin) / (wordWidth + gap));
  return Array.from({ length: count }, (_, index): CheckStroke => {
    const left = margin + (index % perLine) * (wordWidth + gap);
    const baseline = margin + 20 + Math.floor(index / perLine) * lineHeight;
    const samples = 100;
    const steps = Array.from({ length: samples }, (_, step) => step);
    return {
      samples: {
        x: steps.map((step) => left + (step / samples) * wordWidth + 3 * Math.sin(step / 3)),
        y: steps.map((step) => baseline - 8 * Math.abs(Math.sin(step / 6 + index))),
        time: steps.map((step) => step * 6),
        force: steps.map((step) => 0.3 + 0.4 * Math.abs(Math.sin(step / 10))),
      },
    };
  });
}
