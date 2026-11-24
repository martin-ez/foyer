// `pnpm record-strokes <name> [page id]` saves the strokes on a page of the local household as a
// stroke fixture, from the page someone drew on last unless a page is given, and lists it in the
// fixtures' index.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const backend = "http://localhost:8787";
const folder = join(import.meta.dirname, "../packages/shared/test/fixtures/strokes");
const [name, pageId] = process.argv.slice(2);

if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
  fail("Name the fixture in lowercase words joined by hyphens, such as circle-and-scribble.");
}

const query = pageId ? `?page=${encodeURIComponent(pageId)}` : "";
let answer;
try {
  answer = await fetch(`${backend}/auth/dev/strokes${query}`);
} catch {
  fail(`The local backend doesn't answer at ${backend}. Start it first.`);
}
if (!answer.ok) fail(answer.status === 404 ? "There's no ink to record." : await answer.text());
const { pageId: recordedFrom, strokes } = await answer.json();

writeFileSync(join(folder, `${name}.json`), `${fixtureJson(strokes)}\n`);
writeFileSync(join(folder, "index.ts"), indexOf(fixtureNames()));
console.log(`Saved ${strokes.length} strokes from ${recordedFrom} as the "${name}" fixture.`);
console.log("Check it holds nothing personal, then run `pnpm update-golden-images`.");

function fixtureJson(value) {
  return JSON.stringify(value, null, 2).replace(
    /\[[\d\s,-]*\]/g,
    (list) =>
      `[${list
        .slice(1, -1)
        .trim()
        .split(/\s*,\s*/)
        .filter(Boolean)
        .join(", ")}]`,
  );
}

function fixtureNames() {
  return readdirSync(folder)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();
}

function indexOf(names) {
  const variable = (name) => name.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
  const imports = names.map((name) => `import ${variable(name)} from "./${name}.json";\n`);
  const entries = names.map((name) => `  "${name}": ${variable(name)},\n`);
  const value = names.length === 0 ? "{}" : `{\n${entries.join("")}}`;
  return [
    ...imports,
    ...(imports.length > 0 ? ["\n"] : []),
    "/** The stroke fixtures recorded on a real iPad, by name, as `strokeFixtureOf` wrote them.",
    " Written\n *  by `pnpm record-strokes`. */\n",
    `export const strokeFixtures: Readonly<Record<string, unknown>> = ${value};\n`,
  ].join("");
}

function fail(message) {
  console.error(message);
  console.error("docs/development.md explains how to record stroke fixtures on a real iPad.");
  process.exit(1);
}
