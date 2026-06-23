import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { getLogsDirectory } from './project.js';

type JsonRecord = Record<string, unknown>;

export type IntentCommandFilter = 'insight' | 'read';

export type IntentObservation = {
  id: string;
  observedAt: string;
  command: IntentCommandFilter;
  evidence: 'insight_entry' | 'read';
  intent: string;
  target: {
    name: string;
    description: string;
    path?: string;
    kind?: string;
  };
  route?: {
    path: string;
    requestedPath?: string;
    fallback?: boolean;
  };
};

export type IntentTargetUsage = {
  description: string;
  intent: string;
  count: number;
  evidence: Array<'insight_entry' | 'read'>;
  firstObservedAt: string;
  lastObservedAt: string;
};

export type IntentTargetSummary = {
  name: string;
  usage: IntentTargetUsage[];
  observationCount: number;
  readCount: number;
  insightCount: number;
  path?: string;
  kind?: string;
  firstObservedAt: string;
  lastObservedAt: string;
};

export type ReadIntentObservationsInput = {
  root: string;
  since?: string;
  until?: string;
  command?: IntentCommandFilter;
  target?: string;
  limit?: number;
};

export type ReadIntentObservationsResult = {
  targets: IntentTargetSummary[];
  observations: IntentObservation[];
  count: number;
  targetCount: number;
  since?: string;
  until?: string;
  command?: IntentCommandFilter;
  target?: string;
};

const RUNS_FILE_NAME = 'runs.jsonl';

export async function readIntentObservations(
  input: ReadIntentObservationsInput,
): Promise<ReadIntentObservationsResult> {
  const since = normalizeDate(input.since);
  const until = normalizeDate(input.until);
  const observations: IntentObservation[] = [];

  for (const filePath of await listRunFiles(input.root, { since, until })) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const line of content.split('\n')) {
      const run = parseRun(line);
      if (!run) continue;
      if (since && run.startedAt < `${since}T00:00:00.000Z`) continue;
      if (until && run.startedAt > `${until}T23:59:59.999Z`) continue;
      if (input.command && run.command !== input.command) continue;

      for (const observation of buildRunObservations(run)) {
        if (input.target && observation.target.name !== input.target) continue;
        observations.push(observation);
      }
    }
  }

  const sorted = observations.sort((left, right) => right.observedAt.localeCompare(left.observedAt));
  const limited =
    typeof input.limit === 'number' && input.limit >= 0 ? sorted.slice(0, input.limit) : sorted;

  return {
    targets: buildTargetSummaries(limited),
    observations: limited,
    count: limited.length,
    targetCount: new Set(limited.map((observation) => observation.target.name)).size,
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
    ...(input.command ? { command: input.command } : {}),
    ...(input.target ? { target: input.target } : {}),
  };
}

function buildTargetSummaries(observations: IntentObservation[]): IntentTargetSummary[] {
  const byName = new Map<string, IntentObservation[]>();
  for (const observation of observations) {
    byName.set(observation.target.name, [
      ...(byName.get(observation.target.name) ?? []),
      observation,
    ]);
  }

  return [...byName.entries()]
    .map(([name, targetObservations]) => buildTargetSummary(name, targetObservations))
    .sort((left, right) => right.lastObservedAt.localeCompare(left.lastObservedAt));
}

function buildTargetSummary(
  name: string,
  observations: IntentObservation[],
): IntentTargetSummary {
  const ascending = [...observations].sort((left, right) =>
    left.observedAt.localeCompare(right.observedAt),
  );
  const descending = [...ascending].reverse();
  const latestWithPath = descending.find((observation) => observation.target.path);
  const latestWithKind = descending.find((observation) => observation.target.kind);

  return {
    name,
    usage: buildUsageGroups(ascending),
    observationCount: observations.length,
    readCount: observations.filter((observation) => observation.evidence === 'read').length,
    insightCount: observations.filter((observation) => observation.evidence === 'insight_entry').length,
    ...(latestWithPath?.target.path ? { path: latestWithPath.target.path } : {}),
    ...(latestWithKind?.target.kind ? { kind: latestWithKind.target.kind } : {}),
    firstObservedAt: ascending[0]?.observedAt ?? '',
    lastObservedAt: descending[0]?.observedAt ?? '',
  };
}

function buildUsageGroups(observations: IntentObservation[]): IntentTargetUsage[] {
  const byPair = new Map<string, IntentObservation[]>();
  for (const observation of observations) {
    const key = JSON.stringify({
      description: observation.target.description,
      intent: observation.intent,
    });
    byPair.set(key, [...(byPair.get(key) ?? []), observation]);
  }

  return [...byPair.values()]
    .map((usageObservations) => {
      const ascending = [...usageObservations].sort((left, right) =>
        left.observedAt.localeCompare(right.observedAt),
      );
      const first = ascending[0];
      const last = ascending.at(-1);
      return {
        description: first?.target.description ?? '',
        intent: first?.intent ?? '',
        count: usageObservations.length,
        evidence: uniqueEvidence(usageObservations.map((observation) => observation.evidence)),
        firstObservedAt: first?.observedAt ?? '',
        lastObservedAt: last?.observedAt ?? '',
      };
    })
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      return right.lastObservedAt.localeCompare(left.lastObservedAt);
    });
}

async function listRunFiles(
  root: string,
  query: { since?: string; until?: string } = {},
): Promise<string[]> {
  const logsDirectory = getLogsDirectory(root);
  let names: string[];
  try {
    names = await readdir(logsDirectory);
  } catch {
    return [];
  }

  return names
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .filter((name) => !query.since || name >= query.since)
    .filter((name) => !query.until || name <= query.until)
    .sort()
    .map((name) => join(logsDirectory, name, RUNS_FILE_NAME));
}

function parseRun(line: string): {
  command: string;
  intent: string;
  result: JsonRecord;
  startedAt: string;
} | undefined {
  if (!line.trim()) return undefined;

  try {
    const parsed = JSON.parse(line) as JsonRecord;
    const command = getString(parsed.command);
    if (command !== 'insight' && command !== 'read') return undefined;
    if (parsed.ok !== true) return undefined;

    const startedAt = getString(parsed.startedAt);
    const intent = getIntent(parsed);
    const result = asRecord(parsed.result);
    if (!startedAt || !intent || !result) return undefined;

    return { command, intent, result, startedAt };
  } catch {
    return undefined;
  }
}

function buildRunObservations(run: {
  command: string;
  intent: string;
  result: JsonRecord;
  startedAt: string;
}): IntentObservation[] {
  if (run.command === 'read') {
    const observation = buildReadObservation(run);
    return observation ? [observation] : [];
  }

  if (run.command === 'insight') return buildInsightObservations(run);
  return [];
}

function buildReadObservation(run: {
  intent: string;
  result: JsonRecord;
  startedAt: string;
}): IntentObservation | undefined {
  const name = getString(run.result.name);
  const description = getString(run.result.description);
  if (!name) return undefined;

  const observation: Omit<IntentObservation, 'id'> = {
    observedAt: run.startedAt,
    command: 'read',
    evidence: 'read',
    intent: run.intent,
    target: {
      name,
      description,
      ...(getString(run.result.path) ? { path: getString(run.result.path) } : {}),
      ...(getString(run.result.kind) ? { kind: getString(run.result.kind) } : {}),
    },
  };
  return { id: buildObservationId(observation), ...observation };
}

function buildInsightObservations(run: {
  intent: string;
  result: JsonRecord;
  startedAt: string;
}): IntentObservation[] {
  const route = asRecord(run.result.route);
  const entries = Array.isArray(route?.entries) ? route.entries : [];
  const routePath = getString(route?.path);
  const requestedPath = getString(run.result.path);
  const fallback = typeof run.result.fallback === 'boolean' ? run.result.fallback : undefined;
  const observations: IntentObservation[] = [];

  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;

    const name = getString(record.name);
    if (!name) continue;

    const observation: Omit<IntentObservation, 'id'> = {
      observedAt: run.startedAt,
      command: 'insight',
      evidence: 'insight_entry',
      intent: run.intent,
      target: {
        name,
        description: getString(record.description),
      },
      route: {
        path: routePath,
        ...(requestedPath ? { requestedPath } : {}),
        ...(typeof fallback === 'boolean' ? { fallback } : {}),
      },
    };
    observations.push({ id: buildObservationId(observation), ...observation });
  }

  return observations;
}

function getIntent(run: JsonRecord): string {
  const direct = getString(run.intent).trim();
  if (direct) return direct;

  const args = asRecord(run.args);
  const flags = asRecord(args?.flags);
  return getString(flags?.intent).trim();
}

function buildObservationId(observation: Omit<IntentObservation, 'id'>): string {
  const hash = createHash('sha256').update(JSON.stringify(observation)).digest('hex').slice(0, 16);
  return `intent_${hash}`;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function uniqueEvidence(
  values: Array<'insight_entry' | 'read'>,
): Array<'insight_entry' | 'read'> {
  const order: Array<'read' | 'insight_entry'> = ['read', 'insight_entry'];
  const set = new Set(values);
  return order.filter((value) => set.has(value));
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
