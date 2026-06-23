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
const DOCUMENT_GRAPH_HEADING = 'Document Graph Entries';
const START_MARKER = '<!-- docs-harness:START -->';
const END_MARKER = '<!-- docs-harness:END -->';

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
  _typeName: string,
  routeFileName: string,
): Promise<string> {
  let current = resolvePath(root, targetPath);

  if (targetPath === routeFileName || targetPath.endsWith(`/${routeFileName}`)) {
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
    code: 'route_not_found',
    message: `No ancestor ${routeFileName} found for document: ${toProjectPath(root, targetPath)}.`,
    hint: 'Run `docs-harness init --dry-run`, create the needed route, or pass `--no-route-entry`. For repair workflow, run `docs-harness skills read document-repair`.',
  });
}

function shouldSkipRouteEntry(targetPath: string, _typeName: string, routeFileName: string): boolean {
  if (targetPath === 'README.md') return true;
  if (targetPath === routeFileName) return true;
  return false;
}

function mutateRouteEntry(
  content: string,
  input: { name: string; description: string; route: string },
): { action: Exclude<RouteEntryAction, 'skipped'>; content: string } {
  const normalizedContent = ensureManagedDocumentGraphSection(content);
  let lines = normalizedContent.split('\n');
  const entries = parseRouteEntries(lines).filter((entry) => entry.attributes.name === input.name);

  if (entries.length > 1) {
    throw new CliError({
      code: 'duplicate_route_entry',
      message: `Route contains duplicate entries for document: ${input.name}.`,
      hint: `Clean duplicate entries in \`${input.route}\`, then retry \`docs-harness write\`. For repair workflow, run \`docs-harness skills read document-repair\`.`,
    });
  }

  const entryLine = buildEntryLine(input.name, input.description);
  const [entry] = entries;
  if (entry) {
    if (entry.errors.length > 0) {
      throw new CliError({
        code: 'invalid_route_entry',
        message: `Route entry for ${input.name} has invalid agent-index syntax.`,
        hint: `Fix the entry in \`${input.route}\` so it only has \`name\` and \`description\` attributes. For repair workflow, run \`docs-harness skills read document-repair\`.`,
      });
    }

    if (entry.inGraphSection && entry.attributes.description === input.description) {
      return {
        action: normalizedContent === content ? 'noop' : 'update',
        content: normalizedContent,
      };
    }

    if (entry.inGraphSection) {
      lines[entry.index] = `${entry.indent}${entryLine}`;
      return { action: 'update', content: joinLines(lines) };
    }

    lines.splice(entry.index, 1);
    lines = insertRouteEntry(lines, entryLine);
    return { action: 'update', content: joinLines(lines) };
  }

  return { action: 'add', content: joinLines(insertRouteEntry(lines, entryLine)) };
}

function parseRouteEntries(lines: string[]): Array<{
  attributes: Record<string, string>;
  errors: string[];
  inGraphSection: boolean;
  indent: string;
  index: number;
}> {
  const entries: Array<{
    attributes: Record<string, string>;
    errors: string[];
    inGraphSection: boolean;
    indent: string;
    index: number;
  }> = [];
  const managedBlock = findManagedBlock(lines);
  const graphSection = managedBlock
    ? findDocumentGraphSection(lines, managedBlock.start + 1, managedBlock.end)
    : undefined;
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
      inGraphSection: graphSection ? index > graphSection.start && index < graphSection.end : false,
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

function ensureManagedDocumentGraphSection(content: string): string {
  let lines = content.split('\n');
  const managedBlock = findManagedBlock(lines);
  if (managedBlock) {
    if (!findDocumentGraphSection(lines, managedBlock.start + 1, managedBlock.end)) {
      const insert = buildDocumentGraphSectionLines();
      const prefix = managedBlock.end > managedBlock.start + 1 && lines[managedBlock.end - 1]?.trim()
        ? ['']
        : [];
      lines.splice(managedBlock.end, 0, ...prefix, ...insert);
    }
    return joinLines(moveRouteEntriesIntoManagedBlock(lines));
  }

  const legacySection = findDocumentGraphSection(lines, 0, lines.length);
  if (legacySection) {
    const sectionLines = trimOuterBlankLines(lines.slice(legacySection.start, legacySection.end));
    lines.splice(legacySection.start, legacySection.end - legacySection.start, ...[
      START_MARKER,
      ...sectionLines,
      END_MARKER,
    ]);
    return joinLines(lines);
  }

  const blockLines = [START_MARKER, ...buildDocumentGraphSectionLines(), END_MARKER];
  const insert = content.trim() ? ['', ...blockLines] : blockLines;
  lines = trimTrailingBlankLines(lines);
  lines.push(...insert);
  return joinLines(lines);
}

function moveRouteEntriesIntoManagedBlock(lines: string[]): string[] {
  const managedBlock = findManagedBlock(lines);
  const graphSection = managedBlock
    ? findDocumentGraphSection(lines, managedBlock.start + 1, managedBlock.end)
    : undefined;
  if (!managedBlock || !graphSection) return lines;

  const movedEntries: string[] = [];
  let isInsideFence = false;
  const filtered = lines.filter((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      isInsideFence = !isInsideFence;
      return true;
    }
    const isInsideManagedBlock = index > managedBlock.start && index < managedBlock.end;
    if (!isInsideFence && !isInsideManagedBlock && trimmed.startsWith(RELATION_PREFIX)) {
      movedEntries.push(trimmed);
      return false;
    }
    return true;
  });
  if (movedEntries.length === 0) return lines;

  const nextBlock = findManagedBlock(filtered);
  const nextSection = nextBlock
    ? findDocumentGraphSection(filtered, nextBlock.start + 1, nextBlock.end)
    : undefined;
  if (!nextSection) return filtered;

  let insertIndex = nextSection.end;
  while (insertIndex > nextSection.start + 1 && filtered[insertIndex - 1]?.trim() === '') {
    insertIndex -= 1;
  }
  filtered.splice(insertIndex, 0, ...movedEntries);
  return filtered;
}

function insertRouteEntry(lines: string[], entryLine: string): string[] {
  const managedBlock = findManagedBlock(lines);
  if (!managedBlock) return lines;
  let graphSection = findDocumentGraphSection(lines, managedBlock.start + 1, managedBlock.end);
  if (!graphSection) {
    lines.splice(managedBlock.end, 0, ...buildDocumentGraphSectionLines());
    const nextBlock = findManagedBlock(lines);
    graphSection = nextBlock
      ? findDocumentGraphSection(lines, nextBlock.start + 1, nextBlock.end)
      : undefined;
  }
  if (!graphSection) return lines;

  let insertIndex = graphSection.end;
  while (insertIndex > graphSection.start + 1 && lines[insertIndex - 1]?.trim() === '') {
    insertIndex -= 1;
  }
  lines.splice(insertIndex, 0, entryLine);
  return lines;
}

function findManagedBlock(lines: string[]): { start: number; end: number } | undefined {
  const start = lines.findIndex((line) => line.trim() === START_MARKER);
  if (start < 0) return undefined;
  const relativeEnd = lines.slice(start + 1).findIndex((line) => line.trim() === END_MARKER);
  if (relativeEnd < 0) return undefined;
  return { start, end: start + 1 + relativeEnd };
}

function findDocumentGraphSection(
  lines: string[],
  start: number,
  end: number,
): { start: number; end: number } | undefined {
  for (let index = start; index < end; index += 1) {
    if (!isDocumentGraphHeading(lines[index] ?? '')) continue;
    let sectionEnd = end;
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      if (/^#{1,6}\s+\S/.test(lines[cursor]?.trim() ?? '')) {
        sectionEnd = cursor;
        break;
      }
    }
    return { start: index, end: sectionEnd };
  }
  return undefined;
}

function buildDocumentGraphSectionLines(): string[] {
  return [`## ${DOCUMENT_GRAPH_HEADING}`, ''];
}

function isDocumentGraphHeading(line: string): boolean {
  return new RegExp(`^##\\s+${DOCUMENT_GRAPH_HEADING}\\s*$`).test(line.trim());
}

function trimOuterBlankLines(lines: string[]): string[] {
  return trimTrailingBlankLines(trimLeadingBlankLines(lines));
}

function trimLeadingBlankLines(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && !lines[start]?.trim()) start += 1;
  return lines.slice(start);
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && !lines[end - 1]?.trim()) end -= 1;
  return lines.slice(0, end);
}

function joinLines(lines: string[]): string {
  const joined = lines.join('\n');
  return joined.endsWith('\n') ? joined : `${joined}\n`;
}
