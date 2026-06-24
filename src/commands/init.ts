import { readdir } from "node:fs/promises";
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
  normalizePath,
  readTextFile,
  writeTextFile,
} from "../lib/files.js";
import {
  loadDocumentTypes,
  serializeBuiltinDocumentTypes,
} from "../lib/document-types.js";
import { buildDocumentTarget } from "../lib/document-graph.js";
import { createIgnoreMatcher, DEFAULT_IGNORE_PATTERNS } from "../lib/ignore.js";
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

type InitManagedMarkdown = {
  path: string;
  kind: string;
};

type InitSkipCandidate = {
  path: string;
  markdown: string[];
};

type InitImpact = {
  managedMarkdownCount: number;
  managedMarkdown: InitManagedMarkdown[];
  skipCandidates: InitSkipCandidate[];
  defaultSkippedMarkdown: Array<{ path: string }>;
};

export type InitData = {
  dryRun: boolean;
  agent: string;
  instructionFile: string;
  impact: InitImpact;
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
    ignore: DEFAULT_IGNORE_PATTERNS,
  };
  const routeContent = await buildRouteContent(root, target.instructionFile);
  const documentTypesContent = serializeBuiltinDocumentTypes();
  const impact = await buildInitImpact(root, target.instructionFile);
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
    impact,
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
## When To Read Docs

When starting work in a project area, entering a directory, modifying files, debugging behavior, or answering questions about a feature, discover relevant docs first:

\`\`\`bash
docs-harness insight [path] --intent "<why you need docs for this task>"
\`\`\`

When a returned index entry matches your task, or when you need authoritative details before changing code or docs, read it by name:

\`\`\`bash
docs-harness read <name> --intent "<why you need this document>"
\`\`\`

Do not derive file paths from \`name\` yourself. Commands return JSON envelopes by default: success is \`{"ok":true,"data":...}\`, failure is \`{"ok":false,"error":...}\`.

Lines shaped as \`- [agent-index] name="<name>" description="<description>"\` are document index entries:

- \`description\` explains when the document should be read; use "Use when ..." in English or an equivalent phrase in the document language
- \`name\` is the stable identifier of the target document

## When To Maintain Docs

When project code, requirements, configuration, workflows, or docs change, maintain the affected docs in the same task.

Before creating or updating docs, list available document types:

\`\`\`bash
docs-harness types list
\`\`\`

Preview the typed document write first:

\`\`\`bash
docs-harness write --type <type> --path <path> --name <name> --description "Use when ..." --body @body.md --dry-run
\`\`\`

If the planned document and route-entry changes match the actual project change, apply them:

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

async function buildInitImpact(
  root: string,
  instructionFile: "AGENTS.md" | "CLAUDE.md"
): Promise<InitImpact> {
  const documentTypes = await loadDocumentTypes(root);
  const targetableTypeNames = new Set(documentTypes.map((type) => type.name));
  const isDefaultSkipped = createIgnoreMatcher(DEFAULT_IGNORE_PATTERNS);
  const markdownFiles = await collectInitMarkdownFiles(root);
  const managedMarkdown: InitManagedMarkdown[] = [];
  const defaultSkippedMarkdown: Array<{ path: string }> = [];

  for (const path of markdownFiles) {
    if (isDefaultSkipped(path)) {
      defaultSkippedMarkdown.push({ path });
      continue;
    }

    const content = await readTextFile(join(root, path));
    const target = buildDocumentTarget(path, content, instructionFile, documentTypes);
    managedMarkdown.push({
      path,
      kind:
        target.kind === "route" || targetableTypeNames.has(target.kind)
          ? target.kind
          : "non_target",
    });
  }

  managedMarkdown.sort(compareByPath);
  defaultSkippedMarkdown.sort(compareByPath);

  return {
    managedMarkdownCount: managedMarkdown.length,
    managedMarkdown,
    skipCandidates: buildSkipCandidates(managedMarkdown.map((markdown) => markdown.path)),
    defaultSkippedMarkdown,
  };
}

async function collectInitMarkdownFiles(
  root: string,
  relativeDirectory = "."
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(join(root, relativeDirectory), { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relativePath =
      relativeDirectory === "."
        ? entry.name
        : normalizePath(join(relativeDirectory, entry.name));

    if (entry.isDirectory()) {
      if (relativePath === ".git") continue;
      files.push(...(await collectInitMarkdownFiles(root, relativePath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) files.push(relativePath);
  }

  return files.sort();
}

function buildSkipCandidates(markdownPaths: string[]): InitSkipCandidate[] {
  const pathsByParent = new Map<string, string[]>();
  for (const path of markdownPaths) {
    const parent = parentPath(path);
    pathsByParent.set(parent, [...(pathsByParent.get(parent) ?? []), path]);
  }

  const groupedPaths = new Set<string>();
  const candidates: InitSkipCandidate[] = [];
  for (const [parent, paths] of pathsByParent.entries()) {
    if (parent === "." || paths.length < 2) continue;
    const markdown = [...paths].sort();
    candidates.push({ path: parent, markdown });
    for (const path of markdown) groupedPaths.add(path);
  }

  for (const path of markdownPaths) {
    if (!groupedPaths.has(path)) candidates.push({ path, markdown: [path] });
  }

  return candidates.sort(compareByPath);
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "." : path.slice(0, index);
}

function compareByPath(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path);
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
