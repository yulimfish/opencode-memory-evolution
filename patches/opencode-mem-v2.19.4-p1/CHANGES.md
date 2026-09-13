# opencode-mem P1 补丁清单（v2.19.4）

- 日期：2026-09-12
- 基版本：opencode-mem 2.19.4（`~/.config/opencode/node_modules/opencode-mem/dist`，npm 安装，非 fork）
- 目的：自进化记忆系统 v2 · P1 —— 暂存状态 / 证据链字段 / 软失效 / 合并端点 / outcome 打标 / 三处已知缺陷修复
- 补丁文件：`p1.patch`（17 文件，+360/−81 行，`patch -p1` 于 `node_modules/opencode-mem/` 下应用；其中 11 个 JS 运行时文件 + 6 个同名 `.d.ts` 类型声明同步）
- 数据备份（改 schema 前）：`~/.opencode-mem/backups/2026-09-12-213719/`（18 库 / 45MB）
- 回滚：重装 `opencode-mem@2.19.4` 恢复代码；数据为增量加列 + 软失效，无破坏性改动，必要时用上述备份还原（注意：若已有软失效行，回滚旧代码会让失效行重新可见——当前 0 行，回滚干净）

## 改动清单

| 文件 | 改动 |
|---|---|
| `dist/services/sqlite/shard-manager.js` | memories 表新增 5 列 `is_staged/source/authority/observed_at/valid_until` + `idx_is_staged` 索引；`migrateShardDb()` 幂等迁移（PRAGMA 检查 + ADD COLUMN）；`ensureShardSchema()` 惰性迁移已有分片（每进程每分片一次），挂在 `getActiveShard`/`getAllShards` 两个解析点 |
| `dist/services/sqlite/vector-search.js` | `RETRIEVABLE_SQL`（`is_staged=0 AND valid_until=0`）应用于：向量搜索 hydration、会话检索 `getMemoriesBySessionID`；`listMemories` 增加 `{includeNonRetrievable}` 选项（默认过滤，WebUI 审查面显式放行）；`insertVector`（维度迁移路径）写新列 |
| `dist/services/client.js` | `addMemory` 支持 `isStaged/source/authority/observedAt/validUntil` 落列（source 同时保留在 metadata JSON 兼容旧读者）；`listMemories` 返回新字段；新增 `mergeMemories(ids, content, opts)` —— 取锚点容器与标签并集创建新条 + 原条 `valid_until` 软失效（不物理删除，`mergedFrom/mergedAt` 写入 metadata）；`isStaged` 合并为提案：不动原条（等人工批准后再失效） |
| `dist/services/api-handlers.js` | WebUI 列表暴露 `isStaged/source/authority/observedAt/validUntil` 且放行暂存/失效行（人工审查面）；`handleUpdateMemory` 重插时保留新列 + `is_pinned`（否则更新会重置标志与置顶）、支持 `isStaged` 覆写（审批用途）、扫描 user+project 两类分片；`/api/search` 的 linked-memory 回填跳过暂存/失效行；新增 `handleMergeMemories`（POST /api/memories/merge 的处理器） |
| `dist/services/web-server.js` | 新增路由 `POST /api/memories/merge` |
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

## 跟随上游

- `bun install` / `npm update` 会覆盖 dist → 在 `node_modules/opencode-mem/` 下 `patch -p1 < p1.patch` 重新应用（补丁已用 pristine 树验证可干净应用）。
- 若上游合并了同类功能，按上表逐文件比对后丢弃对应 hunk。
- `dist/services/web-server-worker.js` 是同源旧副本（全库无引用，dead code），未改动。

## 验证记录（2026-09-12）

- 17 个改动文件 Node 动态 import / 类型自洽全过（语法/加载）。
- 功能测试 `29/29 PASS`（写入真实 AIWorkspace 分片，测完硬删清零）：惰性迁移加列 + 索引、常规/暂存写入、搜索/列表/会话检索三路排除暂存、合并软失效、原条检索排除、staged 合并不动原条、update 保留标志与置顶、isStaged 审批覆写、端点处理器、WebUI 可见性、**linked 回填跳过失效行**、**merge 响应透传 staged**、死配置清除；测试见 `/var/folders/.../T/opencode/p1-test/test-p1.mjs`。
- 补丁在 pristine 树（before/）上 `patch -p1` 应用成功，17 文件产物与实盘逐字节一致。
- 回归集：**在补丁代码上直跑**（in-process `handleSearch`，与 /api/search 同代码路径）R@5 = 39/46（84.8%），与 P0 基线逐题一致（同 7 个 miss）；另经 HTTP（长驻旧代码 server）复跑同为 39/46。无劣化。
- 第一轮独立审计（上轮记录里的 CONDITIONAL PASS 三项 MAJOR）已修：linked-memory 回填过滤、per-session 捕获锁、回归证据改直连补丁代码。
- 未验证：长驻 server 重启后的真机行为（需用户重启后生效；重启后建议用官方 `run-regression.mjs` 再跑一次留档）；维度迁移 re-embed 端到端（未实际触发）；outcome 的真实 LLM 抽取质量（需真实会话空闲捕获）。
