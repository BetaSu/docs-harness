import { join } from "node:path";

import {
  getBooleanFlag,
  getStringFlag,
  requireNoUnknownFlags,
  type ParsedArgs,
} from "../lib/args.js";
import { CliError } from "../lib/envelope.js";
import {
  ensureDirectory,
  fileExists,
  readTextFile,
  writeTextFile,
} from "../lib/files.js";
import { serializeBuiltinDocumentTypes } from "../lib/document-types.js";
import {
  getConfigPath,
  getHarnessDirectory,
  getLogsDirectory,
  getRegistryDirectory,
  type AgentKind,
  type HarnessConfig,
} from "../lib/project.js";

const START_MARKER = "<!-- docs-harness:START -->";
const END_MARKER = "<!-- docs-harness:END -->";
const HARNESS_GITIGNORE = "logs/\ncache/\n";

type InitTarget = {
  agent: AgentKind;
  instructionFile: "AGENTS.md" | "CLAUDE.md";
};

type InitChange = {
  path: string;
  action: "create" | "update" | "noop";
};

export type InitData = {
  dryRun: boolean;
  agent: string;
  instructionFile: string;
  changes: InitChange[];
};

export async function commandInit(
  root: string,
  args: ParsedArgs
): Promise<InitData> {
  requireNoUnknownFlags(args, ["agent", "dry-run", "yes", "root"]);

  const dryRun = getBooleanFlag(args, "dry-run");
  const yes = getBooleanFlag(args, "yes");
  const target = resolveInitTarget(
    parseAgent(getStringFlag(args, "agent") || "generic")
  );
  const config: HarnessConfig = {
    version: 1,
    agent: target.agent,
    instructionFile: target.instructionFile,
  };
  const routeContent = await buildRouteContent(root, target.instructionFile);
  const documentTypesContent = serializeBuiltinDocumentTypes();
  const changes = await planInit(
    root,
    config,
    routeContent,
    documentTypesContent
  );

  if (!dryRun && !yes && changes.some((change) => change.action !== "noop")) {
    throw new CliError({
      code: "confirmation_required",
      message: "init would update project files.",
      hint: "Review `docs-harness init --dry-run`, then retry with `--yes`.",
      confirm: "--yes",
    });
  }

  if (!dryRun && yes)
    await applyInit(root, config, routeContent, documentTypesContent);

  return {
    dryRun,
    agent: target.agent,
    instructionFile: target.instructionFile,
    changes,
  };
}

function parseAgent(value: string): AgentKind {
  if (value === "claude" || value === "generic") return value;

  throw new CliError({
    code: "unknown_agent",
    message: `Unknown agent: ${value}.`,
    hint: "Use `--agent generic` or `--agent claude`.",
  });
}

function resolveInitTarget(agent: AgentKind): InitTarget {
  if (agent === "claude") return { agent, instructionFile: "CLAUDE.md" };
  return { agent: "generic", instructionFile: "AGENTS.md" };
}

async function buildRouteContent(
  root: string,
  instructionFile: "AGENTS.md" | "CLAUDE.md"
): Promise<string> {
  const routePath = join(root, instructionFile);
  const existing = fileExists(routePath) ? await readTextFile(routePath) : "";
  const block = buildManagedBlock(root, instructionFile);
  const existingBlock = extractManagedBlock(existing);

  if (!existing.trim()) return `${block}\n`;
  if (existingBlock)
    return `${existing.replace(existingBlock, block).replace(/\s*$/, "\n")}`;
  return `${existing.replace(/\s*$/, "\n\n")}${block}\n`;
}

function buildManagedBlock(
  root: string,
  instructionFile: "AGENTS.md" | "CLAUDE.md"
): string {
  const entries = buildInitialRootEntries(root);
  const entryText =
    entries.length > 0
      ? entries.join("\n")
      : "<!-- Add document graph entries here as docs are created. -->";

  return `${START_MARKER}
## How To Find Relevant Docs

When entering any path, run this to discover relevant docs for that path and its children:

\`\`\`bash
docs-harness insight [path] --intent "<why you need docs for this task>"
\`\`\`

When you need the full document content, run:

\`\`\`bash
docs-harness read <name> --intent "<why you need this document>"
\`\`\`

Do not derive file paths from \`name\` yourself. Commands return JSON envelopes by default: success is \`{"ok":true,"data":...}\`, failure is \`{"ok":false,"error":...}\`.

Lines shaped as \`- [agent-index] name="<name>" description="<description>"\` are document index entries:

- \`description\` explains when the document should be read; use "Use when ..." in English or an equivalent phrase in the document language
- \`name\` is the stable identifier of the target document

## How To Add Or Update Docs

When adding or updating project docs, list available document types first:

\`\`\`bash
docs-harness types list
\`\`\`

Preview the typed document write first:

\`\`\`bash
docs-harness write --type <type> --path <path> --name <name> --description "Use when ..." --body @body.md --dry-run
\`\`\`

If the planned document and route-entry changes look correct, apply them:

\`\`\`bash
docs-harness write --type <type> --path <path> --name <name> --description "Use when ..." --body @body.md --yes
\`\`\`

## Document Graph Entries

${entryText}

Managed by docs-harness. Edits outside this block are preserved.
${END_MARKER}`;
}

function buildInitialRootEntries(root: string): string[] {
  const entries: string[] = [];
  if (fileExists(join(root, "README.md"))) {
    entries.push(
      '- [agent-index] name="README" description="Use when understanding project overview, directory responsibilities, or basic usage."'
    );
  }
  return entries;
}

async function planInit(
  root: string,
  config: HarnessConfig,
  routeContent: string,
  documentTypesContent: string
): Promise<InitChange[]> {
  return [
    planDirectory(root, ".docs-harness"),
    await planFile(
      root,
      ".docs-harness/config.json",
      `${JSON.stringify(config, null, 2)}\n`
    ),
    await planFile(root, ".docs-harness/.gitignore", HARNESS_GITIGNORE),
    planDirectory(root, ".docs-harness/registry"),
    planCreateFile(root, ".docs-harness/registry/document-types.json"),
    planDirectory(root, ".docs-harness/logs"),
    planDirectory(root, ".docs-harness/cache"),
    await planFile(root, config.instructionFile, routeContent),
  ];
}

function planDirectory(root: string, path: string): InitChange {
  return {
    path,
    action: fileExists(join(root, path)) ? "noop" : "create",
  };
}

async function planFile(
  root: string,
  path: string,
  content: string
): Promise<InitChange> {
  const absolutePath = join(root, path);
  if (!fileExists(absolutePath)) return { path, action: "create" };
  const existing = await readTextFile(absolutePath);
  return {
    path,
    action: existing === content ? "noop" : "update",
  };
}

function planCreateFile(root: string, path: string): InitChange {
  return {
    path,
    action: fileExists(join(root, path)) ? "noop" : "create",
  };
}

async function applyInit(
  root: string,
  config: HarnessConfig,
  routeContent: string,
  documentTypesContent: string
): Promise<void> {
  const harnessDirectory = getHarnessDirectory(root);
  await ensureDirectory(getRegistryDirectory(root));
  await ensureDirectory(getLogsDirectory(root));
  await ensureDirectory(join(harnessDirectory, "cache"));
  await writeTextFile(
    getConfigPath(root),
    `${JSON.stringify(config, null, 2)}\n`
  );
  await writeTextFile(join(harnessDirectory, ".gitignore"), HARNESS_GITIGNORE);
  const documentTypesPath = join(
    getRegistryDirectory(root),
    "document-types.json"
  );
  if (!fileExists(documentTypesPath))
    await writeTextFile(documentTypesPath, documentTypesContent);
  await writeTextFile(join(root, config.instructionFile), routeContent);
}

function extractManagedBlock(content: string): string {
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);
  if (start < 0 || end < start) return "";
  return content.slice(start, end + END_MARKER.length);
}
