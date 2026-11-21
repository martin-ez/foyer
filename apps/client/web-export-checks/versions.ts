import { copyFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

const versionsFolder = path.join(__dirname, "versions");

/** The address of the export checks' backend. */
export const exportChecksBackend = "http://localhost:8789";

/** The folder the export checks' backend serves as the web app's files, as the deployed Worker
 *  serves a deploy's. `deploy` replaces what's in it. */
export const servedFolder = path.join(versionsFolder, "served");

/** A version of the web app, exported by `export-versions.sh`. */
export type Version = { name: string; folder: string };

/** The web app as it is, exported as deploys export it. */
export const current: Version = { name: "current", folder: path.join(versionsFolder, "current") };

/** The web app exported without minifying, so that every file has another name than in `current`.
 *  It stands in for the version that a deploy replaces under an open tab. */
export const earlier: Version = { name: "earlier", folder: path.join(versionsFolder, "earlier") };

const scriptsFolder = "_expo/static/js/web";

/** Serves `version` from the export checks' backend in place of the version it served before, as
 *  a deploy does: none of the earlier version's files are left. Returns once the backend serves
 *  every file of the new version. */
export async function deploy(version: Version) {
  const servedIndex = path.join(servedFolder, "index.html");
  if (!existsSync(servedIndex) || readFileSync(servedIndex, "utf8") !== indexOf(version)) {
    for (const file of readdirSync(servedFolder)) {
      rmSync(path.join(servedFolder, file), { recursive: true });
    }
    // The index goes last, so the backend never serves it without the files it names.
    cpSync(version.folder, servedFolder, {
      recursive: true,
      filter: (file) => file !== path.join(version.folder, "index.html"),
    });
    copyFileSync(path.join(version.folder, "index.html"), servedIndex);
  }
  await expect
    .poll(() => serves(version), {
      message: `the export checks' backend serves the ${version.name} version`,
      timeout: 30_000,
    })
    .toBe(true);
}

/** Expects `page` to have loaded the web app from `version`'s index, which names its scripts. */
export async function expectLoadedFrom(page: Page, version: Version) {
  const scripts = await page.evaluate(() =>
    Array.from(document.scripts, (script) => script.getAttribute("src")),
  );
  const named = Array.from(
    indexOf(version).matchAll(/<script src="([^"]+)"/g),
    (match) => match[1],
  );
  expect(scripts, `the scripts of the ${version.name} version`).toEqual(
    expect.arrayContaining(named),
  );
}

/** Whether the backend serves `version`: its index, and every script, including those a view loads
 *  when it's first opened. Wrangler reads the index from disk on each request, but serves the
 *  files a deploy added only once it has restarted, which takes up to a second. */
async function serves(version: Version): Promise<boolean> {
  const answer = (file: string, method = "GET") =>
    fetch(new URL(file, exportChecksBackend), { method }).catch(() => null);
  const index = await answer("/");
  if (!index?.ok || (await index.text()) !== indexOf(version)) return false;
  const scripts = readdirSync(path.join(version.folder, scriptsFolder));
  const answers = await Promise.all(
    scripts.map((script) => answer(`/${scriptsFolder}/${script}`, "HEAD")),
  );
  return answers.every((script) => script?.ok);
}

function indexOf(version: Version): string {
  return readFileSync(path.join(version.folder, "index.html"), "utf8");
}
