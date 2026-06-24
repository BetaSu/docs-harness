import { dirname, join } from 'node:path';

import { CliError } from './envelope.js';
import {
  assertInsideRoot,
  collectMarkdownFiles,
  fileExists,
  isDirectory,
  readTextFile,
  resolvePath,
  toProjectPath,
} from './files.js';
import { parseMetadata } from './markdown.js';
import { loadRuntimeConfig } from './config.js';
import { createIgnoreMatcher } from './ignore.js';
import {
  loadDocumentTypes,
  resolveDocumentTypePath,
  type DocumentTypeDefinition,
} from './document-types.js';

export type DocumentEntry = {
  name: string;
  description: string;
  source: string;
  line: number;
  target?: DocumentTarget;
  ignoredTarget?: IgnoredDocument;
  errors: string[];
};

export type DocumentTarget = {
  name: string;
  description: string;
  path: string;
  kind: string;
  content: string;
};

export type DocumentGraph = {
  documents: DocumentDocument[];
  entries: DocumentEntry[];
  ignoredDocuments: IgnoredDocument[];
  reachableRoutePaths: Set<string>;
  routeCycles: RouteCycle[];
  targets: DocumentTarget[];
  targetByName: Map<string, DocumentTarget>;
  duplicateNames: Map<string, string[]>;
  routeFileName: string;
};

export type DocumentDocument = {
  path: string;
  content: string;
  entries: DocumentEntry[];
  isTarget: boolean;
  target: DocumentTarget;
};

export type IgnoredDocument = {
  name: string;
  path: string;
  kind: string;
};

export type RouteCycle = {
  paths: string[];
};

export type RouteContext = {
  fallback: boolean;
  modulePath: string;
  requestedModulePath: string;
  requestedPath: string;
  route: string;
  routeFileName: string;
};

const RELATION_PREFIX = '- [agent-index]';
const ATTRIBUTE_PATTERN = /([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g;

export async function loadDocumentGraph(root: string): Promise<DocumentGraph> {
  const config = await loadRuntimeConfig(root);
  const documentTypes = await loadDocumentTypes(root);
  const targetableTypeNames = new Set(documentTypes.map((type) => type.name));
  const isIgnored = createIgnoreMatcher(config.ignore);
  const markdownFiles = await collectMarkdownFiles(root);
  const documents: DocumentDocument[] = [];
  const ignoredDocuments: IgnoredDocument[] = [];

  for (const path of markdownFiles) {
    const content = await readTextFile(resolvePath(root, path));
    const target = buildDocumentTarget(path, content, config.instructionFileName, documentTypes);
    if (isIgnored(path)) {
      ignoredDocuments.push({
        name: target.name,
        path: target.path,
        kind: target.kind,
      });
      continue;
    }

    documents.push({
      path,
      content,
      isTarget: isTargetable(target, config.instructionFileName, targetableTypeNames),
      target,
      entries: parseEntries(path, content),
    });
  }

  const targets = documents
    .filter((document) => document.isTarget)
    .map((document) => document.target)
    .sort(compareByPath);
  const duplicateNames = findDuplicateNames(targets);
  const targetByName = new Map<string, DocumentTarget>();
  for (const target of targets) {
    if (duplicateNames.has(target.name)) continue;
    targetByName.set(target.name, target);
  }
  const ignoredTargetByName = buildIgnoredTargetMap(ignoredDocuments);

  const entries: DocumentEntry[] = [];
  for (const document of documents.filter((candidate) => candidate.target.kind === 'route')) {
    for (const entry of document.entries) {
      const target = targetByName.get(entry.name);
      const ignoredTarget =
        target
          ? undefined
          : ignoredTargetByName.get(entry.name) ??
            (await findIgnoredDocumentByEntryName(
              root,
              entry.name,
              config.instructionFileName,
              documentTypes,
              isIgnored,
            ));
      entries.push({
        ...entry,
        target,
        ignoredTarget,
        errors: [
          ...entry.errors,
          ...(entry.name && !target && ignoredTarget ? ['ignored_target_referenced'] : []),
          ...(entry.name && !target && !ignoredTarget ? ['target_not_found'] : []),
          ...(entry.name && duplicateNames.has(entry.name) ? ['target_name_duplicate'] : []),
        ],
      });
    }
  }
  const documentByPath = new Map(documents.map((document) => [document.path, document]));
  const reachableRoutePaths = collectReachableRoutePaths(
    documents,
    targetByName,
    documentByPath,
    config.instructionFileName,
  );
  const routeCycles = collectRouteCycles(entries);

  return {
    documents,
    entries,
    ignoredDocuments,
    reachableRoutePaths,
    routeCycles,
    targets,
    targetByName,
    duplicateNames,
    routeFileName: config.instructionFileName,
  };
}

export async function findNearestRoute(root: string, inputPath: string): Promise<string> {
  return (await findNearestRouteContext(root, inputPath)).route;
}

export async function findNearestRouteContext(root: string, inputPath: string): Promise<RouteContext> {
  const config = await loadRuntimeConfig(root);
  const isIgnored = createIgnoreMatcher(config.ignore);
  const absolute = resolvePath(root, inputPath || '.');
  assertInsideRoot(root, absolute, inputPath || '.');

  let current = fileExists(absolute) && !isDirectory(absolute) ? dirname(absolute) : absolute;
  if (!fileExists(current)) current = looksLikeFile(inputPath) ? dirname(current) : current;
  const requestedModulePath = toProjectPath(root, current);

  while (true) {
    const candidate = join(current, config.instructionFileName);
    if (fileExists(candidate) && !isIgnored(toProjectPath(root, candidate))) {
      const modulePath = toProjectPath(root, current);
      return {
        fallback: modulePath !== requestedModulePath,
        modulePath,
        requestedModulePath,
        requestedPath: toProjectPath(root, absolute),
        route: toProjectPath(root, candidate),
        routeFileName: config.instructionFileName,
      };
    }
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new CliError({
    code: 'route_not_found',
    message: `No ${config.instructionFileName} found for path: ${inputPath || '.'}.`,
    hint: 'Run `docs-harness init --dry-run`, then `docs-harness init --yes`. For repair workflow, run `docs-harness skills read document-repair`.',
  });
}

export function getTargetOrThrow(graph: DocumentGraph, name: string): DocumentTarget {
  if (!name) {
    throw new CliError({
      code: 'missing_required_argument',
      message: 'Missing required argument: name.',
      hint: 'Run `docs-harness read <name>`.',
    });
  }

  const duplicates = graph.duplicateNames.get(name);
  if (duplicates) {
    throw new CliError({
      code: 'duplicate_document_name',
      message: `Document name is duplicated: ${name}.`,
      hint: `Conflicting paths: ${duplicates.map((path) => `\`${path}\``).join(', ')}. For repair workflow, run \`docs-harness skills read document-repair\`.`,
    });
  }

  const target = graph.targetByName.get(name) ?? graph.targetByName.get(stripMarkdownExtension(name));
  if (target) return target;

  const ignoredDocument = graph.ignoredDocuments.find(
    (document) =>
      document.name === name ||
      document.name === stripMarkdownExtension(name) ||
      document.path === name ||
      document.path === `${stripMarkdownExtension(name)}.md`,
  );
  if (ignoredDocument) {
    throw new CliError({
      code: 'document_ignored',
      message: `Document is excluded by docs-harness ignore config: ${ignoredDocument.path}.`,
      hint:
        'If this document should be managed, manually edit `.docs-harness/config.json` and remove or narrow the matching `ignore` pattern, then rerun `docs-harness validate`. Otherwise choose a managed document instead. For repair workflow, run `docs-harness skills read document-repair`.',
    });
  }

  const nonTargetDocument = graph.documents.find(
    (document) =>
      !document.isTarget &&
      (document.target.name === name ||
        document.target.name === stripMarkdownExtension(name) ||
        document.path === name ||
        document.path === `${stripMarkdownExtension(name)}.md`),
  );
  if (nonTargetDocument) {
    throw new CliError({
      code: 'non_target_document',
      message: `Document exists but is not a configured target: ${nonTargetDocument.path}.`,
      hint: 'Run `docs-harness skills read document-repair`. Decide whether to convert this content into a configured typed document, README, or route entry; if the type was intentionally removed, migrate or remove the stale file.',
    });
  }

  throw new CliError({
    code: 'document_not_found',
    message: `Document not found: ${name}.`,
    hint: 'Run `docs-harness insight [path]` or `docs-harness validate`. For repair workflow, run `docs-harness skills read document-repair`.',
  });
}

export function buildDocumentTarget(
  path: string,
  content: string,
  routeFileName: string,
  documentTypes: DocumentTypeDefinition[],
): DocumentTarget {
  const metadata = parseMetadata(content);
  const typeMatch = resolveDocumentTypePath(path, documentTypes, routeFileName);
  const name = metadata.name || stripMarkdownExtension(path);
  return {
    name,
    description: metadata.description || '',
    path,
    content,
    kind: isRouteFile(path, routeFileName) ? 'route' : typeMatch?.type.name ?? 'document',
  };
}

function parseEntries(source: string, content: string): DocumentEntry[] {
  const entries: DocumentEntry[] = [];
  let isInsideFence = false;

  content.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      isInsideFence = !isInsideFence;
      return;
    }
    if (isInsideFence || !trimmed.startsWith(RELATION_PREFIX)) return;

    const attributes = parseAttributes(trimmed.slice(RELATION_PREFIX.length).trim());
    const errors: string[] = [];
    if (!attributes.name) errors.push('missing_name');
    if (!attributes.description) errors.push('missing_description');

    entries.push({
      name: attributes.name ?? '',
      description: attributes.description ?? '',
      source,
      line: index + 1,
      errors,
    });
  });

  return entries;
}

function parseAttributes(input: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of input.matchAll(ATTRIBUTE_PATTERN)) attributes[match[1]] = match[2];
  return attributes;
}

function findDuplicateNames(targets: DocumentTarget[]): Map<string, string[]> {
  const pathsByName = new Map<string, string[]>();
  for (const target of targets) {
    pathsByName.set(target.name, [...(pathsByName.get(target.name) ?? []), target.path]);
  }

  const duplicates = new Map<string, string[]>();
  for (const [name, paths] of pathsByName.entries()) {
    if (paths.length > 1) duplicates.set(name, paths);
  }
  return duplicates;
}

function buildIgnoredTargetMap(ignoredDocuments: IgnoredDocument[]): Map<string, IgnoredDocument> {
  const ignoredTargetByName = new Map<string, IgnoredDocument>();
  for (const document of ignoredDocuments) {
    for (const name of new Set([
      document.name,
      stripMarkdownExtension(document.name),
      document.path,
      stripMarkdownExtension(document.path),
    ])) {
      if (name) ignoredTargetByName.set(name, document);
    }
  }
  return ignoredTargetByName;
}

async function findIgnoredDocumentByEntryName(
  root: string,
  name: string,
  routeFileName: string,
  documentTypes: DocumentTypeDefinition[],
  isIgnored: (path: string) => boolean,
): Promise<IgnoredDocument | undefined> {
  if (!name) return undefined;

  const candidatePaths = new Set([
    name.endsWith('.md') ? name : `${stripMarkdownExtension(name)}.md`,
  ]);

  for (const candidatePath of candidatePaths) {
    const absolutePath = resolvePath(root, candidatePath);
    const projectPath = toProjectPath(root, absolutePath);
    if (projectPath === '..' || projectPath.startsWith('../')) continue;
    if (!isIgnored(projectPath) || !fileExists(absolutePath)) continue;

    const content = await readTextFile(absolutePath);
    const target = buildDocumentTarget(projectPath, content, routeFileName, documentTypes);
    return {
      name: target.name,
      path: target.path,
      kind: target.kind,
    };
  }

  return undefined;
}

function isTargetable(
  target: DocumentTarget,
  routeFileName: string,
  targetableTypeNames: Set<string>,
): boolean {
  if (isRouteFile(target.path, routeFileName)) return true;
  return targetableTypeNames.has(target.kind);
}

function isRouteFile(path: string, routeFileName: string): boolean {
  return path === routeFileName || path.endsWith(`/${routeFileName}`);
}

function collectReachableRoutePaths(
  documents: DocumentDocument[],
  targetByName: Map<string, DocumentTarget>,
  documentByPath: Map<string, DocumentDocument>,
  routeFileName: string,
): Set<string> {
  const reachablePaths = new Set<string>();
  const pendingPaths = documents
    .filter((document) => document.path === routeFileName)
    .map((document) => document.path);

  while (pendingPaths.length > 0) {
    const currentPath = pendingPaths.pop();
    if (!currentPath || reachablePaths.has(currentPath)) continue;

    reachablePaths.add(currentPath);
    const document = documentByPath.get(currentPath);
    if (!document) continue;

    for (const entry of document.entries) {
      const target = targetByName.get(entry.name);
      if (target?.kind === 'route' && !reachablePaths.has(target.path)) pendingPaths.push(target.path);
    }
  }

  return reachablePaths;
}

function collectRouteCycles(entries: DocumentEntry[]): RouteCycle[] {
  const adjacency = new Map<string, string[]>();

  for (const entry of entries) {
    if (entry.target?.kind !== 'route') continue;
    const nextPaths = adjacency.get(entry.source) ?? [];
    nextPaths.push(entry.target.path);
    adjacency.set(entry.source, nextPaths);
  }

  const cycles = new Map<string, RouteCycle>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(path: string): void {
    if (visiting.has(path)) {
      const cycleStartIndex = stack.indexOf(path);
      if (cycleStartIndex >= 0) {
        const cyclePaths = [...stack.slice(cycleStartIndex), path];
        cycles.set(normalizeCycleKey(cyclePaths), { paths: cyclePaths });
      }
      return;
    }
    if (visited.has(path)) return;

    visiting.add(path);
    stack.push(path);
    for (const nextPath of adjacency.get(path) ?? []) visit(nextPath);
    stack.pop();
    visiting.delete(path);
    visited.add(path);
  }

  for (const path of adjacency.keys()) visit(path);
  return [...cycles.values()].sort((left, right) =>
    left.paths.join(' -> ').localeCompare(right.paths.join(' -> ')),
  );
}

function normalizeCycleKey(paths: string[]): string {
  const cycle = paths.slice(0, -1);
  if (cycle.length === 0) return paths.join(' -> ');

  let best = cycle;
  for (let index = 1; index < cycle.length; index += 1) {
    const rotated = [...cycle.slice(index), ...cycle.slice(0, index)];
    if (rotated.join('\0') < best.join('\0')) best = rotated;
  }

  return [...best, best[0]].join(' -> ');
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.md$/, '');
}

function compareByPath(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path);
}

function looksLikeFile(path: string): boolean {
  return /\.[A-Za-z0-9]+$/.test(path.split('/').at(-1) ?? '');
}
