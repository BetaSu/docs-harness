<!-- docs-harness:START -->
## 如何找到相关文档

当你进入任何路径，如果想了解该路径及其子目录有哪些相关文档，运行：

```bash
docs-harness insight [path]
```

需要读取文档全文时，运行：

```bash
docs-harness show <name>
```

不要根据 `name` 自己拼文件路径。所有命令默认返回 JSON envelope：成功为 `{"ok":true,"data":...}`，失败为 `{"ok":false,"error":...}`。

形如 `- [agent-index] name="<name>" description="<description>"` 的行表示一条文档索引：

- `description` 说明什么任务场景需要读取
- `name` 是目标文档的稳定标识

后续新增子目录文档节点时，在该子目录创建 `AGENTS.md`，并继续使用同样的 `[agent-index]` 行维护索引。

## 文档图入口

- [agent-index] name="README" description="了解项目概览、目录职责或基础使用方式时"
- [agent-index] name="docs/research/init-agent-files" description="调整 init 对 Codex、Claude 等 agent 文件生成策略时"

Managed by docs-harness. Edits outside this block are preserved.
<!-- docs-harness:END -->
