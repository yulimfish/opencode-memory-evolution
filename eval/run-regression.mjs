#!/usr/bin/env node
// run-regression.mjs - Retrieval regression runner for the opencode-mem P0 baseline.
// Metric: R@5 - a question is a hit iff >=1 gold memory id appears in the top-5
// results of GET /api/search. Read-only; writes one result file per run.
//
// Usage:
//   node run-regression.mjs [--base http://127.0.0.1:4747] [--set <path>] [--out <path>] [--top 10]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = arg("base", process.env.MEM_API_BASE || "http://127.0.0.1:4747");
const SET_PATH = arg("set", join(homedir(), ".config/opencode/memory/eval/regression-set.json"));
const TOP = Number(arg("top", "10"));
const K = 5;
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const OUT_PATH = arg("out", join(homedir(), ".config/opencode/memory/eval/results", `${stamp}-regression.json`));

const set = JSON.parse(readFileSync(SET_PATH, "utf8"));
if (!Array.isArray(set.items) || set.items.length === 0) {
  console.error("regression set is empty or malformed:", SET_PATH);
  process.exit(2);
}

async function search(query) {
  const url = `${BASE}/api/search?q=${encodeURIComponent(query)}&pageSize=${TOP}`;
  const t0 = performance.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const body = await res.json();
  const items = body?.data?.items ?? [];
  return { ids: items.map((it) => it.id), ms: Math.round(performance.now() - t0) };
}

const results = [];
let hits = 0;
for (const item of set.items) {
  let entry;
  try {
    const { ids, ms } = await search(item.question);
    const topK = ids.slice(0, K);
    const hit = item.gold_ids.some((g) => topK.includes(g));
    if (hit) hits++;
    entry = {
      id: item.id,
      question: item.question,
      difficulty: item.difficulty,
      project: item.project,
      gold_ids: item.gold_ids,
      hit,
      topK,
      latency_ms: ms,
    };
  } catch (err) {
    entry = {
      id: item.id,
      question: item.question,
      difficulty: item.difficulty,
      project: item.project,
      gold_ids: item.gold_ids,
      hit: false,
      error: String(err?.message || err),
    };
  }
  results.push(entry);
  process.stdout.write(entry.hit ? "." : "x");
}
process.stdout.write("\n");

const byDiff = {};
for (const r of results) {
  const d = r.difficulty || "unknown";
  byDiff[d] ??= { hit: 0, total: 0 };
  byDiff[d].total++;
  if (r.hit) byDiff[d].hit++;
}

const total = results.length;
const misses = results.filter((r) => !r.hit);
console.log(`\nR@${K} = ${hits}/${total} (${((hits / total) * 100).toFixed(1)}%)`);
for (const [d, v] of Object.entries(byDiff)) console.log(`  ${d}: ${v.hit}/${v.total}`);
if (misses.length) {
  console.log("\nmisses:");
  for (const m of misses) {
    console.log(`  ${m.id} [${m.difficulty}] ${m.question}`);
    console.log(`    gold: ${m.gold_ids.join(", ")}`);
    if (m.error) console.log(`    error: ${m.error}`);
    else console.log(`    top5: ${m.topK.join(", ")}`);
  }
}

const out = {
  ran_at: now.toISOString(),
  base: BASE,
  set_path: SET_PATH,
  set_generated: set.generated,
  metric: `R@${K}`,
  r_at_k: hits / total,
  hits,
  total,
  by_difficulty: byDiff,
  results,
};
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
console.log(`\nresults: ${OUT_PATH}`);
process.exit(0);
