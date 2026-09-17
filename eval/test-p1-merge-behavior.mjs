// Drives the real LocalMemoryClient.mergeMemories() from the installed
// opencode-mem runtime against fake shard/connection objects, so the merge
// control flow is exercised for real without touching a memory database.
//
// Override the runtime location with OPENCODE_MEM_ROOTS (colon-separated).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

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

function memory(id, containerTag = "project_test") {
  return {
    id,
    content: `memory ${id}`,
    container_tag: containerTag,
    tags: "p1,merge",
    type: "note",
  };
}

function fakeDb(path, rows, initiallyActive = rows.map((row) => row.id)) {
  let active = new Set(initiallyActive);
  let transactions = 0;
  return {
    path,
    rows: new Map(rows.map((row) => [row.id, row])),
    get active() {
      return active;
    },
    get transactions() {
      return transactions;
    },
    prepare() {
      return {
        run(_validUntil, _updatedAt, id) {
          if (!active.has(id)) return { changes: 0 };
          active.delete(id);
          return { changes: 1 };
        },
      };
    },
    transaction(callback) {
      return () => {
        transactions++;
        const snapshot = new Set(active);
        try {
          return callback();
        } catch (error) {
          active = snapshot;
          throw error;
        }
      };
    },
  };
}

async function loadRuntime(root) {
  const url = (relative) => pathToFileURL(`${root}/${relative}`).href;
  const [clientModule, shardModule, searchModule, connectionModule] = await Promise.all([
    import(url("dist/services/client.js")),
    import(url("dist/services/sqlite/shard-manager.js")),
    import(url("dist/services/sqlite/vector-search.js")),
    import(url("dist/services/sqlite/connection-manager.js")),
  ]);
  return {
    LocalMemoryClient: clientModule.LocalMemoryClient,
    shardManager: shardModule.shardManager,
    vectorSearch: searchModule.vectorSearch,
    connectionManager: connectionModule.connectionManager,
  };
}

async function withRuntimeFakes(root, databases, callback) {
  const runtime = await loadRuntime(root);
  const originalGetAllShards = runtime.shardManager.getAllShards;
  const originalGetMemoryById = runtime.vectorSearch.getMemoryById;
  const originalGetConnection = runtime.connectionManager.getConnection;
  runtime.shardManager.getAllShards = (scope) =>
    scope === "user" ? [...databases.values()].map((db) => ({ dbPath: db.path })) : [];
  runtime.vectorSearch.getMemoryById = (db, id) => db.rows.get(id) || null;
  runtime.connectionManager.getConnection = (path) => databases.get(path);
  try {
    const client = new runtime.LocalMemoryClient();
    client.isInitialized = true;
    await callback(client);
  } finally {
    runtime.shardManager.getAllShards = originalGetAllShards;
    runtime.vectorSearch.getMemoryById = originalGetMemoryById;
    runtime.connectionManager.getConnection = originalGetConnection;
  }
}

for (const root of roots) {
  test(`merge behavior is all-or-nothing: ${root}`, async (t) => {
    await t.test("rejects a partial id set before creating a memory", async () => {
      const db = fakeDb("/fake/a.db", [memory("a")]);
      await withRuntimeFakes(root, new Map([[db.path, db]]), async (client) => {
        let additions = 0;
        client.addMemory = async () => {
          additions++;
          return { success: true, id: "merged" };
        };
        const result = await client.mergeMemories(["a", "missing"], "merged content");
        assert.equal(result.success, false);
        assert.match(result.error, /missing/);
        assert.equal(additions, 0);
        assert.deepEqual([...db.active], ["a"]);
      });
    });

    await t.test("rejects originals split across shards", async () => {
      const dbA = fakeDb("/fake/a.db", [memory("a")]);
      const dbB = fakeDb("/fake/b.db", [memory("b")]);
      await withRuntimeFakes(root, new Map([[dbA.path, dbA], [dbB.path, dbB]]), async (client) => {
        let additions = 0;
        client.addMemory = async () => {
          additions++;
          return { success: true, id: "merged" };
        };
        const result = await client.mergeMemories(["a", "b"], "merged content");
        assert.equal(result.success, false);
        assert.match(result.error, /same shard/);
        assert.equal(additions, 0);
      });
    });

    await t.test("deduplicates ids and invalidates once in one transaction", async () => {
      const db = fakeDb("/fake/a.db", [memory("a")]);
      await withRuntimeFakes(root, new Map([[db.path, db]]), async (client) => {
        let mergedFrom;
        client.addMemory = async (_content, _container, metadata) => {
          mergedFrom = metadata.mergedFrom;
          return { success: true, id: "merged" };
        };
        const result = await client.mergeMemories(["a", "a"], "merged content");
        assert.deepEqual(result, { success: true, id: "merged", merged: 1, invalidated: 1 });
        assert.deepEqual(mergedFrom, ["a"]);
        assert.equal(db.transactions, 1);
        assert.equal(db.active.size, 0);
      });
    });

    await t.test("keeps originals active for a staged merge proposal", async () => {
      const db = fakeDb("/fake/a.db", [memory("a"), memory("b")]);
      await withRuntimeFakes(root, new Map([[db.path, db]]), async (client) => {
        client.addMemory = async () => ({ success: true, id: "staged-merged" });
        const result = await client.mergeMemories(["a", "b"], "merged content", { isStaged: true });
        assert.deepEqual(result, {
          success: true,
          id: "staged-merged",
          merged: 2,
          invalidated: 0,
          staged: true,
        });
        assert.equal(db.transactions, 0);
        assert.deepEqual([...db.active], ["a", "b"]);
      });
    });

    await t.test("rolls back invalidations and deletes the new memory on failure", async () => {
      const db = fakeDb("/fake/a.db", [memory("a"), memory("b")], ["a"]);
      await withRuntimeFakes(root, new Map([[db.path, db]]), async (client) => {
        let deleted;
        client.addMemory = async () => ({ success: true, id: "merged" });
        client.deleteMemory = async (id) => {
          deleted = id;
          return { success: true };
        };
        const result = await client.mergeMemories(["a", "b"], "merged content");
        assert.equal(result.success, false);
        assert.match(result.error, /could not be invalidated: b/);
        assert.equal(deleted, "merged");
        assert.deepEqual([...db.active], ["a"]);
      });
    });

    await t.test("reports both invalidation and compensation failures", async () => {
      const db = fakeDb("/fake/a.db", [memory("a"), memory("b")], ["a"]);
      await withRuntimeFakes(root, new Map([[db.path, db]]), async (client) => {
        client.addMemory = async () => ({ success: true, id: "merged" });
        client.deleteMemory = async () => ({ success: false, error: "vector delete failed" });
        const result = await client.mergeMemories(["a", "b"], "merged content");
        assert.equal(result.success, false);
        assert.match(result.error, /could not be invalidated: b/);
        assert.match(result.error, /rollback failed: vector delete failed/);
        assert.deepEqual([...db.active], ["a"]);
      });
    });
  });
}
