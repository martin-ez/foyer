import { newId } from "@foyer/shared";
import { afterEach, expect, it, vi } from "vitest";
import { provideRandomValues } from "../src/random-values";

const randomPartFromSevens = /-7777-b777-777777777777$/;

function sevens<T extends Uint8Array>(array: T): T {
  return array.fill(0x77);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("lets shared code make ids on a runtime without Web Crypto", () => {
  vi.stubGlobal("crypto", undefined);

  provideRandomValues(sevens);

  expect(newId()).toMatch(randomPartFromSevens);
});

it("keeps the runtime's own Web Crypto when it has one", () => {
  provideRandomValues(sevens);

  expect(newId()).not.toMatch(randomPartFromSevens);
});
