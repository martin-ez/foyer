import { withEnv } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isOnAllowlist } from "../src/allowlist";

function isOnAllowlistWith(members: string | undefined, email: string): boolean {
  return withEnv({ HOUSEHOLD_MEMBERS: members }, () => isOnAllowlist(email)) as boolean;
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("reads the allowlist the Worker is configured with", () => {
  expect(isOnAllowlist("member@example.com")).toBe(true);
  expect(isOnAllowlist("someone.else@example.com")).toBe(false);
});

it("lets in every email on the list, and nobody else", () => {
  const members = '["alex@example.com", "sam@example.com"]';

  expect(isOnAllowlistWith(members, "alex@example.com")).toBe(true);
  expect(isOnAllowlistWith(members, "sam@example.com")).toBe(true);
  expect(isOnAllowlistWith(members, "robin@example.com")).toBe(false);
});

it("compares emails ignoring case and surrounding spaces", () => {
  const members = '[" Alex@Example.com "]';

  expect(isOnAllowlistWith(members, "alex@example.com")).toBe(true);
  expect(isOnAllowlistWith(members, " ALEX@example.COM")).toBe(true);
});

it("lets nobody in when the list is empty, without reporting a problem", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  expect(isOnAllowlistWith("[]", "alex@example.com")).toBe(false);
  expect(log).not.toHaveBeenCalled();
});

describe("lets nobody in, and logs why without the list's contents, when the allowlist", () => {
  it.each([
    ["is missing", undefined],
    ["is empty", ""],
    ["isn't JSON", "alex@example.com"],
    ["isn't a list", '{"alex@example.com": true}'],
    ["holds something other than an email", '["alex@example.com", 42]'],
    ["holds text that isn't an email", '["alex@example.com", "alex"]'],
  ])("%s", (_, members) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(isOnAllowlistWith(members, "alex@example.com")).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("HOUSEHOLD_MEMBERS"));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("alex"));
  });
});
