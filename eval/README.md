# eval — merge-safety and regression checks

Tests for the P1 merge endpoint. They target the **installed** `opencode-mem`
runtime (patched `dist/`), not a source checkout, because the patches ship as
`dist` diffs.

## Path resolution

The suite looks for `opencode-mem` under the three locations OpenCode actually
loads from:

1. `~/.config/opencode/node_modules/opencode-mem`
2. `~/.cache/opencode/packages/opencode-mem/node_modules/opencode-mem`
3. `~/.cache/opencode/packages/opencode-mem@latest/node_modules/opencode-mem`

Override with `OPENCODE_MEM_ROOTS` (colon-separated) when your layout differs.

## Run

```bash
node --test eval/test-p1-merge-behavior.mjs   # drives the real LocalMemoryClient with fake shards
node --test eval/test-p1-merge-safety.mjs     # source contract: dedupe / all-ids / same-shard / transaction / compensation
node --test eval/test-p1-worker-merge-route.mjs  # worker web server routes POST /api/memories/merge
```

`test-p1-merge-behavior.mjs` is the important one: it imports the installed
`LocalMemoryClient` and substitutes fake shard/connection objects, so the merge
control flow (validation order, transaction, compensation delete, staged
proposal) is exercised for real without touching any memory database.

## Not included

The regression set, its gold memory ids, comparison harnesses and result
archives stay local — they embed personal memory data. Use `run-regression.mjs`
with your own set file if you want the R@5 harness.
