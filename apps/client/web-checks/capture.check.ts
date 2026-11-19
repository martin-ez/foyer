import { expect, type Page, type TestInfo, test, type WebSocketRoute } from "@playwright/test";
import { saveScreenshot } from "./screenshot";
import { householdMembers, signIn } from "./sign-in";
import { bundleBuildTimeout } from "./tasks";

test.beforeEach(() => {
  test.setTimeout(bundleBuildTimeout + 60_000);
});

async function open(page: Page, email?: string) {
  await signIn(page, email);
  await expect(page.getByText("Up to date")).toBeVisible({ timeout: bundleBuildTimeout });
}

async function capture(page: Page, title: string) {
  const field = page.getByRole("textbox", { name: "Capture" });
  await field.fill(title);
  await field.press("Enter");
  await expect(page.getByRole("status")).toHaveText(`Added “${title}” to Inbox`);
  await expect(field).toHaveValue("");
}

async function sameMemberOnAnotherDevice(page: Page): Promise<Page> {
  const other = await page.context().newPage();
  await open(other);
  return other;
}

async function openInboxList(page: Page) {
  await page.getByRole("tab", { name: "Tasks" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  return page.getByRole("list", { name: "Inbox" });
}

function keyHolderFor(testInfo: TestInfo): string {
  const email = householdMembers()[testInfo.project.name === "phone" ? 1 : 0];
  test.skip(
    email === undefined,
    "The phone needs a second member in HOUSEHOLD_MEMBERS, so the viewports, which run at once, don't replace each other's key",
  );
  return email ?? "";
}

async function openShortcuts(page: Page) {
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Shortcuts" }).click();
}

async function makeKey(page: Page) {
  await page.getByRole("button", { name: /^(Make|Replace) key$/ }).click();
  await expect(page.getByText(/, and never used\.$/)).toBeVisible();
  return (await page.getByLabel("Capture key").textContent()) ?? "";
}

test("captures a task into the Inbox from every destination", async ({ page }, testInfo) => {
  await open(page);
  const titles: string[] = [];

  for (const destination of ["Calendar", "Notebook", "Tasks"]) {
    await page.getByRole("tab", { name: destination }).click();
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    const title = `Captured from the ${destination} ${Date.now()}`;
    await capture(page, title);
    titles.push(title);
    if (destination === "Notebook") await saveScreenshot(page, testInfo, "capture");
    await page.getByRole("button", { name: "Close" }).click();
  }
  await expect(page.getByText(/not saved yet/)).toBeHidden();

  const other = await sameMemberOnAnotherDevice(page);
  for (const device of [page, other]) {
    const list = await openInboxList(device);
    for (const title of titles)
      await expect(list.getByRole("button", { name: title })).toBeVisible();
  }
});

test("captures several tasks in a row without leaving the field", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const first = `Buy stamps ${Date.now()}`;
  const second = `Post the letter ${Date.now()}`;

  await capture(page, first);
  await page.keyboard.type(second);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("textbox", { name: "Capture" })).toHaveValue("");
  const list = await openInboxList(page);
  for (const title of [first, second]) {
    await expect(list.getByRole("button", { name: title })).toBeVisible();
  }
});

test("says which task it added until the next is typed, even when it's the same", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const title = `Buy stamps ${Date.now()}`;
  await capture(page, title);
  const status = page.getByRole("status");

  await page.getByRole("textbox", { name: "Capture" }).pressSequentially(title.slice(0, 3));
  await expect(status).toHaveText("");
  await page.getByRole("textbox", { name: "Capture" }).fill(title);
  await page.keyboard.press("Enter");

  await expect(status).toHaveText(`Added “${title}” to Inbox`);
});

test("won't capture a blank title", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Capture", exact: true }).click();

  await page.getByRole("textbox", { name: "Capture" }).fill("   ");

  await expect(page.getByRole("button", { name: "Add to Inbox" })).toBeDisabled();
});

test("makes a capture key that a Shortcut captures with, then replaces and removes it", async ({
  page,
}, testInfo) => {
  await open(page, keyHolderFor(testInfo));
  await openShortcuts(page);

  const key = await makeKey(page);
  const address = (await page.getByLabel("Capture address").textContent()) ?? "";
  await expect(page.getByText(/^Your capture key was made on .+, and never used\.$/)).toBeVisible();
  await saveScreenshot(page, testInfo, "capture-key");
  await page.getByRole("button", { name: "Hide account" }).click();

  const title = `Captured from a Shortcut ${Date.now()}`;
  const sent = await page.request.post(address, {
    headers: { Authorization: `Bearer ${key}` },
    data: { title },
  });
  expect(sent.status()).toBe(200);
  expect(await sent.json()).toEqual({});
  const list = await openInboxList(page);
  await expect(list.getByRole("button", { name: title })).toBeVisible();

  const blank = await page.request.post(address, {
    headers: { Authorization: `Bearer ${key}` },
    data: { title: " " },
  });
  expect(blank.status()).toBe(400);
  expect(await blank.json()).toMatchObject({ message: "A title can't be blank." });

  await openShortcuts(page);
  await expect(page.getByText(/, and last used on /)).toBeVisible();
  await page.getByRole("button", { name: "Replace key" }).click();
  await expect(page.getByLabel("Capture key")).not.toHaveText(key);
  const withOldKey = await page.request.post(address, {
    headers: { Authorization: `Bearer ${key}` },
    data: { title },
  });
  expect(withOldKey.status()).toBe(401);

  const newKey = (await page.getByLabel("Capture key").textContent()) ?? "";
  await page.getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByText("You have no capture key.")).toBeVisible();
  await expect(page.getByLabel("Capture key")).toBeHidden();
  const withRemovedKey = await page.request.post(address, {
    headers: { Authorization: `Bearer ${newKey}` },
    data: { title },
  });
  expect(withRemovedKey.status()).toBe(401);
});

test("adds a task with the Add to Inbox button", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const title = `Call the plumber ${Date.now()}`;

  await page.getByRole("textbox", { name: "Capture" }).fill(title);
  await page.getByRole("button", { name: "Add to Inbox" }).click();

  await expect(page.getByRole("status")).toHaveText(`Added “${title}” to Inbox`);
  const list = await openInboxList(page);
  await expect(list.getByRole("button", { name: title })).toBeVisible();
});

test("sends a capture made offline once the device connects again", async ({ page }) => {
  let online = true;
  let connection: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/sync$/, (socket) => {
    if (!online) return socket.close();
    socket.connectToServer();
    connection = socket;
  });
  await open(page);
  online = false;
  await connection?.close();
  await expect(page.getByText(/^Offline/)).toBeVisible();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const title = `Captured offline ${Date.now()}`;
  await capture(page, title);
  await expect(page.getByText(/not saved yet/)).toBeVisible();

  online = true;

  await expect(page.getByText("Up to date")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText(/not saved yet/)).toBeHidden();
  const list = await openInboxList(await sameMemberOnAnotherDevice(page));
  await expect(list.getByRole("button", { name: title })).toBeVisible();
});

test("can't capture until the household's spaces arrive", async ({ browser }) => {
  const context = await browser.newContext(test.info().project.use);
  const page = await context.newPage();
  await page.routeWebSocket(/\/sync$/, () => {});
  await signIn(page);

  await page.getByRole("button", { name: "Capture", exact: true }).click({
    timeout: bundleBuildTimeout,
  });
  await page.getByRole("textbox", { name: "Capture" }).fill("Call the plumber");

  await expect(page.getByText("Waiting for the household's spaces…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to Inbox" })).toBeDisabled();
  await context.close();
});

test("copies the capture address and a new key", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, keyHolderFor(testInfo));
  await openShortcuts(page);
  const key = await makeKey(page);
  const address = (await page.getByLabel("Capture address").textContent()) ?? "";
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  await page.getByRole("button", { name: "Copy key" }).click();
  await expect.poll(clipboard).toBe(key);
  await page.getByRole("button", { name: "Copy address" }).click();
  await expect.poll(clipboard).toBe(address);

  await page.getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByText("You have no capture key.")).toBeVisible();
});

test("says when it can't check the capture key", async ({ page }) => {
  await page.route("**/foyer.capture.v1.CaptureService/GetKey", (route) => route.abort());
  await open(page);

  await openShortcuts(page);

  await expect(page.getByText(/^Couldn't check your capture key: /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Make key" })).toBeDisabled();
});
