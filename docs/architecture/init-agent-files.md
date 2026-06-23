---
name: docs/architecture/init-agent-files
description: Use when changing init behavior for generic or Claude agent files.
---

# Init Agent File Architecture

## Scope

This document covers the intended architecture for `docs-harness init` when it
creates or updates agent-facing instruction files. The design avoids assuming
that every coding agent reads the same file, while still keeping one canonical
docs-harness instruction model.

The immediate init agents are `generic` and `claude`. `generic` writes
`AGENTS.md` for agents that can consume that common route file, while `claude`
writes `CLAUDE.md`. The shape should still allow later platform-specific
adapters without moving init logic into one large conditional block.

## Structure

The init implementation should be split into these responsibilities:

- `src/init/platforms.ts`: registry of supported agents, flags, default
  detection files, managed paths, and adapter functions.
- `src/init/planner.ts`: produces create/update/noop/conflict actions without
  writing files.
- `src/init/writer.ts`: applies a plan with conservative defaults.
- `src/init/templates/`: shared docs-harness instruction template plus small
  platform bridge templates.
- `.docs-harness/manifest.json`: records docs-harness-owned files and hashes for
  future update or uninstall behavior.

The project-local `.docs-harness/` directory should hold durable configuration
and generated shared instructions. Agent-specific files should stay small and
act as bridges or marker blocks.

## Data Or Control Flow

Init should load the platform registry, resolve the requested agent, produce a
write plan, show that plan for dry runs, and only write when confirmation is
explicit.

The planned flow is:

1. Parse `--agent`, `--dry-run`, and confirmation flags.
2. Resolve the selected platform adapter from a registry.
3. Build a canonical docs-harness instruction artifact.
4. Ask the adapter which agent-facing files to create or update.
5. Produce a plan with create/update/noop/conflict actions.
6. Apply the plan only after explicit confirmation.

The adapter layer maps each agent to native files:

| Agent | File to touch | Strategy |
| --- | --- | --- |
| generic | `AGENTS.md` plus optional `.agents/skills/docs-harness/SKILL.md` | Inject a marker block that tells generic AGENTS.md-compatible agents to use `docs-harness`; install a skill only when auto-trigger guidance is needed. |
| claude | `CLAUDE.md` or `.claude/CLAUDE.md` | Prefer a bridge with `@AGENTS.md` if AGENTS exists, then add a Claude-specific marker block. |
| gemini | `GEMINI.md` | Bridge with `@.docs-harness/instructions.md`, or update Gemini settings only when the user requests custom context filenames. |
| cursor | `AGENTS.md` or `.cursor/rules/*.mdc` | Start with an AGENTS bridge for compatibility; Cursor-native rules can be added later. |

## Boundaries And Dependencies

The design follows these external findings:

- Trellis uses a platform registry instead of hard-coding every platform in
  `init`. It maps CLI flags to platform IDs, platform IDs to managed paths, and
  platform IDs to configurator functions.
- Trellis writes platform-native files for Codex, Claude Code, Gemini CLI, and
  Cursor while still supporting a root `AGENTS.md` managed block.
- Codex reads `AGENTS.md` before work starts and supports nested project
  guidance.
- Claude Code reads `CLAUDE.md` and supports importing other files with
  `@path/to/import`.
- Gemini CLI uses `GEMINI.md`, supports hierarchical context files, and supports
  imports.
- Cursor supports persistent rules, project/team/user rules, and AGENTS.md.

The implementation should stay conservative:

- Do not blindly write only `AGENTS.md`; choose an adapter for the target agent.
- Do not duplicate full instruction content into every agent file.
- Do not treat pre-existing user files as owned templates unless the manifest
  records ownership.
- Do not default to symlinks because Windows symlink behavior is weaker.
- Do not make `auto` silently choose when multiple agent files exist; return a
  plan and require an explicit `--agent`.

## Entry Points

Primary implementation entry points:

- `src/commands/init.ts`
- future `src/init/platforms.ts`
- future `src/init/planner.ts`
- future `src/init/writer.ts`
- future `src/init/templates/`

Related generated files:

- `.docs-harness/config.json`
- `.docs-harness/instructions.md`
- `.docs-harness/manifest.json`
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.cursor/rules/*.mdc`
