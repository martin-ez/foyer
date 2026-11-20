// Writes the contracts' TypeScript into src/gen with Buf, unless it was made from the same contracts,
// Buf configuration and generator versions, so scripts started together on up-to-date code leave it
// untouched. What it was made from is noted in src/gen, which Buf empties before writing.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const packageDir = path.dirname(import.meta.dirname);
const generated = path.join(packageDir, "src/gen");
const madeFrom = path.join(generated, ".made-from");

const fingerprint = sourcesFingerprint();
if (existsSync(madeFrom) && readFileSync(madeFrom, "utf8") === fingerprint) {
  console.log("The contracts' TypeScript in src/gen is up to date.");
} else {
  try {
    execFileSync("buf", ["generate"], { cwd: packageDir, stdio: "inherit" });
  } catch (error) {
    process.exit(error.status ?? 1);
  }
  writeFileSync(madeFrom, fingerprint);
}

function sourcesFingerprint() {
  const hash = createHash("sha256");
  const require = createRequire(import.meta.url);
  for (const tool of ["@bufbuild/buf", "@bufbuild/protoc-gen-es"]) {
    hash.update(`${tool}@${require(`${tool}/package.json`).version}\n`);
  }
  const protoFiles = readdirSync(path.join(packageDir, "proto"), { recursive: true })
    .map((file) => path.join("proto", file))
    .filter((file) => statSync(path.join(packageDir, file)).isFile());
  for (const file of ["buf.yaml", "buf.gen.yaml", ...protoFiles.sort()]) {
    const content = readFileSync(path.join(packageDir, file));
    hash.update(`${file}\n${content.length}\n`).update(content);
  }
  return hash.digest("hex");
}
