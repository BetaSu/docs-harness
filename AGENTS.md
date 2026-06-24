<!-- docs-harness:START -->

## When To Read Docs

When starting work in a project area, entering a directory, modifying files, debugging behavior, or answering questions about a feature, discover relevant docs first:

```bash
docs-harness insight [path] --intent "<why you need docs for this task>"
```

When a returned index entry matches your task, or when you need authoritative details before changing code or docs, read it by name:

```bash
docs-harness read <name> --intent "<why you need this document>"
```

Do not derive file paths from `name` yourself. Commands return JSON envelopes by default: success is `{"ok":true,"data":...}`, failure is `{"ok":false,"error":...}`.

Lines shaped as `- [agent-index] name="<name>" description="<description>"` are document index entries:

- `description` explains when the document should be read; use "Use when ..." in English or an equivalent phrase in the document language
- `name` is the stable identifier of the target document

## When To Maintain Docs

When project code, requirements, configuration, workflows, or docs change, maintain the affected docs in the same task.

Before creating or updating docs, list available document types:

```bash
docs-harness types list
```

Preview the typed document write first:

```bash
docs-harness write --type <type> --path <path> --name <name> --description "Use when ..." --body @body.md --dry-run
```

If the planned document and route-entry changes match the actual project change, apply them:

```bash
docs-harness write --type <type> --path <path> --name <name> --description "Use when ..." --body @body.md --yes
```

## Document Graph Entries

- [agent-index] name="README" description="Use when understanding project overview, directory responsibilities, or basic usage."
- [agent-index] name="docs/architecture/init-agent-files" description="Use when changing init behavior for generic or Claude agent files."

Managed by docs-harness. Edits outside this block are preserved.

<!-- docs-harness:END -->
