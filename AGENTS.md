<!-- docs-harness:START -->
## How To Find Relevant Docs

When entering any path, run this to discover relevant docs for that path and its children:

```bash
docs-harness insight [path] --intent "<why you need docs for this task>"
```

When you need the full document content, run:

```bash
docs-harness read <name> --intent "<why you need this document>"
```

Do not derive file paths from `name` yourself. Commands return JSON envelopes by default: success is `{"ok":true,"data":...}`, failure is `{"ok":false,"error":...}`.

Lines shaped as `- [agent-index] name="<name>" description="<description>"` are document index entries:

- `description` explains when the document should be read, and should start with "Use when"
- `name` is the stable identifier of the target document

When adding docs for a child directory, create `AGENTS.md` in that directory and keep using the same `[agent-index]` line format.

## How To Add Or Update Docs

When adding or updating project docs, list available document types first:

```bash
docs-harness types list
```

Preview the typed document write first:

```bash
docs-harness write --type <type> --path <path> --name <name> --description "Use when ..." --body @body.md --dry-run
```

If the planned document and route-entry changes look correct, apply them:

```bash
docs-harness write --type <type> --path <path> --name <name> --description "Use when ..." --body @body.md --yes
```

## Document Graph Entries

- [agent-index] name="README" description="Use when understanding project overview, directory responsibilities, or basic usage."
- [agent-index] name="docs/architecture/init-agent-files" description="Use when changing init behavior for generic or Claude agent files."

Managed by docs-harness. Edits outside this block are preserved.
<!-- docs-harness:END -->
