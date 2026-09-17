// Source contract for the merge-safety hotfix. Fast and path-only; the
// behavioural counterpart lives in test-p1-merge-behavior.mjs.
//
// Override the runtime location with OPENCODE_MEM_ROOTS (colon-separated).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const DEFAULT_ROOTS = [
  join(homedir(), ".config/opencode/node_modules/opencode-mem"),
  join(homedir(), ".cache/opencode/packages/opencode-mem/node_modules/opencode-mem"),
  join(homedir(), ".cache/opencode/packages/opencode-mem@latest/node_modules/opencode-mem"),
];
const roots = (process.env.OPENCODE_MEM_ROOTS ? process.env.OPENCODE_MEM_ROOTS.split(":") : DEFAULT_ROOTS).filter(
  (root) => existsSync(join(root, "dist/services/client.js")),
);
if (roots.length === 0) {
  console.error("No opencode-mem runtime found. Set OPENCODE_MEM_ROOTS to the package roots.");
  process.exit(2);
}

for (const root of roots) {
  const clientPath = join(root, "dist/services/client.js");
  test(`merge is all-or-nothing for approved ids: ${clientPath}`, () => {
    const source = readFileSync(clientPath, "utf8");
    assert.match(source, /if \(!Array\.isArray\(ids\)\)/);
    assert.match(source, /const uniqueIds = Array\.from\(new Set\(ids\)\)/);
    assert.match(source, /found\.length !== uniqueIds\.length/);
    assert.match(source, /f\.shard\.dbPath !== anchorShard\.dbPath/);
    assert.match(source, /const invalidateTransaction = db\.transaction/);
    assert.match(source, /await this\.deleteMemory\(addResult\.id\)/);
  });
}
