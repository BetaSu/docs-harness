import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ParsedArgs } from './args.js';
import { fileExists } from './files.js';
import { getConfigPath, getLogsDirectory } from './project.js';
import {
  loadDocumentGraph,
  type DocumentEntry,
  type DocumentGraph,
  type DocumentTarget,
} from './document-graph.js';
import { buildSignal, type FrictionPattern, type Signal, type SignalTarget } from './signal-patterns.js';
import { writeSignals } from './signals.js';
import { CLI_VERSION } from './version.js';

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

type SerializableParsedArgs = {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
};

export type CommandLogInput = {
  args: ParsedArgs;
  data?: unknown;
  durationMs: number;
  error?: unknown;
  root: string;
  startedAt: Date;
  status: 'failed' | 'success';
};

export type QueuedCommandLogInput = {
  args: SerializableParsedArgs;
  cwd: string;
  data?: JsonValue;
  durationMs: number;
  error?: JsonValue;
  root: string;
  startedAt: string;
  status: 'failed' | 'success';
};

const RUNS_FILE_NAME = 'runs.jsonl';

export function enqueueCommandLog(input: CommandLogInput): void {
  if (!shouldRecordLogs(input.root)) return;

  try {
    const logsDirectory = getLogsDirectory(input.root);
    const queueDirectory = join(logsDirectory, '.queue');
    mkdirSync(queueDirectory, { recursive: true });

    const payload: QueuedCommandLogInput = {
      args: serializeArgs(input.args),
      cwd: process.cwd(),
      data: input.status === 'success' ? sanitizeLogValue(input.data) : undefined,
      durationMs: input.durationMs,
      error: input.status === 'failed' ? summarizeError(input.error) : undefined,
      root: input.root,
      startedAt: input.startedAt.toISOString(),
      status: input.status,
    };
    const payloadPath = join(
      queueDirectory,
      `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}.json`,
    );
    writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');

    const workerPath = fileURLToPath(new URL('../log-writer.js', import.meta.url));
    const child = spawn(process.execPath, [workerPath, payloadPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // Logging must never change CLI semantics.
  }
}

export async function collectCommandSignals(input: {
  args: ParsedArgs;
  data: unknown;
  root: string;
  startedAt: Date;
}): Promise<Signal[]> {
  if (!new Set(['graph', 'insight', 'read']).has(input.args.command)) return [];

  try {
    const graph = await loadDocumentGraph(input.root);
    const createdAt = input.startedAt.toISOString();
    return collectSignalCandidates(input.args.command, input.data, graph).map((candidate) =>
      buildSignal({
        version: CLI_VERSION,
        createdAt,
        frictionPattern: candidate.frictionPattern,
        target: candidate.target,
      }),
    );
  } catch {
    return [];
  }
}

export async function writeQueuedCommandLog(input: QueuedCommandLogInput): Promise<void> {
  if (!shouldRecordLogs(input.root)) return;

  try {
    const startedAt = new Date(input.startedAt);
    const args = deserializeArgs(input.args);
    const signals =
      input.status === 'success'
        ? await collectCommandSignals({ args, data: input.data, root: input.root, startedAt })
        : [];
    const directory = getLogDateDirectory(input.root, startedAt);
    await mkdir(directory, { recursive: true });
    const writtenSignals = await writeSignals({ root: input.root, startedAt, signals });
    const intent = getIntent(input.args);
    await appendJsonLine(join(directory, RUNS_FILE_NAME), {
      version: CLI_VERSION,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      command: input.args.command,
      cwd: input.cwd,
      root: input.root,
      status: input.status,
      ok: input.status === 'success',
      args: input.args,
      ...(intent ? { intent } : {}),
      result: input.status === 'success' ? input.data : undefined,
      error: input.status === 'failed' ? input.error : undefined,
      signalCount: writtenSignals.length,
    });
  } catch {
    // Logging must never change CLI semantics.
  }
}

function collectSignalCandidates(
  command: string,
  data: unknown,
  graph: DocumentGraph,
): Array<{ frictionPattern: FrictionPattern; target: SignalTarget }> {
  const result = asRecord(data);
  if (!result) return [];

  if (command === 'insight') return collectInsightSignals(result, graph);
  if (command === 'read') return collectReadSignals(result, graph);
  if (command === 'graph') return collectGraphSignals(graph);
  return [];
}

function collectInsightSignals(
  result: Record<string, unknown>,
  graph: DocumentGraph,
): Array<{ frictionPattern: FrictionPattern; target: SignalTarget }> {
  const signals: Array<{ frictionPattern: FrictionPattern; target: SignalTarget }> = [];
  const requestedModulePath = getString(result.requestedModulePath) || getString(result.path);
  const routePath = getNestedString(result, ['route', 'path']);
  const routeEntries = getNestedArray(result, ['route', 'entries']);

  if (result.fallback === true && requestedModulePath) {
    signals.push({
      frictionPattern: 'route_fallback',
      target: { kind: 'module', path: requestedModulePath },
    });
  }

  if (routePath && routeEntries.length === 0) {
    signals.push({
      frictionPattern: 'empty_route',
      target: { kind: 'route', path: routePath },
    });
  }

  if (routePath) {
    signals.push(...collectRouteReadmeSignals(graph, routePath));
    signals.push(...collectRouteEntryTopologySignals(graph, new Set([routePath])));
  }
  signals.push(...collectReadmeUnindexedSignals(graph, requestedModulePath));
  signals.push(...collectNonTargetDocumentSignals(graph, requestedModulePath));
  return signals;
}

function collectReadSignals(
  result: Record<string, unknown>,
  graph: DocumentGraph,
): Array<{ frictionPattern: FrictionPattern; target: SignalTarget }> {
  const path = getString(result.path);
  const name = getString(result.name);
  const target = graph.targets.find((candidate) => candidate.path === path || candidate.name === name);
  if (!target) return [];

  const indexedEntries = graph.entries.filter((entry) => entry.target?.path === target.path);
  if (indexedEntries.length === 0) {
    return [
      {
        frictionPattern: 'read_unindexed_target',
        target: toDocumentSignalTarget(target),
      },
    ];
  }

  if (!isTargetReachable(graph, target)) {
    return [
      {
        frictionPattern: 'read_unreachable_target',
        target: toDocumentSignalTarget(target),
      },
    ];
  }

  return [];
}

function collectGraphSignals(
  graph: DocumentGraph,
): Array<{ frictionPattern: FrictionPattern; target: SignalTarget }> {
  const routeSignals = graph.targets
    .filter((target) => target.kind === 'route')
    .flatMap((route) => [
      ...(graph.entries.some((entry) => entry.source === route.path)
        ? []
        : [{ frictionPattern: 'empty_route' as const, target: { kind: 'route' as const, path: route.path } }]),
      ...collectRouteReadmeSignals(graph, route.path),
    ]);
  return [
    ...routeSignals,
    ...collectRouteEntryTopologySignals(graph),
    ...collectReadmeUnindexedSignals(graph),
    ...collectNonTargetDocumentSignals(graph),
  ];
}

function collectReadmeUnindexedSignals(
  graph: DocumentGraph,
  modulePath?: string,
): Array<{ frictionPattern: FrictionPattern; target: SignalTarget }> {
  return graph.targets
    .filter((target) => target.kind === 'readme')
    .filter((target) => !modulePath || isPathInsideModule(target.path, modulePath))
    .filter((target) => !hasSiblingRoute(graph, target.path))
    .filter((target) => !isTargetReachable(graph, target))
    .map((target) => ({
      frictionPattern: 'readme_unindexed' as const,
      target: toDocumentSignalTarget(target),
    }));
}

function collectNonTargetDocumentSignals(
  graph: DocumentGraph,
  modulePath?: string,
): Array<{ frictionPattern: FrictionPattern; target: SignalTarget }> {
  return graph.documents
    .filter((document) => !document.isTarget)
    .filter((document) => !modulePath || isPathInsideModule(document.path, modulePath))
    .map((document) => ({
      frictionPattern: 'non_target_document' as const,
      target: toDocumentSignalTarget(document.target),
    }));
}

function collectRouteReadmeSignals(
  graph: DocumentGraph,
  routePath: string,
): Array<{ frictionPattern: FrictionPattern; target: SignalTarget }> {
  const modulePath = routeModulePath(routePath, graph.routeFileName);
  const readmePath = joinModulePath(modulePath, 'README.md');
  const readme = graph.targets.find((target) => target.path === readmePath);
  if (!readme) {
    return [
      {
        frictionPattern: 'route_without_readme',
        target: { kind: 'route', path: routePath },
      },
    ];
  }

  const hasReadmeEntry = graph.entries.some(
    (entry) => entry.source === routePath && entry.target?.path === readme.path,
  );
  if (!hasReadmeEntry) {
    return [
      {
        frictionPattern: 'route_missing_readme_entry',
        target: { kind: 'route', path: routePath },
      },
    ];
  }

  return [];
}

function collectRouteEntryTopologySignals(
  graph: DocumentGraph,
  sourceFilter?: Set<string>,
): Array<{ frictionPattern: FrictionPattern; target: SignalTarget }> {
  const signals: Array<{ frictionPattern: FrictionPattern; target: SignalTarget }> = [];
  const entriesBySource = new Map<string, DocumentEntry[]>();
  for (const entry of graph.entries) {
    if (sourceFilter && !sourceFilter.has(entry.source)) continue;
    entriesBySource.set(entry.source, [...(entriesBySource.get(entry.source) ?? []), entry]);
  }

  for (const [source, entries] of entriesBySource.entries()) {
    const moduleRoutePathByModule = new Map<string, string>();
    const readmeEntriesByModule = new Map<string, DocumentEntry[]>();

    for (const entry of entries) {
      if (entry.target?.kind === 'route') {
        moduleRoutePathByModule.set(
          routeModulePath(entry.target.path, graph.routeFileName),
          entry.target.path,
        );
      }
      if (entry.target?.kind === 'readme') {
        const modulePath = readmeModulePath(entry.target.path);
        readmeEntriesByModule.set(modulePath, [
          ...(readmeEntriesByModule.get(modulePath) ?? []),
          entry,
        ]);
      }
    }

    for (const [modulePath, readmeEntries] of readmeEntriesByModule.entries()) {
      const siblingRoutePath = moduleRoutePath(modulePath, graph.routeFileName);
      if (!graph.targets.some((target) => target.kind === 'route' && target.path === siblingRoutePath)) {
        continue;
      }
      if (source === siblingRoutePath) continue;

      const routeEntryPath = moduleRoutePathByModule.get(modulePath);
      if (routeEntryPath === siblingRoutePath) {
        signals.push({
          frictionPattern: 'route_duplicates_module_entry',
          target: { kind: 'route', path: source },
        });
        continue;
      }

      for (const entry of readmeEntries) {
        signals.push({
          frictionPattern: 'parent_route_bypasses_module_route',
          target: { kind: 'entry', path: entry.source, name: entry.name, line: entry.line },
        });
      }
    }
  }

  return signals;
}

function shouldRecordLogs(root: string): boolean {
  return fileExists(getConfigPath(root)) || fileExists(getLogsDirectory(root));
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function getLogDateDirectory(root: string, date: Date): string {
  return join(getLogsDirectory(root), formatLocalDate(date));
}

function serializeArgs(args: ParsedArgs): SerializableParsedArgs {
  return {
    command: args.command,
    positionals: args.positionals,
    flags: Object.fromEntries(args.flags.entries()) as Record<string, string | boolean>,
  };
}

function deserializeArgs(args: SerializableParsedArgs): ParsedArgs {
  return {
    command: args.command,
    positionals: args.positionals,
    flags: new Map(Object.entries(args.flags)),
  };
}

function getIntent(args: SerializableParsedArgs): string {
  const value = args.flags.intent;
  return typeof value === 'string' ? value.trim() : '';
}

function isTargetReachable(graph: DocumentGraph, target: DocumentTarget): boolean {
  if (target.kind === 'route') return graph.reachableRoutePaths.has(target.path);
  return graph.entries.some(
    (entry) => entry.target?.path === target.path && graph.reachableRoutePaths.has(entry.source),
  );
}

function toDocumentSignalTarget(target: DocumentTarget): SignalTarget {
  return {
    kind: 'document',
    path: target.path,
    name: target.name,
  };
}

function routeModulePath(routePath: string, routeFileName: string): string {
  if (routePath === routeFileName) return '.';
  return routePath.endsWith(`/${routeFileName}`)
    ? routePath.slice(0, -`/${routeFileName}`.length)
    : routePath.replace(/\/[^/]+$/, '') || '.';
}

function moduleRoutePath(modulePath: string, routeFileName: string): string {
  return joinModulePath(modulePath, routeFileName);
}

function readmeModulePath(readmePath: string): string {
  if (readmePath === 'README.md') return '.';
  return readmePath.endsWith('/README.md')
    ? readmePath.slice(0, -'/README.md'.length)
    : readmePath.replace(/\/[^/]+$/, '') || '.';
}

function hasSiblingRoute(graph: DocumentGraph, readmePath: string): boolean {
  const modulePath = readmeModulePath(readmePath);
  const routePath = moduleRoutePath(modulePath, graph.routeFileName);
  return graph.targets.some((target) => target.kind === 'route' && target.path === routePath);
}

function joinModulePath(modulePath: string, path: string): string {
  return modulePath === '.' ? path : `${modulePath}/${path}`;
}

function isPathInsideModule(path: string, modulePath: string): boolean {
  if (modulePath === '.') return true;
  return path === modulePath || path.startsWith(`${modulePath}/`);
}

function sanitizeLogValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item));
  const record = asRecord(value);
  if (!record) return String(value);

  const sanitized: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === 'content' && typeof item === 'string') {
      sanitized[key] = {
        omitted: true,
        length: item.length,
        sha256: createHash('sha256').update(item).digest('hex'),
      };
      continue;
    }
    sanitized[key] = sanitizeLogValue(item);
  }
  return sanitized;
}

function summarizeError(error: unknown): JsonValue {
  if (error instanceof Error) {
    const record = error as Error & { code?: string };
    return {
      code: record.code ?? error.name,
      message: error.message,
      name: error.name,
    };
  }
  return { message: String(error) };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getNestedString(value: Record<string, unknown>, keys: string[]): string {
  let current: unknown = value;
  for (const key of keys) {
    const record = asRecord(current);
    if (!record) return '';
    current = record[key];
  }
  return getString(current);
}

function getNestedArray(value: Record<string, unknown>, keys: string[]): unknown[] {
  let current: unknown = value;
  for (const key of keys) {
    const record = asRecord(current);
    if (!record) return [];
    current = record[key];
  }
  return Array.isArray(current) ? current : [];
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
