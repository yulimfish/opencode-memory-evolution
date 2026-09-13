# opencode-memory-evolution

可回滚的 `opencode-mem` 记忆系统进化资产：Dream 报告管线、暂存与证据链补丁、混合注入检索，以及 OpenChamber 夜间任务约定。

## 包含内容

- `agents/memory-dream.md`：只产报告、不写记忆库的 Dream agent
- `bin/dreamctl`：只读数据接口、双阈值门控、锁与运行日志
- `templates/dream/TEMPLATE.md`：人工审核用 Dream 报告模板
- `patches/opencode-mem-v2.19.4-p1/`：暂存、来源、权威、时效、软失效、合并和 outcome 补丁
- `patches/opencode-mem-v2.19.4-p2/`：混合检索、注入门、预算、时间感知和触达频次补丁
- `examples/openchamber-dream-schedule.json`：OpenChamber 调度任务示例

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

然后在 OpenChamber 中创建一个 daily 任务：

- agent：`memory-dream`
- model：使用本机可用的低成本模型
- time：建议 `03:30`
- timezone：`Asia/Shanghai`

创建 agent 或修改 OpenCode 配置后需要重启长驻 OpenChamber/opencode server。

## 应用插件补丁

补丁针对 `opencode-mem@2.19.4` 的 `dist/` 运行时，P2 必须建立在 P1 之上：

```bash
cd ~/.config/opencode/node_modules/opencode-mem
patch -p1 < /path/to/opencode-memory-evolution/patches/opencode-mem-v2.19.4-p1/p1.patch
patch -p1 < /path/to/opencode-memory-evolution/patches/opencode-mem-v2.19.4-p2/p2.patch
```

应用前先用 SQLite `.backup` 备份数据目录。上游升级后应重新核对补丁上下文，不要在无人审查的情况下自动覆盖 `node_modules`。

## 设计原则

1. Dream 只提出报告，人工审核后才固化。
2. 暂存和软失效记忆排除检索，但保留在人工审查面。
3. 所有升级都是增量、可回滚、可复跑的。
4. 公开仓库不携带个人数据或凭证。

## 许可

MIT © Yulimfish
