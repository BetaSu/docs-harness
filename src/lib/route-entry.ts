import { dirname, join } from 'node:path';

import { CliError } from './envelope.js';
import { fileExists, readTextFile, resolvePath, toProjectPath } from './files.js';

export type RouteEntryAction = 'add' | 'noop' | 'skipped' | 'update';

export type RouteEntryPlan = {
  enabled: boolean;
  route?: string;
  name: string;
  description: string;
  action: RouteEntryAction;
};

export type RouteEntryMutationPlan = {
  data: RouteEntryPlan;
  content?: string;
};

const RELATION_PREFIX = '- [agent-index]';
const ATTRIBUTE_PATTERN = /([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g;
const DOCUMENT_GRAPH_HEADING = '文档图入口';

export async function planRouteEntryMutation(
  root: string,
  input: {
    description: string;
    enabled: boolean;
    routeFileName: string;
    targetName: string;
    targetPath: string;
    typeName: string;
  },
): Promise<RouteEntryMutationPlan> {
  if (!input.enabled || shouldSkipRouteEntry(input.targetPath, input.typeName, input.routeFileName)) {
    return {
      data: {
        enabled: input.enabled,
        name: input.targetName,
        description: input.description,
        action: 'skipped',
      },
    };
  }

  const route = await findNearestWritableRoute(root, input.targetPath, input.typeName, input.routeFileName);
  const content = await readTextFile(resolvePath(root, route));
  const mutation = mutateRouteEntry(content, {
    name: input.targetName,
    description: input.description,
    route,
  });

  return {
    data: {
      enabled: true,
      route,
      name: input.targetName,
      description: input.description,
      action: mutation.action,
    },
    content: mutation.content,
  };
}

export function shouldWriteRouteEntryMetadata(input: {
  enabled: boolean;
  routeFileName: string;
  targetPath: string;
  typeName: string;
}): boolean {
  return input.enabled && !shouldSkipRouteEntry(input.targetPath, input.typeName, input.routeFileName);
}

async function findNearestWritableRoute(
  root: string,
  targetPath: string,
  typeName: string,
  routeFileName: string,
): Promise<string> {
  let current = resolvePath(root, targetPath);

  if (typeName === 'route') {
    const routeDirectory = dirname(current);
    if (toProjectPath(root, routeDirectory) === '.') {
      throwNoRoute(root, targetPath, routeFileName);
    }
    current = dirname(routeDirectory);
  } else {
    current = dirname(current);
  }

  while (true) {
    const candidate = join(current, routeFileName);
    if (fileExists(candidate)) return toProjectPath(root, candidate);
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throwNoRoute(root, targetPath, routeFileName);
}

function throwNoRoute(root: string, targetPath: string, routeFileName: string): never {
  throw new CliError({
    type: 'not_found',
    message: `No ancestor ${routeFileName} found for document: ${toProjectPath(root, targetPath)}.`,
    hint: 'Run docs-harness init --dry-run, create the needed route, or pass --no-route-entry.',
  });
}

function shouldSkipRouteEntry(targetPath: string, typeName: string, routeFileName: string): boolean {
  if (typeName === 'readme' && targetPath === 'README.md') return true;
  if (typeName === 'route' && targetPath === routeFileName) return true;
  return false;
}

function mutateRouteEntry(
  content: string,
  input: { name: string; description: string; route: string },
): { action: Exclude<RouteEntryAction, 'skipped'>; content: string } {
  const lines = content.split('\n');
  const entries = parseRouteEntries(lines).filter((entry) => entry.attributes.name === input.name);

  if (entries.length > 1) {
    throw new CliError({
      type: 'validation',
      message: `Route contains duplicate entries for document: ${input.name}.`,
      hint: `Clean duplicate entries in ${input.route}, then retry docs-harness write.`,
    });
  }

  const entryLine = buildEntryLine(input.name, input.description);
  const [entry] = entries;
  if (entry) {
    if (entry.errors.length > 0) {
      throw new CliError({
        type: 'validation',
        message: `Route entry for ${input.name} has invalid agent-index syntax.`,
        hint: `Fix the entry in ${input.route} so it only has name and description attributes.`,
      });
    }

    if (entry.attributes.description === input.description) {
      return { action: 'noop', content };
    }

    lines[entry.index] = `${entry.indent}${entryLine}`;
    return { action: 'update', content: joinLines(lines) };
  }

  return { action: 'add', content: appendRouteEntry(content, entryLine) };
}

function parseRouteEntries(lines: string[]): Array<{
  attributes: Record<string, string>;
  errors: string[];
  indent: string;
  index: number;
}> {
  const entries: Array<{
    attributes: Record<string, string>;
    errors: string[];
    indent: string;
    index: number;
  }> = [];
  let isInsideFence = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      isInsideFence = !isInsideFence;
      return;
    }
    if (isInsideFence || !trimmed.startsWith(RELATION_PREFIX)) return;

    const rawAttributes = trimmed.slice(RELATION_PREFIX.length).trim();
    const { attributes, remainder } = parseAttributes(rawAttributes);
    const errors = validateAttributes(attributes, remainder);
    entries.push({
      attributes,
      errors,
      indent: line.match(/^\s*/)?.[0] ?? '',
      index,
    });
  });

  return entries;
}

function parseAttributes(rawAttributes: string): {
  attributes: Record<string, string>;
  remainder: string;
} {
  const attributes: Record<string, string> = {};
  let remainder = rawAttributes;
  let match = ATTRIBUTE_PATTERN.exec(rawAttributes);

  while (match) {
    attributes[match[1]] = match[2];
    remainder = remainder.replace(match[0], '').trim();
    match = ATTRIBUTE_PATTERN.exec(rawAttributes);
  }

  ATTRIBUTE_PATTERN.lastIndex = 0;
  return { attributes, remainder };
}

function validateAttributes(attributes: Record<string, string>, remainder: string): string[] {
  const errors: string[] = [];
  const allowedKeys = new Set(['description', 'name']);

  if (remainder) errors.push('unsupported_syntax');
  for (const key of Object.keys(attributes)) {
    if (!allowedKeys.has(key)) errors.push(`unsupported_attribute:${key}`);
  }
  if (!attributes.name) errors.push('missing_name');
  if (!attributes.description) errors.push('missing_description');

  return errors;
}

function buildEntryLine(name: string, description: string): string {
  return `${RELATION_PREFIX} name="${name}" description="${description}"`;
}

function appendRouteEntry(content: string, entryLine: string): string {
  const lines = content.split('\n');
  const sectionStart = lines.findIndex((line) => isDocumentGraphHeading(line));

  if (sectionStart >= 0) {
    let sectionEnd = lines.length;
    for (let index = sectionStart + 1; index < lines.length; index += 1) {
      if (/^#{1,6}\s+\S/.test(lines[index]?.trim() ?? '')) {
        sectionEnd = index;
        break;
      }
    }

    let insertIndex = sectionEnd;
    while (insertIndex > sectionStart + 1 && lines[insertIndex - 1]?.trim() === '') {
      insertIndex -= 1;
    }
    lines.splice(insertIndex, 0, entryLine);
    return joinLines(lines);
  }

  const base = content.endsWith('\n') ? content : `${content}\n`;
  return `${base}${base.endsWith('\n\n') ? '' : '\n'}${entryLine}\n`;
}

function isDocumentGraphHeading(line: string): boolean {
  return new RegExp(`^##\\s+${DOCUMENT_GRAPH_HEADING}\\s*$`).test(line.trim());
}

function joinLines(lines: string[]): string {
  const joined = lines.join('\n');
  return joined.endsWith('\n') ? joined : `${joined}\n`;
}
