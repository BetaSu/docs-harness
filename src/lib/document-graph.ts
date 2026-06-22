import { basename, dirname, join } from 'node:path';

import { CliError } from './envelope.js';
import {
  assertInsideRoot,
  collectMarkdownFiles,
  fileExists,
  isDirectory,
  normalizePath,
  readTextFile,
  resolvePath,
  toProjectPath,
} from './files.js';
import { parseMetadata } from './markdown.js';
import { loadRuntimeConfig } from './config.js';

export type DocumentEntry = {
  name: string;
  description: string;
  source: string;
  line: number;
  target?: DocumentTarget;
  errors: string[];
};

export type DocumentTarget = {
  name: string;
  path: string;
  kind: string;
  content: string;
};

export type DocumentGraph = {
  documents: DocumentDocument[];
  entries: DocumentEntry[];
  targets: DocumentTarget[];
  targetByName: Map<string, DocumentTarget>;
  duplicateNames: Map<string, string[]>;
  routeFileName: string;
};

type DocumentDocument = {
  path: string;
  content: string;
  entries: DocumentEntry[];
  target: DocumentTarget;
};

const RELATION_PREFIX = '- [agent-index]';
const ATTRIBUTE_PATTERN = /([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g;

export async function loadDocumentGraph(root: string): Promise<DocumentGraph> {
  const config = await loadRuntimeConfig(root);
  const markdownFiles = await collectMarkdownFiles(root);
  const documents: DocumentDocument[] = [];

  for (const path of markdownFiles) {
    const content = await readTextFile(resolvePath(root, path));
    const target = buildTarget(path, content, config.instructionFileName);
    documents.push({
      path,
      content,
      target,
      entries: parseEntries(path, content),
    });
  }

  const duplicateNames = findDuplicateNames(documents.map((document) => document.target));
  const targetByName = new Map<string, DocumentTarget>();
  for (const document of documents) {
    if (duplicateNames.has(document.target.name)) continue;
    targetByName.set(document.target.name, document.target);
  }

  const entries = documents.flatMap((document) =>
    document.entries.map((entry) => ({
      ...entry,
      target: targetByName.get(entry.name),
      errors: [
        ...entry.errors,
        ...(entry.name && !targetByName.has(entry.name) ? ['target_not_found'] : []),
        ...(entry.name && duplicateNames.has(entry.name) ? ['target_name_duplicate'] : []),
      ],
    })),
  );

  return {
    documents,
    entries,
    targets: documents.map((document) => document.target).sort(compareByPath),
    targetByName,
    duplicateNames,
    routeFileName: config.instructionFileName,
  };
}

export async function findNearestRoute(root: string, inputPath: string): Promise<string> {
  const config = await loadRuntimeConfig(root);
  const absolute = resolvePath(root, inputPath || '.');
  assertInsideRoot(root, absolute, inputPath || '.');

  let current = fileExists(absolute) && !isDirectory(absolute) ? dirname(absolute) : absolute;
  if (!fileExists(current)) current = looksLikeFile(inputPath) ? dirname(current) : current;

  while (true) {
    const candidate = join(current, config.instructionFileName);
    if (fileExists(candidate)) return toProjectPath(root, candidate);
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new CliError({
    type: 'not_found',
    message: `No ${config.instructionFileName} found for path: ${inputPath || '.'}.`,
    hint: 'Run docs-harness init --dry-run, then docs-harness init --yes.',
  });
}

export function getTargetOrThrow(graph: DocumentGraph, name: string): DocumentTarget {
  if (!name) {
    throw new CliError({
      type: 'validation',
      message: 'Missing required argument: name.',
      hint: 'Run docs-harness show <name>.',
    });
  }

  const duplicates = graph.duplicateNames.get(name);
  if (duplicates) {
    throw new CliError({
      type: 'validation',
      message: `Document name is duplicated: ${name}.`,
      hint: `Conflicting paths: ${duplicates.join(', ')}.`,
    });
  }

  const target = graph.targetByName.get(name) ?? graph.targetByName.get(stripMarkdownExtension(name));
  if (target) return target;

  throw new CliError({
    type: 'not_found',
    message: `Document not found: ${name}.`,
    hint: 'Run docs-harness insight [path] or docs-harness validate.',
  });
}

function buildTarget(path: string, content: string, routeFileName: string): DocumentTarget {
  const metadata = parseMetadata(content);
  const name = metadata.name || stripMarkdownExtension(path);
  return {
    name,
    path,
    content,
    kind: resolveKind(path, routeFileName),
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

function resolveKind(path: string, routeFileName: string): string {
  const fileName = basename(path);
  if (fileName === routeFileName) return 'route';
  if (fileName === 'README.md') return 'readme';
  const parts = normalizePath(path).split('/');
  const docsIndex = parts.lastIndexOf('docs');
  if (docsIndex >= 0 && parts[docsIndex + 1]) return parts[docsIndex + 1];
  return 'document';
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
