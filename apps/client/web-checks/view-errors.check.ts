import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import { expectOnAnotherDevice } from "./another-device";
import { saveScreenshot } from "./screenshot";
import {
  bundleBuildTimeout,
  openApp,
  openSpaceOfItsOwn,
  pageTitle,
  sameMemberOnAnotherDevice,
  stickerOf,
} from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 60_000);
});

const thrownOnPurpose = "A check asked the open view to throw.";

async function throwInOpenView(page: Page) {
  await page.evaluate(() => {
    const throwInOpenView = window.foyerTest?.throwInOpenView;
    if (!throwInOpenView) throw new Error("The app has no hook to make the open view throw");
    throwInOpenView();
  });
  await expect(page.getByText("This view couldn't be shown.")).toBeVisible();
  await closeDevelopmentBuildsErrorToast(page);
}

async function closeDevelopmentBuildsErrorToast(page: Page) {
  const toast = page.getByRole("button", { name: thrownOnPurpose });
  await toast.getByRole("button").press("Enter");
  await expect(toast).toBeHidden();
}

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

test("keeps the bar and sends unsaved changes when the open view fails", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const connection = await connectionToTheHousehold(page);
  const space = await openSpaceOfItsOwn(page);
  await connection.goOffline();
  const title = `Added just before the view failed ${Date.now()}`;
  await page.getByLabel("New task").fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText(/not saved yet/)).toBeVisible();

  await throwInOpenView(page);

  await expect(page.getByRole("tab", { name: "Tasks", selected: true })).toBeVisible();
  await expect(page.getByText(/not saved yet/)).toBeVisible();
  expect(errors.join("\n")).toContain(thrownOnPurpose);
  await saveScreenshot(page, testInfo, "view-failed");

  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByText("Foyer reloads once your changes are saved.")).toBeVisible();

  const reloaded = page.waitForEvent("load", { timeout: 40_000 });
  connection.comeBack();
  await reloaded;
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
  await expect(page.getByRole("tab", { name: "Tasks", selected: true })).toBeVisible();
  await expect(pageTitle(page)).toBeVisible();
  const other = await sameMemberOnAnotherDevice(page, space);
  await expectOnAnotherDevice(stickerOf(other, title)).toBeVisible();
});

test("opens a view again after it failed, when another view is opened", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Notebook" }).click();
  await expect(pageTitle(page)).toHaveText("Notebook");

  await throwInOpenView(page);
  await page.getByRole("tab", { name: "Tasks" }).click();

  await expect(page.getByText("This view couldn't be shown.")).toBeHidden();
  await expect(pageTitle(page)).toHaveText(/^Inbox, page \d+$/);
  await page.getByRole("tab", { name: "Notebook" }).click();
  await expect(pageTitle(page)).toHaveText("Notebook");
});

test("reloads at once when the open view fails with nothing unsaved", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Notebook" }).click();
  await throwInOpenView(page);

  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Reload" }).click();
  await reloaded;

  await expect(pageTitle(page)).toHaveText("Notebook", { timeout: bundleBuildTimeout });
  await expect(page.getByText("This view couldn't be shown.")).toBeHidden();
});
