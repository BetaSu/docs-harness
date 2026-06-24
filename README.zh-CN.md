# docs-harness

[English](./README.md) | 中文

docs-harness 是一套 agent native 的项目文档管理工具，让 agent 能稳定发现、读取、校验并持续维护项目文档。

## 使用方式

将如下 prompt 复制给 agent：

```text
请先安装 docs-harness：

npm i -g docs-harness

然后在目标项目中执行：

docs-harness skills read agent-init

阅读该命令返回的内容，并严格按照其中的流程完成 docs-harness 初始化、文档管理范围确认、文档图校验和问题修复。
```

## 项目特点

docs-harness 面向 agent 设计，而不是传统的人类文档站点。

这意味着像完全接管项目代码一样，agent 会完全接管项目文档的增、删、查、改。agent 不再依赖人工告诉它“应该读哪个文件”，而是通过 docs-harness 提供的文档协议稳定发现、读取、校验并维护项目文档。

docs-harness 会在接入时先确认哪些 Markdown 进入管理范围。进入管理范围的文档，后续会由 agent 负责更新、迁移、拆分、删除或补充索引；暂时不需要管理的文档，可以先忽略，后续需要时再纳入管理。

## 实现原理

docs-harness 会把项目文档组织成文档图。

如果 agent 发现一个模块是完备的独立功能，例如某个 package、模块、服务、子系统，甚至整个项目，它会为这个功能创建 `README.md`，以及用于分发文档索引的 route 文件。

route 文件会根据 agent 类型不同而变化：

- Claude 使用 `CLAUDE.md`
- 其他 agent 使用 `AGENTS.md`

不同独立功能的 route 会互相连接，形成一张项目文档图。agent 后续查找、读取、更新和校验文档时，都会基于这张图进行，而不是直接猜测 Markdown 文件路径。

### 读

agent 通过 `insight` 了解当前位置相关的功能文档入口。

`insight` 会返回当前功能的 README 描述和 route 中的文档索引。agent 根据这些索引判断当前任务应该读取哪些文档，再通过稳定的文档 `name` 读取全文。

### 写

docs-harness 通过文档类型约束文档写入。

不同类型的文档有不同职责，例如功能 README、文档索引 route、操作步骤 runbook、架构说明 architecture、长期约束 constraints。agent 写文档前会读取当前项目配置中的文档类型定义，再选择合适的类型创建或更新文档。

如果内置的文档类型不满足你的项目需要，可以让 agent 为你定义新的类型，或修改已有类型。

### 自动更新

文档在日常读写过程中会持续收集“改进信号”。

这些信号代表文档使用中暴露出的偏差或摩擦，例如文档没有被正确索引、描述和实际用途不一致、内容过大或结构不适合当前功能。agent 可以通过周期性的修复 loop 执行 `schedule-document-quality-maintenance`，持续处理这些信号，让文档质量和项目实际状态保持同步。

## CLI 命令说明

docs-harness 是一套为 AI native 设计的 CLI；agent 自己知道该调用哪个 CLI 命令，人类完全不需要了解命令细节。
