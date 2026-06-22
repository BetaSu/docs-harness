# Init Agent File Research

## Goal

Design `docs-harness init` without assuming every coding agent reads the same instruction file.

## Source Findings

- Trellis uses a platform registry instead of hard-coding every platform in `init`. The registry lives in `/Users/su/Documents/Trellis/packages/cli/src/types/ai-tools.ts` and `/Users/su/Documents/Trellis/packages/cli/src/configurators/index.ts`.
- Trellis maps CLI flags to platform IDs, platform IDs to managed paths, and platform IDs to configurator functions. This lets `init`, `update`, and `uninstall` share the same source of truth.
- Trellis does not rely on a single universal instruction file. It writes platform-native files:
  - Codex: `.agents/skills/`, `.codex/skills/`, `.codex/agents/`, `.codex/hooks/`, `.codex/config.toml`.
  - Claude Code: `.claude/commands/`, `.claude/skills/`, `.claude/agents/`, `.claude/hooks/`, `.claude/settings.json`.
  - Gemini CLI: `.gemini/commands/`, `.agents/skills/`, `.gemini/agents/`, `.gemini/hooks/`, `.gemini/settings.json`.
  - Cursor: `.cursor/commands/`, `.cursor/skills/`, `.cursor/agents/`, `.cursor/hooks/`, `.cursor/hooks.json`.
- Trellis still ships a root `AGENTS.md` managed block via `/Users/su/Documents/Trellis/packages/cli/src/templates/markdown/agents.md`. The block is explicitly bounded by `<!-- TRELLIS:START -->` and `<!-- TRELLIS:END -->`, and says edits inside may be overwritten.
- Trellis uses write modes (`ask`, `force`, `skip`, `append`) and records which files were actually written so update/uninstall can avoid treating pre-existing user files as owned templates.
- Trellis defaults are intentionally conservative: non-interactive `--yes` skips existing conflicting files unless `--force` is explicit.
- Codex reads `AGENTS.md` before work starts. It layers global guidance from the Codex home directory with project guidance, walks from project root to current directory, supports `AGENTS.override.md`, and lets users configure fallback filenames. Source: https://developers.openai.com/codex/guides/agents-md
- The AGENTS.md open format positions `AGENTS.md` as a predictable README for agents, supports nested files, and says the closest file wins when instructions conflict. Source: https://agents.md/
- Claude Code reads `CLAUDE.md`, not `AGENTS.md`. Its docs recommend creating `CLAUDE.md` that imports `AGENTS.md` when a repo already uses AGENTS.md. Project-level `CLAUDE.md` can live at `./CLAUDE.md` or `./.claude/CLAUDE.md`; imports use `@path/to/import`. Source: https://code.claude.com/docs/en/memory
- Gemini CLI uses `GEMINI.md` by default, loads context hierarchically, supports JIT directory context files, supports imports with `@file.md`, and can customize context file names through settings. Source: https://geminicli.com/docs/cli/gemini-md/
- Gemini Code Assist documents `GEMINI.md` for VS Code project/component scopes, while IntelliJ accepts either `GEMINI.md` or `AGENT.md` at the project root. Source: https://developers.google.com/gemini-code-assist/docs/use-agentic-chat-pair-programmer
- Cursor documents persistent rules, project/team/user rules, and AGENTS.md support. Source: https://cursor.com/docs/rules

## Design Implications

- docs-harness should copy the Trellis registry/configurator shape for init instead of implementing `if agent === ...` logic in one file.
- docs-harness should separate:
  - canonical shared instruction text,
  - platform-specific bridge files,
  - managed-path ownership/update tracking.
- init should produce a write plan first, then apply it only with explicit confirmation.
- `init` should not blindly write only `AGENTS.md`; it should choose an adapter for the target agent.
- The canonical docs-harness instruction content should live in one generated file under `.docs-harness/` so agent-specific files can import or point to it.
- Agent-facing files should be small bridge files or marker blocks, not full duplicated instruction content.
- `auto` should be conservative when multiple agent files exist. It should return a plan and require an explicit `--agent`.
- Symlink should not be the default because Windows symlink behavior is weaker; text import/bridge files are safer.
- `init` must be idempotent and marker-based, and should support `--dry-run` plus `--yes`.

## Candidate Init Model

Create:

```text
.docs-harness/
  config.json
  instructions.md
  state/
  cache/
```

Then use an agent adapter:

| Agent | File to touch | Strategy |
| --- | --- | --- |
| codex | `AGENTS.md` plus optional `.agents/skills/docs-harness/SKILL.md` | Inject marker block that tells Codex to use `docs-harness`; install a skill only if we want auto-trigger guidance. |
| claude | `CLAUDE.md` or `.claude/CLAUDE.md` | Prefer a bridge with `@AGENTS.md` if AGENTS exists, then a Claude-specific marker block. Otherwise import `@.docs-harness/instructions.md`; Claude-native skills/commands can be a later adapter. |
| gemini | `GEMINI.md` | Bridge with `@.docs-harness/instructions.md`, or update Gemini settings if user explicitly requests custom context filenames. |
| cursor | `AGENTS.md` or `.cursor/rules/*.mdc` / `.cursor/skills` | Trellis uses `.cursor/commands`, `.cursor/skills`, `.cursor/agents`, and hooks. docs-harness likely starts smaller: `AGENTS.md` bridge first, Cursor-native rules later. |

## Recommended Init Architecture

- `src/init/platforms.ts`: registry of supported agents, flags, default detection files, managed paths, and adapter function.
- `src/init/planner.ts`: produces a list of file create/update/noop/conflict actions without writing.
- `src/init/writer.ts`: applies a plan with `skip` by default, `force` only when explicit.
- `src/init/templates/`: canonical docs-harness instruction template plus small platform bridge templates.
- `.docs-harness/manifest.json`: record docs-harness-owned files and hashes for future update/uninstall.
- `.docs-harness/state/`: runtime logs/receipts; ignored by default.

## Open Questions

- Should docs-harness canonical instructions be committed by default, or should only `.docs-harness/config.json` be committed while state/cache stay ignored?
- Should `init --agent codex` write into `AGENTS.md` directly or create `.docs-harness/instructions.md` plus a tiny AGENTS bridge?
- Should Cursor default to AGENTS.md for cross-agent compatibility or `.cursor/rules/docs-harness.mdc` for Cursor-native behavior?
- Should docs-harness support platform-native skills/commands in v0.1, or keep v0.1 to instruction-file bridges only?
