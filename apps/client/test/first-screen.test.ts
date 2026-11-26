import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FirstScreen from "../src/shell/first-screen";

const keychain = vi.hoisted(() => new Map<string, string>());

vi.mock("expo-secure-store", () => ({
  getItem: (key: string) => keychain.get(key) ?? null,
  setItem: (key: string, value: string) => {
    keychain.set(key, value);
  },
}));

async function launchApp(): Promise<typeof FirstScreen> {
  vi.resetModules();
  return import("../src/shell/first-screen");
}

beforeEach(() => {
  keychain.clear();
});

describe("the first screen chosen on the iPad", () => {
  it("is today's day page until another is chosen", async () => {
    const app = await launchApp();

    expect(app.readFirstScreen()).toBe("day-page");
  });

  it("is kept for the next launch", async () => {
    let app = await launchApp();
    app.chooseFirstScreen("overview");

    app = await launchApp();

    expect(app.readFirstScreen()).toBe("overview");
  });

  it("is today's day page when what's kept names no first screen", async () => {
    keychain.set("first-screen", "a screen that was removed");

    const app = await launchApp();

    expect(app.readFirstScreen()).toBe("day-page");
  });
});

describe("firstScreenHref", () => {
  it("opens today's day page in the Calendar, Today in the Tasks, and the Overview", async () => {
    const { firstScreenHref } = await launchApp();

    expect(firstScreenHref("day-page")).toEqual({ pathname: "/calendar", params: {} });
    expect(firstScreenHref("today-list")).toEqual({
      pathname: "/tasks",
      params: { show: "today" },
    });
    expect(firstScreenHref("overview")).toEqual({ pathname: "/overview", params: {} });
  });
});
