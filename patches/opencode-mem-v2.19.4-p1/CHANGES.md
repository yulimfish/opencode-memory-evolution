# opencode-mem P1 补丁清单（v2.19.4）

- 日期：2026-09-12
- 基版本：opencode-mem 2.19.4（`~/.config/opencode/node_modules/opencode-mem/dist`，npm 安装，非 fork）
- 目的：自进化记忆系统 v2 · P1 —— 暂存状态 / 证据链字段 / 软失效 / 合并端点 / outcome 打标 / 三处已知缺陷修复
- 补丁文件：依次应用 `p1.patch`（17 文件，+360/−81 行）、`p1-worker-merge-fix.patch`（Worker 路由）与 `p1-merge-safety-fix.patch`（merge 全量校验/事务/补偿）；均在 `node_modules/opencode-mem/` 下执行 `patch -p1`
- 数据备份（改 schema 前）：`~/.opencode-mem/backups/2026-09-12-213719/`（18 库 / 45MB）
- 回滚：重装 `opencode-mem@2.19.4` 恢复代码；数据为增量加列 + 软失效，无物理删除。回滚前必须逐分片查询 `COALESCE(valid_until, 0) != 0`；旧代码不会过滤这些行，会让已失效历史重新可见。需要恢复到补丁前语义时，使用上述备份还原。

## 改动清单

| 文件 | 改动 |
|---|---|
| `dist/services/sqlite/shard-manager.js` | memories 表新增 5 列 `is_staged/source/authority/observed_at/valid_until` + `idx_is_staged` 索引；`migrateShardDb()` 幂等迁移（PRAGMA 检查 + ADD COLUMN）；`ensureShardSchema()` 惰性迁移已有分片（每进程每分片一次），挂在 `getActiveShard`/`getAllShards` 两个解析点 |
| `dist/services/sqlite/vector-search.js` | `RETRIEVABLE_SQL`（`is_staged=0 AND valid_until=0`）应用于：向量搜索 hydration、会话检索 `getMemoriesBySessionID`；`listMemories` 增加 `{includeNonRetrievable}` 选项（默认过滤，WebUI 审查面显式放行）；`insertVector`（维度迁移路径）写新列 |
| `dist/services/client.js` | `addMemory` 支持 `isStaged/source/authority/observedAt/validUntil` 落列（source 同时保留在 metadata JSON 兼容旧读者）；`listMemories` 返回新字段；新增 `mergeMemories(ids, content, opts)` —— 取锚点容器与标签并集创建新条 + 原条 `valid_until` 软失效（不物理删除，`mergedFrom/mergedAt` 写入 metadata）；`isStaged` 合并为提案：不动原条（等人工批准后再失效）；2026-09-17 热修要求所有去重后的 ids 全量存在且同分片，失效在单事务内完成，异常时 best-effort 删除新合并条，删除失败会返回包含两处错误的结果 |
| `dist/services/api-handlers.js` | WebUI 列表暴露 `isStaged/source/authority/observedAt/validUntil` 且放行暂存/失效行（人工审查面）；`handleUpdateMemory` 重插时保留新列 + `is_pinned`（否则更新会重置标志与置顶）、支持 `isStaged` 覆写（审批用途）、扫描 user+project 两类分片；`/api/search` 的 linked-memory 回填跳过暂存/失效行；新增 `handleMergeMemories`（POST /api/memories/merge 的处理器） |
| `dist/services/web-server.js` | 新增路由 `POST /api/memories/merge` |
| `dist/services/web-server-worker.js` | 新增同一 merge 路由；2026-09-17 实测确认 OpenCode 实际使用 Bun Worker WebServer，原补丁只改主 WebServer 会导致生产端点 404 |
| `dist/services/auto-capture.js` | 抽取 schema（zod 与 toolSchema 两路）与 prompt 增加 `outcome: success\|rework\|corrected\|none`（两路均为**可选字段**，模型遗漏不影响捕获）；`normalizeOutcome()` 白名单归一；写入 addMemory metadata；全局单飞门改为 **per-session 锁**（修复两会话交叠时第二个会话捕获被丢弃） |
| `dist/index.js` | ① 空闲防抖由单变量改为 per-session Map（修复多会话互顶漏捕）；② `session.idle` 时先查 `session.get` 的 `parentID`，子代理会话跳过捕获（修复误触发）；③ 关闭插件时清理全部计时器 |
| `dist/config.js` | 移除 5 个死配置项：`maxProfileItems / userProfileStaleDays / userProfileDisplayPreferences / userProfileDisplayPatterns / userProfileDisplayWorkflows`（DEFAULTS、buildConfig、配置模板三处同步） |
| `dist/services/migration-service.js` | 维度迁移 re-embed 路径透传新列（否则迁移会重置标志） |
| `dist/services/deduplication-service.js` | 去重候选只取活跃行（staged/失效行不参与，避免暂存提案与活跃记忆互相遮蔽） |
| `dist/services/cleanup-service.js` | 30 天自动清理跳过 `is_staged=1` 行（保护人工审查队列，不被静默物理删除） |
| `dist/*.d.ts`（6 个） | 类型声明与 JS 同步：`client.d.ts`（mergeMemories + 新字段 + source 联合类型）、`api-handlers.d.ts`（handleMergeMemories + isStaged）、`sqlite/{vector-search,shard-manager,types}.d.ts`（options 参数、迁移方法、MemoryRecord 新字段）、`config.d.ts`（移除 5 个死键 ×3 接口） |

## 设计语义备忘

- **暂存（is_staged=1）**：人工闸前的提案；所有检索/注入路径排除，WebUI 列表可见（带标志）。
- **软失效（valid_until≠0）**：合并/冲突后的历史行；保留原文与向量，检索排除；硬删仅保留给 forget/cleanup（既有行为）。
- **created_at ≈ valid_from**，`observed_at` 记观察时间；`authority` 分级预留（user-stated > verified > agent-inferred），当前仅透传存储，无消费方。
- **统计口径**：`/api/stats` 与 tag 迁移扫描**计入** staged/失效行（总数视图），检索/注入面排除、WebUI 列表放行——这是有意为之。
- 迁移是**惰性**的：分片在首次被插件访问时加列；旧 server 进程不受影响（新列对旧 INSERT 透明，走默认值）。
- **merge 崩溃窗口**：原条失效在单 SQLite 事务中原子执行，异常时 best-effort 删除新条补偿；但新条创建与失效事务之间无法跨分片原子提交，进程在两步之间被强制终止或补偿删除失败时会留下新旧条同时活跃，并持续到依据新条 metadata 的 `mergedFrom` 人工核对修复。

## 跟随上游

- `bun install` / `npm update` 会覆盖 dist → 在 `node_modules/opencode-mem/` 下依次执行 `patch -p1 < p1.patch`、`patch -p1 < p1-worker-merge-fix.patch` 与 `patch -p1 < p1-merge-safety-fix.patch`（三份补丁均用基线树验证可干净应用）。
- 若上游合并了同类功能，按上表逐文件比对后丢弃对应 hunk。
- OpenCode 的 npm 插件解析会优先运行 `~/.cache/opencode/packages/opencode-mem{,@latest}/node_modules/opencode-mem/`，不能只补 `~/.config/opencode/node_modules/opencode-mem/`；更新/重装后需同步三份运行副本并重启 OpenCode。
- 2026-09-17 起 `opencode.jsonc` 将插件入口固定为 `./node_modules/opencode-mem/dist/plugin.js`，重启后以 config 副本为唯一运行源；两个 cache 副本仍同步补丁，供切换前的长驻进程与回滚核对。

## 验证记录（2026-09-12）

- 17 个改动文件 Node 动态 import / 类型自洽全过（语法/加载）。
- 功能测试 `29/29 PASS`（写入真实 AIWorkspace 分片，测完硬删清零）：惰性迁移加列 + 索引、常规/暂存写入、搜索/列表/会话检索三路排除暂存、合并软失效、原条检索排除、staged 合并不动原条、update 保留标志与置顶、isStaged 审批覆写、端点处理器、WebUI 可见性、**linked 回填跳过失效行**、**merge 响应透传 staged**、死配置清除；测试见 `/var/folders/.../T/opencode/p1-test/test-p1.mjs`。
- 补丁在 pristine 树（before/）上 `patch -p1` 应用成功，17 文件产物与实盘逐字节一致。
- 回归集：**在补丁代码上直跑**（in-process `handleSearch`，与 /api/search 同代码路径）R@5 = 39/46（84.8%），与 P0 基线逐题一致（同 7 个 miss）；另经 HTTP（长驻旧代码 server）复跑同为 39/46。无劣化。
- 第一轮独立审计（上轮记录里的 CONDITIONAL PASS 三项 MAJOR）已修：linked-memory 回填过滤、per-session 捕获锁、回归证据改直连补丁代码。
- 未验证：长驻 server 重启后的真机行为（需用户重启后生效；重启后建议用官方 `run-regression.mjs` 再跑一次留档）；维度迁移 re-embed 端到端（未实际触发）；outcome 的真实 LLM 抽取质量（需真实会话空闲捕获）。

## 2026-09-17 运行路径热修

- 生产 `/api/memories/merge` 实测返回 404，定位为实际运行 `web-server-worker.js` 而原 P1 只接入 `web-server.js`。
- 新增 `p1-worker-merge-fix.patch`，并把 P1/P2 + Worker 热修同步到 config node_modules 与两个 OpenCode cache 包副本。
- 回归测试：`memory/eval/test-p1-worker-merge-route.mjs` 同时检查三份副本的 handler import 与 POST 路由。
- 独立审计发现 merge 对部分缺失 ids 仍会继续，且多条失效不在事务中；新增 `p1-merge-safety-fix.patch`、`memory/eval/test-p1-merge-safety.mjs` 与动态行为测试 `memory/eval/test-p1-merge-behavior.mjs`，强制全量存在、同分片、事务失效和失败补偿。
- 本轮数据操作前备份：`~/.opencode-mem/backups/2026-09-17-105049/`（18 库 / 45MB）。
- 2026-09-17 回滚核查确认已有 4 条软失效历史；已移除“当前 0 行”的过期静态结论，并补充回滚前查询要求。
