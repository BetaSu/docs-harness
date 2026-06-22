import { join } from 'node:path';

import {
  getBooleanFlag,
  getStringFlag,
  requireNoUnknownFlags,
  type ParsedArgs,
} from '../lib/args.js';
import { CliError } from '../lib/envelope.js';
import {
  ensureDirectory,
  fileExists,
  readTextFile,
  writeTextFile,
} from '../lib/files.js';
import { serializeBuiltinDocumentTypes } from '../lib/document-types.js';
import {
  getConfigPath,
  getHarnessDirectory,
  getRegistryDirectory,
  type AgentKind,
  type HarnessConfig,
} from '../lib/project.js';

const START_MARKER = '<!-- docs-harness:START -->';
const END_MARKER = '<!-- docs-harness:END -->';

type InitTarget = {
  agent: AgentKind;
  instructionFile: 'AGENTS.md' | 'CLAUDE.md';
};

type InitChange = {
  path: string;
  action: 'create' | 'update' | 'noop';
};

export type InitData = {
  dryRun: boolean;
  agent: string;
  instructionFile: string;
  changes: InitChange[];
};

export async function commandInit(root: string, args: ParsedArgs): Promise<InitData> {
  requireNoUnknownFlags(args, ['agent', 'dry-run', 'yes', 'root']);

  const dryRun = getBooleanFlag(args, 'dry-run');
  const yes = getBooleanFlag(args, 'yes');
  const target = resolveInitTarget(parseAgent(getStringFlag(args, 'agent') || 'codex'));
  const config: HarnessConfig = {
    version: 1,
    agent: target.agent,
    instructionFile: target.instructionFile,
  };
  const routeContent = await buildRouteContent(root, target.instructionFile);
  const documentTypesContent = serializeBuiltinDocumentTypes();
  const changes = await planInit(root, config, routeContent, documentTypesContent);

  if (!dryRun && !yes && changes.some((change) => change.action !== 'noop')) {
    throw new CliError({
      type: 'confirmation_required',
      message: 'init would update project files.',
      hint: 'Review docs-harness init --dry-run, then retry with --yes.',
      confirm: '--yes',
    });
  }

  if (!dryRun && yes) await applyInit(root, config, routeContent, documentTypesContent);

  return {
    dryRun,
    agent: target.agent,
    instructionFile: target.instructionFile,
    changes,
  };
}

function parseAgent(value: string): AgentKind {
  if (value === 'claude' || value === 'codex') return value;

  throw new CliError({
    type: 'validation',
    message: `Unknown agent: ${value}.`,
    hint: 'Use --agent codex or --agent claude.',
  });
}

function resolveInitTarget(agent: AgentKind): InitTarget {
  if (agent === 'claude') return { agent, instructionFile: 'CLAUDE.md' };
  return { agent: 'codex', instructionFile: 'AGENTS.md' };
}

async function buildRouteContent(
  root: string,
  instructionFile: 'AGENTS.md' | 'CLAUDE.md',
): Promise<string> {
  const routePath = join(root, instructionFile);
  const existing = fileExists(routePath) ? await readTextFile(routePath) : '';
  const block = buildManagedBlock(root, instructionFile);
  const existingBlock = extractManagedBlock(existing);

  if (!existing.trim()) return `${block}\n`;
  if (existingBlock) return `${existing.replace(existingBlock, block).replace(/\s*$/, '\n')}`;
  return `${existing.replace(/\s*$/, '\n\n')}${block}\n`;
}

function buildManagedBlock(root: string, instructionFile: 'AGENTS.md' | 'CLAUDE.md'): string {
  const entries = buildInitialRootEntries(root);
  const entryText =
    entries.length > 0
      ? entries.join('\n')
      : '<!-- Add document graph entries here as docs are created. -->';

  return `${START_MARKER}
## 如何找到相关文档

当你进入任何路径，如果想了解该路径及其子目录有哪些相关文档，运行：

\`\`\`bash
docs-harness insight [path]
\`\`\`

需要读取文档全文时，运行：

\`\`\`bash
docs-harness show <name>
\`\`\`

不要根据 \`name\` 自己拼文件路径。所有命令默认返回 JSON envelope：成功为 \`{"ok":true,"data":...}\`，失败为 \`{"ok":false,"error":...}\`。

形如 \`- [agent-index] name="<name>" description="<description>"\` 的行表示一条文档索引：

- \`description\` 说明什么任务场景需要读取
- \`name\` 是目标文档的稳定标识

后续新增子目录文档节点时，在该子目录创建 \`${instructionFile}\`，并继续使用同样的 \`[agent-index]\` 行维护索引。

## 文档图入口

${entryText}

Managed by docs-harness. Edits outside this block are preserved.
${END_MARKER}`;
}

function buildInitialRootEntries(root: string): string[] {
  const entries: string[] = [];
  if (fileExists(join(root, 'README.md'))) {
    entries.push(
      '- [agent-index] name="README" description="了解项目概览、目录职责或基础使用方式时"',
    );
  }
  return entries;
}

async function planInit(
  root: string,
  config: HarnessConfig,
  routeContent: string,
  documentTypesContent: string,
): Promise<InitChange[]> {
  return [
    planDirectory(root, '.docs-harness'),
    await planFile(root, '.docs-harness/config.json', `${JSON.stringify(config, null, 2)}\n`),
    await planFile(root, '.docs-harness/.gitignore', 'state/\ncache/\n*.log\n'),
    planDirectory(root, '.docs-harness/registry'),
    planCreateFile(root, '.docs-harness/registry/document-types.json'),
    planDirectory(root, '.docs-harness/state'),
    planDirectory(root, '.docs-harness/cache'),
    await planFile(root, config.instructionFile, routeContent),
  ];
}

function planDirectory(root: string, path: string): InitChange {
  return {
    path,
    action: fileExists(join(root, path)) ? 'noop' : 'create',
  };
}

async function planFile(root: string, path: string, content: string): Promise<InitChange> {
  const absolutePath = join(root, path);
  if (!fileExists(absolutePath)) return { path, action: 'create' };
  const existing = await readTextFile(absolutePath);
  return {
    path,
    action: existing === content ? 'noop' : 'update',
  };
}

function planCreateFile(root: string, path: string): InitChange {
  return {
    path,
    action: fileExists(join(root, path)) ? 'noop' : 'create',
  };
}

async function applyInit(
  root: string,
  config: HarnessConfig,
  routeContent: string,
  documentTypesContent: string,
): Promise<void> {
  const harnessDirectory = getHarnessDirectory(root);
  await ensureDirectory(getRegistryDirectory(root));
  await ensureDirectory(join(harnessDirectory, 'state'));
  await ensureDirectory(join(harnessDirectory, 'cache'));
  await writeTextFile(getConfigPath(root), `${JSON.stringify(config, null, 2)}\n`);
  await writeTextFile(join(harnessDirectory, '.gitignore'), 'state/\ncache/\n*.log\n');
  const documentTypesPath = join(getRegistryDirectory(root), 'document-types.json');
  if (!fileExists(documentTypesPath)) await writeTextFile(documentTypesPath, documentTypesContent);
  await writeTextFile(join(root, config.instructionFile), routeContent);
}

function extractManagedBlock(content: string): string {
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);
  if (start < 0 || end < start) return '';
  return content.slice(start, end + END_MARKER.length);
}
