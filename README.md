# docs-harness

Agent-first project document graph CLI.

`docs-harness` is designed for coding agents. Commands print compact JSON envelopes by default.

```bash
npm install -g docs-harness
docs-harness init --dry-run
docs-harness init --yes
docs-harness schema
docs-harness schema --command write
docs-harness insight packages/api
docs-harness show packages/api/AGENTS
docs-harness validate
docs-harness types list
docs-harness types describe runbook
docs-harness write --type runbook --path packages/api --name deploy --description "Deploy the API." --body @runbook.md --dry-run
docs-harness skills read core
```

Success envelope:

```json
{ "ok": true, "data": {} }
```

Failure envelope:

```json
{
  "ok": false,
  "error": {
    "type": "validation",
    "message": "Missing required argument: name.",
    "hint": "Run docs-harness show <name>."
  }
}
```

## Project Setup

Run `docs-harness init` in a project root. It creates `.docs-harness/config.json`,
writes project-local registry defaults, and injects a managed docs-harness block
into the root route file.

Agent selection controls the route filename. The default is Codex:

- no `--agent`, or `--agent codex`, uses `AGENTS.md`
- `--agent claude` uses `CLAUDE.md`

Use `--dry-run` to preview changes. Use `--yes` to apply writes.

```bash
docs-harness init --dry-run
docs-harness init --agent claude --yes
```

The initial registry lives under `.docs-harness/registry/`. Document type
contracts are written to `.docs-harness/registry/document-types.json` on first
init and are not overwritten when init is run again.

## Document Relations

Instruction files can expose document graph entries with this Markdown line format:

```markdown
- [agent-index] name="packages/api/AGENTS" description="Modify backend APIs or troubleshoot API behavior."
```

Then agents can discover and read project documents without guessing paths:

```bash
docs-harness insight packages/api
docs-harness show packages/api/AGENTS
docs-harness validate
```

`write` maintains these relation lines by default. It finds the nearest ancestor
route file, then adds or updates one entry using the document metadata:

```markdown
---
name: packages/api/docs/runbook/deploy
description: Deploy the API.
---
```

becomes:

```markdown
- [agent-index] name="packages/api/docs/runbook/deploy" description="Deploy the API."
```

Use `--dry-run` to preview both the document write and the route entry write.
Use `--no-route-entry` only for explicit unlinked drafts or migration steps.

## Document Types

`types` exposes document type contracts. After init, projects can override or add
types by editing `.docs-harness/registry/document-types.json`. Before init, the
CLI falls back to its bundled defaults.

```bash
docs-harness types list
docs-harness types describe runbook
```

`write` uses the selected type contract to calculate the target path, validate
required headings and metadata, maintain the nearest ancestor route entry, and
write only after confirmation.

```bash
docs-harness write --type readme --path packages/api --description "Understand the API package." --body @README.body.md --dry-run
docs-harness write --type route --path packages/api --description "Discover API package docs." --body @AGENTS.body.md --yes
docs-harness write --type runbook --path packages/api --name deploy --description "Deploy the API." --body @deploy.md --yes
```

## Schema

`schema` is the machine-readable command contract. It is the default command
when no command is passed.

```bash
docs-harness schema
docs-harness schema --command write
```
