import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkFailedFile, fileThatFailedToLoad, reloadForFile } from "../src/shell/app-files.web";

const tasksFile = "https://foyer.example/_expo/static/js/web/tasks-8e5d33f4.js";
const notebookFile = "https://foyer.example/_expo/static/js/web/notebook-51f74605.js";

function failedLoadOf(file: string): Error {
  return Object.assign(new Error(`Loading module ${file} failed.`), {
    name: "AsyncRequireError",
    request: file,
  });
}

function storageKeepingNothing(): Storage {
  const failing = () => {
    throw new DOMException("The browser keeps nothing", "SecurityError");
  };
  return { getItem: failing, setItem: failing } as unknown as Storage;
}

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  const kept = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => kept.set(key, value),
  });
  reload = vi.fn();
  vi.stubGlobal("window", { location: { reload } });
  serverAnswers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function serverAnswers(status = 404) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status })),
  );
}

function deviceIsOffline() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
}

describe("fileThatFailedToLoad", () => {
  it("finds the file that a failed load of the app's files names", () => {
    expect(fileThatFailedToLoad(failedLoadOf(tasksFile))).toBe(tasksFile);
  });

  it.each([
    ["another error", new Error("Cannot read properties of undefined")],
    [
      "a failed load naming no file",
      Object.assign(new Error("failed"), { name: "AsyncRequireError" }),
    ],
    ["something thrown that isn't an error", "failed"],
  ])("ignores %s", (_, error) => {
    expect(fileThatFailedToLoad(error)).toBeNull();
  });
});

describe("checkFailedFile", () => {
  it.each([404, 200])("reloads when the server answers %i for the file", async (status) => {
    serverAnswers(status);

    expect(await checkFailedFile(tasksFile)).toBe("reload");
  });

  it("says the device is offline when the server can't be reached", async () => {
    deviceIsOffline();

    expect(await checkFailedFile(tasksFile)).toBe("offline");
  });

  it("says the file is missing once the tab has reloaded for it", async () => {
    reloadForFile(tasksFile);

    expect(await checkFailedFile(tasksFile)).toBe("missing");
  });

  it("still reloads for another file after reloading for one", async () => {
    reloadForFile(tasksFile);

    expect(await checkFailedFile(notebookFile)).toBe("reload");
  });

  it("still reloads when the browser keeps nothing", async () => {
    vi.stubGlobal("sessionStorage", storageKeepingNothing());

    expect(await checkFailedFile(tasksFile)).toBe("reload");
  });
});

describe("reloadForFile", () => {
  it("reloads the app", () => {
    expect(reloadForFile(tasksFile)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("doesn't reload when the browser can't remember the file, so it can't reload forever", () => {
    vi.stubGlobal("sessionStorage", storageKeepingNothing());

    expect(reloadForFile(tasksFile)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
