import { join } from 'node:path';

import { type ParsedArgs, requireNoUnknownFlags } from '../lib/args.js';
import { findNearestRouteContext, getTargetOrThrow, loadDocumentGraph } from '../lib/document-graph.js';
import { CliError } from '../lib/envelope.js';
import { validateDocumentGraph, type ValidationIssue } from '../lib/validation.js';

export async function commandInsight(root: string, args: ParsedArgs): Promise<{
  fallback: boolean;
  message?: string;
  hint?: string;
  module: {
    path: string;
    readme: {
      name: string;
      description: string;
    };
  };
  path: string;
  requestedModulePath: string;
  route: {
    path: string;
    entries: Array<{ name: string; description: string }>;
  };
}> {
  requireNoUnknownFlags(args, ['intent', 'root']);
  const context = await findNearestRouteContext(root, args.positionals[0] ?? '.');
  const graph = await loadDocumentGraph(root);
  const entries = graph.entries
    .filter((entry) => entry.source === context.route)
    .sort((left, right) => left.line - right.line)
    .map((entry) => ({
      name: entry.name,
      description: entry.description,
    }));
  const readmePath = joinModulePath(context.modulePath, 'README.md');
  const readmeTarget = graph.targets.find((target) => target.path === readmePath);
  return {
    fallback: context.fallback,
    ...(context.fallback
      ? {
          message: `No ${context.routeFileName} found at ${context.requestedModulePath}; using nearest ancestor module ${context.modulePath}.`,
          hint: 'Use `docs-harness read <name>` to read one listed document.',
        }
      : {}),
    module: {
      path: context.modulePath,
      readme: {
        name: readmeTarget?.name ?? stripMarkdownExtension(readmePath),
        description: readmeTarget?.description ?? '',
      },
    },
    path: context.requestedPath,
    requestedModulePath: context.requestedModulePath,
    route: {
      path: context.route,
      entries,
    },
  };
}

export async function commandRead(root: string, args: ParsedArgs): Promise<{
  name: string;
  description: string;
  kind: string;
  path: string;
  content: string;
}> {
  requireNoUnknownFlags(args, ['intent', 'root']);
  const graph = await loadDocumentGraph(root);
  const target = getTargetOrThrow(graph, args.positionals[0] ?? '');
  return {
    name: target.name,
    description: target.description,
    kind: target.kind,
    path: target.path,
    content: target.content,
  };
}

function joinModulePath(modulePath: string, path: string): string {
  return modulePath === '.' ? path : join(modulePath, path).replace(/\\/g, '/');
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.md$/, '');
}

export async function commandValidate(root: string, args: ParsedArgs): Promise<{
  valid: boolean;
  issues: ValidationIssue[];
}> {
  requireNoUnknownFlags(args, ['root']);
  const graph = await loadDocumentGraph(root);
  const issues = await validateDocumentGraph(root, graph);
  if (issues.length > 0) {
    throw new CliError({
      code: 'validation_failed',
      message: 'Document graph validation failed.',
      hint: 'Fix the reported issues, then rerun `docs-harness validate`. For repair workflow, run `docs-harness skills read document-repair`.',
      issues,
    });
  }
  return { valid: issues.length === 0, issues };
}

export async function commandGraph(root: string, args: ParsedArgs): Promise<{
  nodes: Array<{ name: string; kind: string; path: string }>;
  edges: Array<{ from: string; to: string; name: string; description: string }>;
  issues: ValidationIssue[];
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
    issues: await validateDocumentGraph(root, graph),
  };
}
