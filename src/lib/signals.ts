import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getLogsDirectory } from './project.js';
import type { Signal } from './signal-patterns.js';

export type StoredSignal = Signal & {
  handledAt?: string;
};

export type SignalHandledFilter = boolean | 'all';

export type ReadSignalsInput = {
  root: string;
  since?: string;
  until?: string;
  handled?: SignalHandledFilter;
  dedupe?: boolean;
  limit?: number;
};

export type ReadSignalsResult = {
  signals: StoredSignal[];
  count: number;
  dedupe: boolean;
  handled: SignalHandledFilter;
  since?: string;
  until?: string;
};

export type MarkSignalsHandledResult = {
  ids: string[];
  matched: number;
  updated: number;
  handledAt: string;
};

export type WriteSignalsInput = {
  root: string;
  signals: Signal[];
  startedAt?: Date;
};

const SIGNAL_FILE_NAME = 'signal.jsonl';

export async function writeSignals(input: WriteSignalsInput): Promise<Signal[]> {
  const startedAt = input.startedAt ?? new Date();
  const directory = getLogDateDirectory(input.root, startedAt);
  await mkdir(directory, { recursive: true });

  const written: Signal[] = [];
  for (const signal of dedupeById(input.signals)) {
    if (await hasUnhandledSignal(input.root, signal.id)) continue;
    await appendJsonLine(join(directory, SIGNAL_FILE_NAME), signal);
    written.push(signal);
  }
  return written;
}

export async function readSignals(input: ReadSignalsInput): Promise<ReadSignalsResult> {
  const since = normalizeDate(input.since);
  const until = normalizeDate(input.until);
  const handled = input.handled ?? false;
  const dedupe = input.dedupe ?? true;
  const records = await readSignalRecords(input.root, { since, until, handled });
  const signals = dedupe ? dedupeSignals(records) : records;
  const limited =
    typeof input.limit === 'number' && input.limit >= 0 ? signals.slice(0, input.limit) : signals;

  return {
    signals: limited,
    count: limited.length,
    dedupe,
    handled,
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
  };
}

export async function markSignalsHandled(
  root: string,
  ids: string[],
): Promise<MarkSignalsHandledResult> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const idSet = new Set(uniqueIds);
  const handledAt = new Date().toISOString();
  let matched = 0;
  let updated = 0;

  for (const filePath of await listSignalFiles(root)) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    let changed = false;
    const lines = content.split('\n').map((line) => {
      if (!line.trim()) return line;
      const record = parseSignal(line);
      if (!record || !idSet.has(record.id)) return line;

      matched += 1;
      if (record.handled === true) return line;

      changed = true;
      updated += 1;
      return JSON.stringify({ ...record, handled: true, handledAt });
    });

    if (changed) await writeAtomic(filePath, `${lines.join('\n').replace(/\n*$/, '')}\n`);
  }

  return { ids: uniqueIds, matched, updated, handledAt };
}

async function readSignalRecords(
  root: string,
  query: { since?: string; until?: string; handled: SignalHandledFilter },
): Promise<StoredSignal[]> {
  const records: StoredSignal[] = [];
  for (const filePath of await listSignalFiles(root, query)) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const line of content.split('\n')) {
      const record = parseSignal(line);
      if (!record) continue;
      if (query.since && record.createdAt < `${query.since}T00:00:00.000Z`) continue;
      if (query.until && record.createdAt > `${query.until}T23:59:59.999Z`) continue;
      if (query.handled !== 'all' && record.handled !== query.handled) continue;
      records.push(record);
    }
  }

  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function listSignalFiles(
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
    .map((name) => join(logsDirectory, name, SIGNAL_FILE_NAME));
}

function dedupeSignals(records: StoredSignal[]): StoredSignal[] {
  const byId = new Map<string, StoredSignal>();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing || record.createdAt > existing.createdAt) byId.set(record.id, record);
  }
  return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function hasUnhandledSignal(root: string, id: string): Promise<boolean> {
  for (const filePath of await listSignalFiles(root)) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const line of content.split('\n')) {
      const record = parseSignal(line);
      if (record?.id === id && record.handled !== true) return true;
    }
  }

  return false;
}

function dedupeById(signals: Signal[]): Signal[] {
  const seen = new Set<string>();
  const deduped: Signal[] = [];
  for (const signal of signals) {
    if (seen.has(signal.id)) continue;
    seen.add(signal.id);
    deduped.push(signal);
  }
  return deduped;
}

function parseSignal(line: string): StoredSignal | undefined {
  if (!line.trim()) return undefined;
  try {
    const parsed = JSON.parse(line) as Partial<StoredSignal>;
    if (!parsed.id || !parsed.createdAt || !parsed.frictionPattern || !parsed.target) {
      return undefined;
    }
    return parsed as StoredSignal;
  } catch {
    return undefined;
  }
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, path);
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function getLogDateDirectory(root: string, date: Date): string {
  return join(getLogsDirectory(root), formatLocalDate(date));
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
