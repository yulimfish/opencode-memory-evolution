# opencode-mem v2.19.4 · P2 patch (hybrid injection retrieval)

Applies ON TOP OF `p1.patch` (see `../opencode-mem-v2.19.4-p1/`).
Base package: opencode-mem 2.19.4 (npm). Target: automatic injection quality.
`before/` holds the P1-state copies of the pre-existing files touched by this
patch (the two new hybrid-search files have no baseline by definition).

## How to apply

```bash
cd ~/.config/opencode/node_modules/opencode-mem
patch -p1 < <patch-dir>/opencode-mem-v2.19.4-p1/p1.patch   # if not already applied
patch -p1 < <this-dir>/p2.patch
```

## Scope (what chapter 6 of the v2 design asked for)

1. **Injection retrieval upgrade** — the chat.message automatic injection no
   longer uses `listMemories` (ORDER BY created_at DESC, newest 3). It now runs
   hybrid retrieval: embedding → vector candidates (24) → re-rank with
   `similarity + lexical + importance + time fit`.
2. **Injection gate** — self-contained turns (greetings, slash commands, bare
   shell commands, punctuation/emoji only) skip retrieval entirely. The
   post-compaction re-injection is never gated.
3. **Budgets** — per-memory injection token budget (600) plus a separate
   profile (index-style) budget (250) that truncates the injected profile.
4. **Time-aware query expansion** — time references in the user message
   ("昨天 / 上周 / 3 days ago / 2026-08-15 / 最近 …") become a time window that
   boosts memories created inside it; directional refs ("最近/上次") use a
   softer 14-day half-life.
5. **Frequency signal** — injected memories get `inject_count` /
   `last_injected_at` bumped (best-effort) and the counter feeds importance.
6. **Redundancy control** — light MMR during selection so three near-duplicate
   memories about one feature do not fill the whole injection slot.

## Files (11)

| File | Change |
|---|---|
| `dist/services/hybrid-search.js` (new) | pure scoring: tokenize/estimate, time parsing, importance, rankMemories (diversity + budget + floor), injection gate |
| `dist/services/hybrid-search.d.ts` (new) | types for the above |
| `dist/index.js` | chat.message: gate → searchForInjection with recency fallback; token-capped fallback; recordInjection fire-and-forget |
| `dist/services/client.js` | `searchForInjection()` (embed → searchAcrossShards threshold 0 → rankMemories); `recordInjection()` best-effort counter |
| `dist/services/client.d.ts` | signatures for the two new methods |
| `dist/services/context.js` | profile truncation via `injectProfileTokenBudget` |
| `dist/services/sqlite/vector-search.js` | hydration carries createdAt/updatedAt/authority/source/isStaged/validUntil/injectCount/lastInjectedAt + `incrementInjectCount()` |
| `dist/services/sqlite/vector-search.d.ts` | incrementInjectCount signature |
| `dist/services/sqlite/shard-manager.js` | lazy migration adds `inject_count`, `last_injected_at` |
| `dist/config.js` | new defaults + documented template block |
| `dist/config.d.ts` | new config fields |

## Semantics / notes

- **Fallback:** if `searchForInjection` fails (embedding API down, no shards,
  scope miss) the code falls back to the legacy recency list, so injection
  never breaks. `chatMessage.retrieval: "recency"` switches ranking back to
  newest-first; note the gate (`gateEnabled`) and the fallback token cap are
  independent switches, so full P1-equivalent behavior needs
  `gateEnabled: false` as well.
- **Floor:** candidates below `chatMessage.minScore` (0.3) are dropped; a turn
  may legitimately inject 1–2 memories, or none when nothing passes.
- **Budget rule:** the first selected memory is always kept even if alone it
  exceeds the budget; later ones must fit.
- **Gate is conservative:** only exact social patterns / slash commands / bare
  shell lines / punctuation-only turns are skipped. Any topical message passes
  ("继续搞 P2" injects).
- **`inject_count` is only bumped on the hybrid path** (the fallback does not
  write); counters are best-effort and never block injection.
- **Time parsing** assumes the local timezone; "8月15日" assumes the current
  year; "2026年8月15日" is kept as a single day (not widened to the month).
- **Budget packing:** an oversized candidate is skipped so smaller
  lower-ranked memories can still fit; only the first selected memory is
  exempt from the budget.

## Verification (2026-09-12)

- **Offline comparison** (`~/.config/opencode/memory/eval/compare-injection.mjs`, 46-question
  regression set, project-scoped, embeddings cached; defaults = production):
  - R@3: old recency 7/46 (15.2%) → hybrid **41/46 (89.1%)**
  - R@5: old 11/46 (23.9%) → hybrid 43/46 (93.5%)
  - avg injection tokens: old 752 → hybrid **541** (budget 600)
  - single regression: q37 (hard, 4-memory project; hybrid puts the gold 4th,
    R@5 still hits). Known and accepted.
- **Unit/integration** (`~/.config/opencode/memory/eval/test-p2.mjs`, 43 checks): pure scoring, time
  windows (incl. cross-year "去年" and full CJK dates), gate false-positive
  guards, diversity, budget packing, lazy migration (temp DB), live
  `searchForInjection` (q01 gold hit), live `recordInjection` round-trip with
  self-cleanup (0 residue).
- **No degradation of the search path** (`~/.config/opencode/memory/eval/regression-direct.mjs`):
  R@5 = 39/46 with the same 7 misses as the P0/P1 baseline.
- `dist/index.js` still imports cleanly.

## Known limitations

- The long-running opencode/OpenChamber server keeps the old code in memory
  until restarted (same as P1).
- `inject_count` history for pre-P2 injections is 0 (columns added now).
- The profile budget truncates on line boundaries; very long single lines are
  cut by whole lines only.
- The design's optional "reuse Layered Search topic map as an importance
  input" is deferred until a topic map/cluster artifact exists (Dream output).
- `.d.ts` files were hand-synced; `tsc` was not run (runtime untouched).
