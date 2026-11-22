import { type Browser, expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import { expectOnAnotherDevice } from "./another-device";
import { saveScreenshot } from "./screenshot";
import { housemate, member, signIn } from "./sign-in";
import { bundleBuildTimeout, openApp, openSpace, openSpaceOfItsOwn, stickerOf } from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 90_000);
});

/** How long the app may take to connect again, waiting longer after each failed attempt. */
const reconnectTimeout = 40_000;

async function connectionToTheHousehold(page: Page) {
  let online = true;
  let connection: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/sync$/, (socket) => {
    if (!online) return socket.close();
    socket.connectToServer();
    connection = socket;
  });
  return {
    async goOffline() {
      online = false;
      await connection?.close();
      await expect(page.getByText(/^Offline/)).toBeVisible();
    },
    comeBack() {
      online = true;
    },
  };
}

async function addTaskOffline(page: Page): Promise<string> {
  const title = `Added offline ${Date.now()}`;
  await page.getByLabel("New task").fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText(/not saved yet/)).toBeVisible();
  return title;
}

/** The same member in another browser, so on another device that keeps nothing of this one's, on
 *  the newest page of the space `name`. */
async function memberInAnotherBrowser(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext(test.info().project.use);
  const page = await context.newPage();
  await openApp(page);
  await openSpace(page, name);
  return page;
}

test("sends a change made offline once the page is reloaded and connects again", async ({
  page,
  browser,
}, testInfo) => {
  const connection = await connectionToTheHousehold(page);
  const space = await openSpaceOfItsOwn(page);
  await connection.goOffline();
  const title = await addTaskOffline(page);

  await page.reload();

  await expect(page.getByText(/^Offline.* · \d+ not saved yet$/)).toBeVisible({
    timeout: bundleBuildTimeout,
  });
  await saveScreenshot(page, testInfo, "unsent-after-reload");
  connection.comeBack();
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: reconnectTimeout });
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  const other = await memberInAnotherBrowser(browser, space);
  await expectOnAnotherDevice(stickerOf(other, title)).toBeVisible();
  await other.context().close();
});

test("never sends a member's unsent changes for another member signed in on the same browser", async ({
  page,
  context,
  browser,
}) => {
  const connection = await connectionToTheHousehold(page);
  const space = await openSpaceOfItsOwn(page);
  await connection.goOffline();
  const title = await addTaskOffline(page);
  await page.close();

  const shared = await context.newPage();
  await signIn(shared, housemate);
  await expect(shared.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await expect(shared.getByText(/not saved yet/)).toBeHidden();
  await expect(shared.getByText(/^Couldn't save/)).toBeHidden();

  await signIn(shared, member);
  await expect(shared.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await expect(shared.getByText(/not saved yet/)).toBeHidden();
  const other = await memberInAnotherBrowser(browser, space);
  await expectOnAnotherDevice(stickerOf(other, title)).toBeVisible();
  await other.context().close();
});

test("forgets a member's unsent changes when they sign out", async ({ page }) => {
  const connection = await connectionToTheHousehold(page);
  const space = await openSpaceOfItsOwn(page);
  await connection.goOffline();
  const title = await addTaskOffline(page);

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  connection.comeBack();
  await openApp(page);

  await expect(page.getByText(/not saved yet/)).toBeHidden();
  await openSpace(page, space);
  await expect(stickerOf(page, title)).toBeHidden();
});
