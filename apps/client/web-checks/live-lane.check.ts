import { fromBinary } from "@bufbuild/protobuf";
import {
  type DeviceMessage,
  DeviceMessageSchema,
  type HouseholdMessage,
  HouseholdMessageSchema,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { describeDayInBrowser } from "./pages";
import { householdMembers, signIn } from "./sign-in";

const bundleBuildTimeout = 120_000;

type Sent = DeviceMessage["message"];
type Received = HouseholdMessage["message"];

/** A member's browser, signed in, with the live lane's messages on its sync connection. */
type Member = { page: Page; sent: Sent[]; received: Received[] };

test("tells the household which page is open and where the member points", async ({
  browser,
}, testInfo) => {
  test.setTimeout(bundleBuildTimeout + 60_000);
  test.skip(
    testInfo.project.name !== "ipad",
    "Checked in one viewport, so that two runs don't share the household's page at once.",
  );
  const [first, second] = householdMembers();
  test.skip(second === undefined, "Needs two emails in HOUSEHOLD_MEMBERS in .dev.vars.");
  if (first === undefined || second === undefined) return;
  const baseURL = testInfo.project.use.baseURL;

  const alex = await openAs(browser, baseURL, first);
  const today = await todaysPageId(alex.page);
  await expect.poll(() => entered(alex)).toEqual([today]);
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 0 });

  const sam = await openAs(browser, baseURL, second);
  await expect.poll(() => entered(sam)).toEqual([today]);
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 1 });
  await expect.poll(() => lastHere(sam)).toEqual({ pageId: today, members: 1 });

  await pointAtMiddleOfPage(sam.page);
  await expect.poll(() => kinds(sam.sent)).toContain("point");
  await expect.poll(() => kinds(alex.received)).toContain("pointed");

  await setHidden(sam.page, true);
  await expect.poll(() => kinds(sam.sent).at(-1)).toBe("leave");
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 0 });

  await setHidden(sam.page, false);
  await expect.poll(() => entered(sam)).toEqual([today, today]);
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 1 });

  await sam.page.getByRole("button", { name: "Next day" }).click();
  await expect(sam.page.getByRole("heading")).toHaveText(await describeDayInBrowser(sam.page, 1));
  await expect.poll(() => entered(sam).length).toBe(3);
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 0 });

  await sam.page.getByRole("button", { name: "Today" }).click();
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 1 });
  await sam.page.context().close();
  await expect.poll(() => lastHere(alex)).toEqual({ pageId: today, members: 0 });

  await alex.page.context().close();
});

async function openAs(browser: Browser, baseURL: string | undefined, email: string) {
  const page = await (await browser.newContext({ baseURL })).newPage();
  const member: Member = { page, sent: [], received: [] };
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string")
        member.sent.push(fromBinary(DeviceMessageSchema, payload).message);
    });
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") {
        member.received.push(fromBinary(HouseholdMessageSchema, payload).message);
      }
    });
  });
  await signIn(page, email);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  return member;
}

function kinds(messages: (Sent | Received)[]) {
  return messages.map(({ case: kind }) => kind);
}

function entered({ sent }: Member) {
  return sent.flatMap((message) => (message.case === "enter" ? [message.value.pageId] : []));
}

function lastHere({ received }: Member) {
  const here = received.findLast(({ case: kind }) => kind === "here");
  return here?.case === "here"
    ? { pageId: here.value.pageId, members: here.value.members.length }
    : null;
}

function todaysPageId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `day:${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });
}

async function pointAtMiddleOfPage(page: Page) {
  const sheet = page.getByLabel(await describeDayInBrowser(page, 0));
  const box = await sheet.boundingBox();
  if (!box) throw new Error("The page isn't shown");
  await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 5 });
}

/** Makes the browser say the tab is hidden or shown, as when it goes to the background. */
function setHidden(page: Page, hidden: boolean) {
  return page.evaluate((isHidden) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (isHidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
