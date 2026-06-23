#!/usr/bin/env node

import { readFile, unlink } from 'node:fs/promises';

import { writeQueuedCommandLog, type QueuedCommandLogInput } from './lib/logging.js';

async function main(payloadPath: string): Promise<void> {
  if (!payloadPath) return;
  const payload = JSON.parse(await readFile(payloadPath, 'utf8')) as QueuedCommandLogInput;
  await writeQueuedCommandLog(payload);
  await unlink(payloadPath).catch(() => {});
}

void main(process.argv[2] ?? '').catch(() => {
  process.exitCode = 0;
});
