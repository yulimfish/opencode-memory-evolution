// OpenCode runs the Bun worker web server in production; the merge endpoint
// must be routed there too, not only in web-server.js.
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
  (root) => existsSync(join(root, "dist/services/web-server-worker.js")),
);
if (roots.length === 0) {
  console.error("No opencode-mem runtime found. Set OPENCODE_MEM_ROOTS to the package roots.");
  process.exit(2);
}

for (const root of roots) {
  const workerPath = join(root, "dist/services/web-server-worker.js");
  test(`worker web server exposes the P1 merge endpoint: ${workerPath}`, () => {
    const workerSource = readFileSync(workerPath, "utf8");
    assert.match(workerSource, /handleMergeMemories/, "worker must import the merge handler");
    assert.match(
      workerSource,
      /path === "\/api\/memories\/merge" && method === "POST"/,
      "worker must route POST /api/memories/merge",
    );
  });
}
