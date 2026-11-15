import { afterEach, describe, expect, it, vi } from "vitest";
import { problemFromSignIn, signInWithGoogle } from "../src/session/sign-in.web";

function openWebAppAt(address: string) {
  const browser = {
    location: { href: address, assign: vi.fn() },
    history: {
      state: { route: "home" },
      replaceState: vi.fn((_: unknown, __: string, url: URL) => {
        browser.location.href = url.toString();
      }),
    },
  };
  vi.stubGlobal("window", browser);
  return browser;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signInWithGoogle on the web", () => {
  it("leaves the web app for the backend's Google sign-in", () => {
    const browser = openWebAppAt("http://localhost:8787/");

    signInWithGoogle();

    expect(browser.location.assign).toHaveBeenCalledWith("/auth/google");
  });
});

describe("problemFromSignIn", () => {
  it.each([
    ["not-in-household", "That Google account isn't part of this household."],
    ["failed", "Signing in didn't work. Try again."],
  ])("says why sign-in returned with the error %s", (error, problem) => {
    openWebAppAt(`http://localhost:8787/?sign-in-error=${error}`);

    expect(problemFromSignIn()).toBe(problem);
  });

  it("reports the problem once, removing it from the address and keeping the rest", () => {
    const browser = openWebAppAt("http://localhost:8787/?sign-in-error=failed&page=today");

    problemFromSignIn();

    expect(browser.location.href).toBe("http://localhost:8787/?page=today");
    expect(problemFromSignIn()).toBeUndefined();
  });

  it("finds no problem when sign-in didn't just return", () => {
    openWebAppAt("http://localhost:8787/");

    expect(problemFromSignIn()).toBeUndefined();
  });
});
