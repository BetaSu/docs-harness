import { dirname, join } from 'node:path';

import {
  getBooleanFlag,
  getStringFlag,
  requireNoUnknownFlags,
  type ParsedArgs,
} from '../lib/args.js';
import { loadRuntimeConfig } from '../lib/config.js';
import { getDocumentType, type DocumentTypeDefinition } from '../lib/document-types.js';
import { CliError } from '../lib/envelope.js';
import {
  assertInsideRoot,
  ensureDirectory,
  fileExists,
  isDirectory,
  readTextFile,
  resolvePath,
  toProjectPath,
  writeTextFile,
} from '../lib/files.js';
import {
  planRouteEntryMutation,
  shouldWriteRouteEntryMetadata,
  type RouteEntryPlan,
} from '../lib/route-entry.js';

type WriteAction = 'create' | 'noop' | 'update';
type WriteChangeKind = 'document' | 'routeEntry';

export type WriteData = {
  dryRun: boolean;
  valid: boolean;
  errors: string[];
  target: {
    type: string;
    path: string;
    name: string;
    description: string;
  };
  routeEntry: RouteEntryPlan;
  changes: Array<{
    kind: WriteChangeKind;
    path: string;
    action: WriteAction;
  }>;
};

type WritePlan = {
  data: WriteData;
  documentContent: string;
  routeContent?: string;
};

export async function commandWrite(root: string, args: ParsedArgs): Promise<WriteData> {
  requireNoUnknownFlags(args, [
    'body',
    'description',
    'dry-run',
    'name',
    'no-route-entry',
    'path',
    'root',
    'type',
    'yes',
  ]);

  const dryRun = getBooleanFlag(args, 'dry-run');
  const yes = getBooleanFlag(args, 'yes');
  const input = await parseWriteInput(root, args);
  const plan = await buildWritePlan(root, input, dryRun);

  if (!plan.data.valid && !dryRun) {
    throw new CliError({
      code: 'write_validation_failed',
      message: 'Document body does not satisfy the type contract.',
      hint: `${plan.data.errors[0] ?? 'Run `docs-harness types describe <type>`.'} For repair workflow, run \`docs-harness skills read document-repair\`.`,
    });
  }

  if (!dryRun && !yes && plan.data.changes.some((change) => change.action !== 'noop')) {
    throw new CliError({
      code: 'confirmation_required',
      message: 'write would update project files.',
      hint: 'Review `docs-harness write --dry-run`, then retry with `--yes`.',
      confirm: '--yes',
    });
  }

  if (!dryRun && yes && plan.data.valid) {
    await ensureDirectory(dirname(resolvePath(root, plan.data.target.path)));
    await writeTextFile(resolvePath(root, plan.data.target.path), plan.documentContent);
    if (plan.routeContent && plan.data.routeEntry.route) {
      await writeTextFile(resolvePath(root, plan.data.routeEntry.route), plan.routeContent);
    }
  }

  return plan.data;
}

async function parseWriteInput(
  root: string,
  args: ParsedArgs,
): Promise<{
  body: string;
  content: string;
  description: string;
  name: string;
  targetPath: string;
  targetName: string;
  topicPath: string;
  type: DocumentTypeDefinition;
  routeEntryEnabled: boolean;
  routeFileName: string;
}> {
  const typeName = getStringFlag(args, 'type') || args.positionals[0] || '';
  const type = typeName ? await getDocumentType(root, typeName) : undefined;
  if (!type) {
    throw new CliError({
      code: 'document_type_not_found',
      message: `Missing or unknown document type: ${typeName || '<missing>'}.`,
      hint: 'Run `docs-harness types list`.',
    });
  }

  const topicPath = resolveTopicPath(root, getStringFlag(args, 'path') || '.');
  const name = getStringFlag(args, 'name');
  const description = getStringFlag(args, 'description').trim();
  const body = normalizeBody(await readBody(root, getStringFlag(args, 'body')));
  const runtimeConfig = await loadRuntimeConfig(root);
  const targetPath = resolveTargetPath(topicPath, type, name, runtimeConfig.instructionFileName);
  const targetName = targetPath.replace(/\.md$/, '');
  const routeEntryEnabled = !getBooleanFlag(args, 'no-route-entry');
  const shouldWriteMetadata = shouldDocumentHaveMetadata({
    routeEntryEnabled,
    routeFileName: runtimeConfig.instructionFileName,
    targetPath,
    type,
  });
  const content = buildDocumentContent(shouldWriteMetadata, targetName, description, body);

  return {
    body,
    content,
    description,
    name,
    targetName,
    targetPath,
    topicPath,
    type,
    routeEntryEnabled,
    routeFileName: runtimeConfig.instructionFileName,
  };
}

async function buildWritePlan(
  root: string,
  input: {
    body: string;
    content: string;
    description: string;
    name: string;
    routeEntryEnabled: boolean;
    routeFileName: string;
    targetPath: string;
    targetName: string;
    topicPath: string;
    type: DocumentTypeDefinition;
  },
  dryRun: boolean,
): Promise<WritePlan> {
  const errors = await validateWriteInput(root, input);
  const action = await planWriteAction(root, input.targetPath, input.content);
  const routeMutation =
    errors.length > 0
      ? {
          data: {
            enabled: input.routeEntryEnabled,
            name: input.targetName,
            description: input.description,
            action: 'skipped' as const,
          },
        }
      : await planRouteEntryMutation(root, {
          description: input.description,
          enabled: input.routeEntryEnabled,
          routeFileName: input.routeFileName,
          targetName: input.targetName,
          targetPath: input.targetPath,
          typeName: input.type.name,
        });
  const changes: WriteData['changes'] = [
    { kind: 'document', path: input.targetPath, action },
  ];
  if (routeMutation.data.route) {
    changes.push({
      kind: 'routeEntry',
      path: routeMutation.data.route,
      action: routeMutation.data.action === 'add' || routeMutation.data.action === 'update' ? 'update' : 'noop',
    });
  }

  return {
    data: {
      dryRun,
      valid: errors.length === 0,
      errors,
      target: {
        type: input.type.name,
        path: input.targetPath,
        name: input.targetName,
        description: input.description,
      },
      routeEntry: routeMutation.data,
      changes,
    },
    documentContent: input.content,
    routeContent:
      routeMutation.data.action === 'add' || routeMutation.data.action === 'update'
        ? routeMutation.content
        : undefined,
  };
}

async function validateWriteInput(
  root: string,
  input: {
    body: string;
    description: string;
    name: string;
    routeEntryEnabled: boolean;
    routeFileName: string;
    targetPath: string;
    topicPath: string;
    type: DocumentTypeDefinition;
  },
): Promise<string[]> {
  const errors: string[] = [];
  const { type } = input;

  if (!input.body) errors.push('`--body` is required.');
  if (type.requiresName && !input.name) errors.push(`type "${type.name}" requires \`--name\`.`);
  if (type.requiresName && input.name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.name)) {
    errors.push('`--name` must be kebab-case.');
  }
  if (type.requiresDescription && !input.description) {
    errors.push(`type "${type.name}" requires \`--description\`.`);
  }
  if (shouldDocumentHaveMetadata(input) && !input.description) {
    errors.push(`type "${type.name}" writes a route entry and requires \`--description\`.`);
  }
  if (shouldDocumentHaveMetadata(input) && input.description.includes('"')) {
    errors.push('`--description` must not contain double quotes.');
  }
  if (/^---\n/.test(input.body.trimStart())) {
    errors.push('`--body` must not include frontmatter; docs-harness writes metadata.');
  }

  const lineCount = input.body.split('\n').length;
  if (lineCount > type.hardLineLimit) {
    errors.push(`type "${type.name}" hard line limit exceeded: ${lineCount}/${type.hardLineLimit}.`);
  }

  const runtimeConfig = await loadRuntimeConfig(root);
  if (type.requiresReadme && !fileExists(resolvePath(root, joinTopicPath(input.topicPath, 'README.md')))) {
    errors.push(`type "${type.name}" requires a sibling README.md for the complete functional entity.`);
  }
  if (
    type.requiresRoute &&
    !fileExists(resolvePath(root, joinTopicPath(input.topicPath, runtimeConfig.instructionFileName)))
  ) {
    errors.push(
      `type "${type.name}" requires a sibling ${runtimeConfig.instructionFileName} for the complete functional entity.`,
    );
  }

  return errors;
}

async function planWriteAction(
  root: string,
  targetPath: string,
  content: string,
): Promise<WriteAction> {
  const absoluteTargetPath = resolvePath(root, targetPath);
  if (!fileExists(absoluteTargetPath)) return 'create';
  const existing = await readTextFile(absoluteTargetPath);
  return existing === content ? 'noop' : 'update';
}

function resolveTopicPath(root: string, rawPath: string): string {
  const absolutePath = resolvePath(root, rawPath || '.');
  assertInsideRoot(root, absolutePath, rawPath || '.');
  const topicPath = toProjectPath(root, absolutePath);

  if (looksLikeMarkdownDocumentPath(topicPath)) {
    throw new CliError({
      code: 'path_not_directory',
      message: `\`--path\` must be a complete functional entity directory, not a document file path: ${rawPath}.`,
      hint: buildDocumentPathHint(topicPath),
    });
  }

  if (fileExists(absolutePath) && !isDirectory(absolutePath)) {
    throw new CliError({
      code: 'path_not_directory',
      message: `\`--path\` must be a directory: ${rawPath}.`,
      hint: 'Pass the complete functional entity directory to `--path`; docs-harness chooses the document file path from `--type` and `--name`.',
    });
  }
  return topicPath;
}

function looksLikeMarkdownDocumentPath(path: string): boolean {
  return path.endsWith('.md');
}

function buildDocumentPathHint(path: string): string {
  const match = /^(?<topic>.+)\/docs\/(?<type>[^/]+)\/(?<name>[^/]+)\.md$/.exec(path);
  if (match?.groups) {
    return [
      '`--path` is the complete functional entity directory.',
      `Pass \`--path ${match.groups.topic}\` and \`--name ${match.groups.name}\`; docs-harness will place the ${match.groups.type} document under that entity's docs directory.`,
    ].join(' ');
  }

  return 'Pass the complete functional entity directory to `--path`; docs-harness chooses the document file path from `--type` and `--name`.';
}

function resolveTargetPath(
  topicPath: string,
  type: DocumentTypeDefinition,
  name: string,
  instructionFileName: string,
): string {
  const rawPath = type.pathPattern
    .replaceAll('{instructionFile}', instructionFileName)
    .replaceAll('{type}', type.name)
    .replaceAll('{name}', name || '<missing>');
  return joinTopicPath(topicPath, rawPath);
}

function buildDocumentContent(
  shouldWriteMetadata: boolean,
  targetName: string,
  description: string,
  body: string,
): string {
  if (shouldWriteMetadata) {
    return [
      '---',
      `name: ${targetName}`,
      `description: ${description}`,
      '---',
      '',
      body,
      '',
    ].join('\n');
  }

  return `${body}\n`;
}

async function readBody(root: string, input: string): Promise<string> {
  if (!input) return '';
  if (!input.startsWith('@')) return input;
  const bodyPath = resolvePath(root, input.slice(1));
  assertInsideRoot(root, bodyPath, input);
  return readTextFile(bodyPath);
}

function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, '\n').trim();
}

function joinTopicPath(topicPath: string, path: string): string {
  return topicPath === '.' ? path : join(topicPath, path).replace(/\\/g, '/');
}

function shouldDocumentHaveMetadata(input: {
  description?: string;
  routeEntryEnabled: boolean;
  routeFileName: string;
  targetPath: string;
  type: DocumentTypeDefinition;
}): boolean {
  return (
    input.type.requiresDescription ||
    input.type.requiresName ||
    Boolean(input.description) ||
    shouldWriteRouteEntryMetadata({
      enabled: input.routeEntryEnabled,
      routeFileName: input.routeFileName,
      targetPath: input.targetPath,
      typeName: input.type.name,
    })
  );
}
