import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { provideRandomValues } from "../src/random-values";

const randomPartFromZeros = /-7000-8000-000000000000$/;

let newId: () => string;

function zeros<T extends Uint8Array>(array: T): T {
  return array.fill(0);
}

beforeEach(async () => {
  vi.resetModules();
  ({ newId } = await import("@foyer/shared"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("lets shared code make ids on a runtime without Web Crypto", () => {
  vi.stubGlobal("crypto", undefined);

  provideRandomValues(zeros);

  expect(newId()).toMatch(randomPartFromZeros);
});

it("keeps the runtime's own Web Crypto when it has one", () => {
  provideRandomValues(zeros);

  expect(newId()).not.toMatch(randomPartFromZeros);
});
