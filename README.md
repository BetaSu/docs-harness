---
name: README
description: Use when understanding project overview, directory responsibilities, or basic usage.
---

# docs-harness

English | [中文](./README.zh-CN.md)

docs-harness is an agent-native project documentation management tool. It helps
agents reliably discover, read, validate, and continuously maintain project
documentation.

## Usage

Copy this prompt to your agent:

```text
Install docs-harness first:

npm i -g docs-harness

Then run this in the target project:

docs-harness skills read agent-init

Read the returned content and follow that workflow to initialize docs-harness,
confirm the document management scope, validate the document graph, and repair
any document issues.
```

## Project Characteristics

docs-harness is designed for agents, not as a traditional human-facing
documentation site.

This means the agent can take over project documentation the same way it takes
over project code: creating, reading, updating, moving, and deleting documents
as part of normal project work. Instead of asking humans which Markdown file to
read, the agent uses the docs-harness document protocol to discover, read,
validate, and maintain the right project documents.

During adoption, docs-harness first asks the agent to confirm which Markdown
files should enter the managed documentation scope. Documents inside that scope
can later be updated, migrated, split, deleted, or indexed by the agent.
Documents that are not ready to be managed can be skipped for now and brought
under management later.

## How It Works

docs-harness organizes project documentation as a document graph.

When an agent discovers that a module is a complete independent function, it can
create a `README.md` for that function and a route file that distributes the
document index for that function. A module can be a package, module, service,
subsystem, or even the entire project.

The route file depends on the agent type:

- Claude uses `CLAUDE.md`
- Other agents use `AGENTS.md`

Routes from different independent functions connect to each other and form the
project documentation graph. When agents discover, read, update, or validate
documents, they follow this graph instead of guessing Markdown file paths.

### Reading

Agents use `insight` to understand which documents are relevant to the current
location.

`insight` returns the current function's README description and the document
index from its route. The agent uses those entries to decide which documents are
relevant to the task, then reads the full document by stable name.

### Writing

docs-harness writes documents through document types.

Each document type has a clear role, such as function README, route, runbook,
architecture note, or long-lived constraint. Before writing, the agent reads the
current project's document type configuration and chooses the type that matches
the task.

If the built-in document types do not fit your project, ask the agent to define
new types or update existing ones for you.

### Automatic Maintenance

During daily document reads and writes, docs-harness collects improvement
signals.

These signals represent document friction discovered during real use, such as a
document that is not indexed correctly, a description that no longer matches how
the document is used, or content that is too large for its role. A recurring
maintenance loop can run `schedule-document-quality-maintenance` to process
these signals and keep documentation quality aligned with the actual project.

## CLI Commands

docs-harness is an AI-native CLI; agents know which CLI command to run for each
document task, and humans do not need to learn the command surface.
