import { expect } from "@playwright/test";

/** Expects what another tab, so another device, shows after a change made on this one. It waits
 *  longer than Playwright's default, since the change goes through the household first. */
export const expectOnAnotherDevice = expect.configure({ timeout: 15_000 });
