import { type ParsedArgs, requireNoUnknownFlags } from '../lib/args.js';
import { findNearestRoute, getTargetOrThrow, loadDocumentGraph } from '../lib/document-graph.js';
import { readTextFile, resolvePath } from '../lib/files.js';

export async function commandInsight(root: string, args: ParsedArgs): Promise<{
  route: string;
  entries: Array<{ name: string; description: string }>;
}> {
  requireNoUnknownFlags(args, ['root']);
  const route = await findNearestRoute(root, args.positionals[0] ?? '.');
  const graph = await loadDocumentGraph(root);
  const entries = graph.entries
    .filter((entry) => entry.source === route)
    .sort((left, right) => left.line - right.line)
    .map((entry) => ({
      name: entry.name,
      description: entry.description,
    }));
  return { route, entries };
}

export async function commandShow(root: string, args: ParsedArgs): Promise<{
  name: string;
  kind: string;
  content: string;
}> {
  requireNoUnknownFlags(args, ['root']);
  const graph = await loadDocumentGraph(root);
  const target = getTargetOrThrow(graph, args.positionals[0] ?? '');
  return {
    name: target.name,
    kind: target.kind,
    content: target.content,
  };
}

export async function commandValidate(root: string, args: ParsedArgs): Promise<{
  valid: boolean;
  errors: string[];
}> {
  requireNoUnknownFlags(args, ['root']);
  const graph = await loadDocumentGraph(root);
  const errors: string[] = [];

  for (const [name, paths] of graph.duplicateNames.entries()) {
    errors.push(`duplicate_name ${name}: ${paths.join(', ')}`);
  }

  for (const entry of graph.entries) {
    for (const error of entry.errors) {
      errors.push(`${entry.source}:${entry.line} ${error} ${entry.name || '<missing>'}`);
    }
  }

  for (const document of graph.documents) {
    if (document.path === graph.routeFileName) continue;
    if (document.path.endsWith(`/${graph.routeFileName}`)) continue;
    if (document.path.endsWith('/README.md')) {
      const routePath = `${document.path.slice(0, -'README.md'.length)}${graph.routeFileName}`;
      try {
        await readTextFile(resolvePath(root, routePath));
      } catch {
        errors.push(`${document.path} missing_sibling_route ${routePath}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function commandGraph(root: string, args: ParsedArgs): Promise<{
  nodes: Array<{ name: string; kind: string; path: string }>;
  edges: Array<{ from: string; to: string; name: string; description: string }>;
  errors: string[];
}> {
  requireNoUnknownFlags(args, ['root']);
  const graph = await loadDocumentGraph(root);
  return {
    nodes: graph.targets.map((target) => ({
      name: target.name,
      kind: target.kind,
      path: target.path,
    })),
    edges: graph.entries.map((entry) => ({
      from: entry.source,
      to: entry.target?.path ?? '',
      name: entry.name,
      description: entry.description,
    })),
    errors: (await commandValidate(root, args)).errors,
  };
}
