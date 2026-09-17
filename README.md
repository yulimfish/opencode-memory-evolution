# opencode-memory-evolution

可回滚的 `opencode-mem` 记忆系统进化资产：Dream 报告管线、暂存与证据链补丁、混合注入检索，以及 OpenChamber 夜间任务约定。

## 包含内容

- `agents/memory-dream.md`：只产报告、不写记忆库的 Dream agent
- `bin/dreamctl`：只读数据接口、双阈值门控、锁与运行日志
- `templates/dream/TEMPLATE.md`：人工审核用 Dream 报告模板
- `patches/opencode-mem-v2.19.4-p1/`：暂存、来源、权威、时效、软失效、合并和 outcome 补丁（`p1.patch` → `p1-worker-merge-fix.patch` → `p1-merge-safety-fix.patch`）
- `patches/opencode-mem-v2.19.4-p2/`：混合检索、注入门、预算、时间感知和触达频次补丁
- `eval/`：merge 端点行为、源码契约与 worker 路由测试
- `examples/openchamber-dream-schedule.json`：OpenChamber 调度任务示例
- `examples/openchamber-dream-review-schedule.json`：每周人工闸审阅任务示例

## 安全边界

本仓库不包含个人记忆、Dream 报告、回归题集、SQLite 数据库、备份、API key 或个人配置。Dream 默认只能写入本地 staging 报告目录，不能写入记忆库。

## 安装

```bash
CFG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
mkdir -p "$CFG_DIR/agents" "$CFG_DIR/memory/bin" "$CFG_DIR/memory/dream"
cp agents/memory-dream.md "$CFG_DIR/agents/"
cp bin/dreamctl "$CFG_DIR/memory/bin/"
chmod +x "$CFG_DIR/memory/bin/dreamctl"
cp templates/dream/TEMPLATE.md "$CFG_DIR/memory/dream/"
```

然后在 OpenChamber 中创建两个任务：一个 nightly Dream，一个 weekly 人工闸审阅。

### 推荐设置

| 项 | 值 | 说明 |
|---|---|---|
| agent | `memory-dream` | 必须 `mode: all`；subagent mode 不能当定时任务主 agent，会静默回退 `build` |
| model | 本机可用的低成本模型（示例 `deepseek/deepseek-v4-flash`） | 只读、只产报告，不需要强模型 |
| temperature | `0.1` | 报告要稳定、可溯源，不要发散 |
| nightly 调度 | daily `03:30`，`Asia/Shanghai` | 见 `examples/openchamber-dream-schedule.json` |
| weekly 审阅 | 每周日 `20:00`，`Asia/Shanghai`，agent `build` | 见 `examples/openchamber-dream-review-schedule.json`；必须等用户回复才执行批准项 |
| 门控 | `DREAM_MIN_HOURS=24`、`DREAM_MIN_SESSIONS=3`、`DREAM_MIN_MEMORIES=10` | 同时满足时间与信号阈值才跑，避免空转 |
| 权限硬闸 | `edit` 仅 dream 目录 · `bash` 仅 `dreamctl` · `memory/webfetch/websearch/task/question` 全 deny | 见 `agents/memory-dream.md` frontmatter |
| 提示词 | `agents/memory-dream.md` | report-only；首行固定 `DREAM DONE` / `DREAM SKIPPED` / `BLOCKED:` |

Dream 永远只产候选：合并、软失效、技能与规则写入都必须经 weekly 审阅人工确认后才执行。

创建 agent 或修改 OpenCode 配置后需要重启长驻 OpenChamber/opencode server（配置非热加载）。

## 应用插件补丁

补丁针对 `opencode-mem@2.19.4` 的 `dist/` 运行时，P2 必须建立在 P1 之上，P1 内的两个 hotfix 按顺序追加：

```bash
cd ~/.config/opencode/node_modules/opencode-mem
D=/path/to/opencode-memory-evolution/patches
patch -p1 < $D/opencode-mem-v2.19.4-p1/p1.patch
patch -p1 < $D/opencode-mem-v2.19.4-p1/p1-worker-merge-fix.patch
patch -p1 < $D/opencode-mem-v2.19.4-p1/p1-merge-safety-fix.patch
patch -p1 < $D/opencode-mem-v2.19.4-p2/p2.patch
```

应用前先用 SQLite `.backup` 备份数据目录。上游升级后应重新核对补丁上下文，不要在无人审查的情况下自动覆盖 `node_modules`。

注意 OpenCode 的 npm 插件解析会优先运行
`~/.cache/opencode/packages/opencode-mem{,@latest}/node_modules/opencode-mem/`，
只补 `~/.config/opencode/node_modules/opencode-mem` 可能不生效。把插件入口在
`opencode.jsonc` 中固定为本地副本（`./node_modules/opencode-mem/dist/plugin.js`）
可以让配置副本成为唯一运行源；否则更新后需同步上述三份副本并重启 OpenCode。

回滚前先逐分片确认 `COALESCE(valid_until, 0) != 0`：旧代码不过滤软失效行，回滚会让已失效历史重新可见。

用 `eval/` 下的测试验证补丁是否生效（见 `eval/README.md`）：

```bash
node --test eval/test-p1-merge-behavior.mjs
node --test eval/test-p1-worker-merge-route.mjs
```

## 设计原则

1. Dream 只提出报告，人工审核后才固化。
2. 暂存和软失效记忆排除检索，但保留在人工审查面。
3. 所有升级都是增量、可回滚、可复跑的。
4. 公开仓库不携带个人数据或凭证。

## 许可

MIT © Yulimfish
