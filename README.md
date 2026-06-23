# docs-harness

Agent-first project document graph CLI.

`docs-harness` is designed for coding agents. Commands print compact JSON envelopes by default.

```bash
npm install -g docs-harness
docs-harness init --dry-run
docs-harness init --yes
docs-harness schema
docs-harness schema --command write
docs-harness insight packages/api --intent "Fix failing API deploy"
docs-harness read packages/api/AGENTS --intent "Check API package maintenance notes"
docs-harness validate
docs-harness types list
docs-harness types describe runbook
docs-harness write --type runbook --path packages/api --name deploy --description "Use when deploying the API." --body @runbook.md --dry-run
docs-harness write --type runbook --path packages/api --name deploy --description "Use when deploying the API." --body @runbook.md --yes
```

`schema` returns public command contracts by default. Internal commands are used
by skill and maintenance workflows, and are intentionally hidden from the
default command list. Inspect them only when a workflow names one explicitly by
using `docs-harness schema --internal` or `docs-harness schema --command <id>`.

Success envelope:

```json
{ "ok": true, "data": {} }
```

Failure envelope:

```json
{
  "ok": false,
  "error": {
    "code": "missing_required_argument",
    "message": "Missing required argument: name.",
    "hint": "Run `docs-harness read <name>`."
  }
}
```

## Project Setup

Run `docs-harness init` in a project root. It creates `.docs-harness/config.json`,
writes project-local registry defaults, prepares `.docs-harness/logs/`, and
injects a managed docs-harness block into the root route file.

Agent selection controls the route filename. The default is generic:

- no `--agent`, or `--agent generic`, uses `AGENTS.md`
- `--agent claude` uses `CLAUDE.md`

Use `--dry-run` to preview changes. Use `--yes` to apply writes.

```bash
docs-harness init --dry-run
docs-harness init --agent claude --yes
```

The initial registry lives under `.docs-harness/registry/`. Document type
contracts are written to `.docs-harness/registry/document-types.json` on first
init and are not overwritten when init is run again.

`.docs-harness/config.json` also contains `ignore`, a gitignore-style adoption
boundary for Markdown files that are not ready for docs-harness management. The
default ignore list covers `.git/**`, `node_modules/**`, `dist/**`, `build/**`,
`coverage/**`, and `.docs-harness/logs/**`. Ignored Markdown is not scanned as a
target, cannot be read by stable name, does not produce `non_target_document`
signals, and does not participate in validation. If a route entry points to an
ignored document, validation reports `ignored_target_referenced` so the route and
ignore boundary cannot disagree silently.

## Local Packaging

Use the local packaging flow before publishing or testing an installable CLI:

```bash
npm run package:local
```

This cleans and builds `dist/`, runs the test suite, creates
`.pack/docs-harness-<version>.tgz`, installs that tarball into a temporary npm
prefix, and verifies the installed `docs-harness` binary.

To install the verified tarball on this machine:

```bash
npm run install:local
```

Runtime logs live under `.docs-harness/logs/<YYYY-MM-DD>/`. `runs.jsonl`
records CLI execution facts, and `signal.jsonl` records optimization signals
found during command execution: non-blocking document-effectiveness problems
that cannot be automatically repaired and require agent judgment. Generated logs
are ignored by `.docs-harness/.gitignore`.
Markdown files outside the stable target set are still scanned. They are not
readable by stable name unless converted into a route, README, or configured
typed document; graph or insight execution can emit a `non_target_document`
signal for later review. Use config `ignore` only for Markdown intentionally
outside the current adoption scope.

## Document Relations

Instruction files expose document graph entries with this Markdown line format:

```markdown
- [agent-index] name="packages/api/AGENTS" description="Use when modifying backend APIs or troubleshooting API behavior."
```

Then agents can discover and read project documents without guessing paths:

```bash
docs-harness insight packages/api
docs-harness read packages/api/AGENTS
docs-harness validate
```

Pass `--intent` to `insight` or `read` when the current task purpose is clear.
The intent does not affect command behavior; it is recorded in `runs.jsonl` for
later document-content correction.

`insight` returns the selected complete functional entity README description and
the route entries for that entity. If the requested path has no sibling route
file, `insight` falls back to the nearest ancestor entity and returns
`fallback=true` plus a
message explaining the fallback.

A small complete functional entity can be represented by a single `README.md`;
the parent or ancestor route may index that README directly. Add a sibling route
only when the entity needs multiple documents. When a complete functional entity
has both `README.md` and a route, the route should list the README plus the
deeper documents, and upstream routes should usually point to the entity route
instead of bypassing it with the README. Any ancestor route may point directly to
an important deep entity route; the graph only requires route reachability from
the root, not direct parent routing.

`validate` succeeds only when the document graph is valid. On success, it returns
`data.valid=true`. When validation fails, the command returns `ok:false` with
`error.code="validation_failed"` and structured `error.issues`. It checks graph
links, duplicate names, route entry syntax, ignored target references, indexed
description metadata, route-description drift, root-route reachability, route
cycles, and typed document hard line limits. It does not enforce typed document
headings during validate, because existing documents may be written in different
languages. Each issue includes a
`hint` field that should be usable by an agent. Blocking document graph, route,
metadata, and line-limit hints may point to internal repair workflows such as
`skills.read document-repair`.

Optimization signals in `.docs-harness/logs/<YYYY-MM-DD>/signal.jsonl`
represent non-blocking problems found during command execution that affect
document usefulness and need agent judgment rather than automatic repair. For
example, a README that is not discoverable from a reachable route can emit
`readme_unindexed` for later review instead of failing validation. Successful
`validate` runs write global optimization signals while keeping stdout focused on
hard validation issues only.

Signal, intent, and skill-reading commands are internal workflow commands. They
are not returned by default `schema` output, but their contracts are available
through `docs-harness schema --internal` for skills that need to consume those
logs.

Intent observations group by target `name`. Within each target, `usage` groups
repeated `description` and `intent` pairs. Use those groups with actual document
content and relevant source code to decide whether a document name, description,
route entry, content, or structure no longer matches how agents actually use the
document.

`write` maintains these relation lines by default. It finds the nearest ancestor
route file, then adds or updates one entry using the document metadata:

```markdown
---
name: packages/api/docs/runbook/deploy
description: Use when deploying the API.
---
```

becomes:

```markdown
- [agent-index] name="packages/api/docs/runbook/deploy" description="Use when deploying the API."
```

Document `description` is a read trigger, not a summary. In English, prefer
`Use when ...`; in other languages, use the equivalent task-oriented phrasing.
The document metadata description is canonical, and route entry descriptions
must match it exactly.

Use `--dry-run` to preview both the document write and the route entry write.
Use `--no-route-entry` only for explicit unlinked drafts or migration steps.

## Document Types

`types` exposes document type contracts. After init, projects can override or add
types by editing `.docs-harness/registry/document-types.json`. Before init, the
CLI falls back to its bundled defaults. The project-local registry path is the
only supported override location.

```bash
docs-harness types list
docs-harness types describe runbook
```

`write` uses the selected type contract to calculate the target path, validate
metadata, complete functional entity prerequisites, and hard line limits,
maintain the nearest ancestor route entry, and write only after confirmation.
Configured sections are generation guidance only; write and validate do not fail
when headings differ, including when the document is written in another language.

```bash
docs-harness write --type readme --path packages/api --description "Use when understanding the API package." --body @README.body.md --dry-run
docs-harness write --type route --path packages/api --description "Use when discovering API package docs." --body @AGENTS.body.md --yes
docs-harness write --type runbook --path packages/api --name deploy --description "Use when deploying the API." --body @deploy.md --yes
```

## Schema

`schema` is the machine-readable command contract. It is the default command
when no command is passed.

```bash
docs-harness schema
docs-harness schema --command write
docs-harness schema --internal
```

`help`, `--help`, and `-h` are aliases for `schema`.
