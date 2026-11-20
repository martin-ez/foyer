import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const packageDir = path.dirname(import.meta.dirname);
const tools = path.join(packageDir, "node_modules/.bin");
const marker = "// Left by the test.";
const runsBuf = { timeout: 30_000 };

let copy;

beforeEach(() => {
  copy = mkdtempSync(path.join(tmpdir(), "foyer-generate-"));
  for (const entry of ["scripts", "proto", "buf.yaml", "buf.gen.yaml"]) {
    cpSync(path.join(packageDir, entry), path.join(copy, entry), { recursive: true });
  }
  mkdirSync(path.join(copy, "node_modules/@bufbuild/protoc-gen-es"), { recursive: true });
  symlinkSync(
    path.join(packageDir, "node_modules/@bufbuild/buf"),
    path.join(copy, "node_modules/@bufbuild/buf"),
  );
  setGeneratorVersion("2.0.0");
});

afterEach(() => {
  rmSync(copy, { recursive: true, force: true });
});

function generate() {
  return spawnSync(process.execPath, [path.join(copy, "scripts/generate.mjs")], {
    cwd: copy,
    encoding: "utf8",
    env: { ...process.env, PATH: `${tools}${path.delimiter}${process.env.PATH}` },
  });
}

function generatedPage() {
  return path.join(copy, "src/gen/foyer/page/v1/page_pb.ts");
}

function generateAndMark() {
  expect(generate().status).toBe(0);
  appendFileSync(generatedPage(), marker);
}

function setGeneratorVersion(version) {
  writeFileSync(
    path.join(copy, "node_modules/@bufbuild/protoc-gen-es/package.json"),
    JSON.stringify({ name: "@bufbuild/protoc-gen-es", version }),
  );
}

test("writes the contracts' TypeScript when there's none", runsBuf, () => {
  const run = generate();

  expect(run.status).toBe(0);
  expect(readFileSync(generatedPage(), "utf8")).toContain("export const PageSchema");
});

test("leaves the TypeScript untouched when nothing it's made from changed", runsBuf, () => {
  generateAndMark();

  const run = generate();

  expect(run.status).toBe(0);
  expect(run.stdout).toContain("up to date");
  expect(readFileSync(generatedPage(), "utf8")).toContain(marker);
});

test("writes the TypeScript again when a contract changes", runsBuf, () => {
  generateAndMark();
  appendFileSync(path.join(copy, "proto/foyer/page/v1/page.proto"), "\nmessage Probe {}\n");

  expect(generate().status).toBe(0);

  const page = readFileSync(generatedPage(), "utf8");
  expect(page).toContain("export const ProbeSchema");
  expect(page).not.toContain(marker);
});

test("writes the TypeScript again when Buf's configuration changes", runsBuf, () => {
  generateAndMark();
  appendFileSync(path.join(copy, "buf.gen.yaml"), "# Changed by the test.\n");

  expect(generate().status).toBe(0);

  expect(readFileSync(generatedPage(), "utf8")).not.toContain(marker);
});

test("writes the TypeScript again when the generator's version changes", runsBuf, () => {
  generateAndMark();
  setGeneratorVersion("2.0.1");

  expect(generate().status).toBe(0);

  expect(readFileSync(generatedPage(), "utf8")).not.toContain(marker);
});

test("fails with Buf's error when a contract doesn't parse", runsBuf, () => {
  appendFileSync(path.join(copy, "proto/foyer/page/v1/page.proto"), "\nmessage Broken {\n");

  const run = generate();

  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain("page.proto");
});
