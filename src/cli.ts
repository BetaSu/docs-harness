#!/usr/bin/env node

import { parseArgs } from './lib/args.js';
import { CliError, writeFailure, writeSuccess } from './lib/envelope.js';
import { resolveProjectRoot } from './lib/project.js';
import { commandInit } from './commands/init.js';
import { commandGraph, commandInsight, commandRead, commandValidate } from './commands/graph.js';
import { commandSchema } from './commands/schema.js';
import { commandIntent } from './commands/intent.js';
import { commandSignal } from './commands/signal.js';
import { commandSkills } from './commands/skills.js';
import { commandTypes } from './commands/types.js';
import { commandVersion } from './commands/version.js';
import { commandWrite } from './commands/write.js';
import { enqueueCommandLog } from './lib/logging.js';

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const root = resolveProjectRoot(args);
  const startedAt = new Date();

  try {
    const data = await dispatchCommand(root, args);
    writeSuccess(data);
    enqueueCommandLog({
      args,
      data,
      durationMs: Date.now() - startedAt.getTime(),
      root,
      startedAt,
      status: 'success',
    });
  } catch (error) {
    enqueueCommandLog({
      args,
      durationMs: Date.now() - startedAt.getTime(),
      error,
      root,
      startedAt,
      status: 'failed',
    });
    throw error;
  }
}

async function dispatchCommand(root: string, args: ReturnType<typeof parseArgs>): Promise<unknown> {
  switch (args.command) {
    case 'help':
    case '--help':
    case '-h':
      return commandSchema(toSchemaAliasArgs(args));
    case 'schema':
      return commandSchema(args);
    case 'version':
      return commandVersion(args);
    case 'intent':
      return commandIntent(root, args);
    case 'signal':
      return commandSignal(root, args);
    case 'init':
      return commandInit(root, args);
    case 'insight':
      return commandInsight(root, args);
    case 'read':
      return commandRead(root, args);
    case 'validate':
      return commandValidate(root, args);
    case 'graph':
      return commandGraph(root, args);
    case 'skills':
      return commandSkills(root, args);
    case 'types':
      return commandTypes(root, args);
    case 'write':
      return commandWrite(root, args);
    default:
      throw new CliError({
        code: 'unknown_command',
        message: `Unknown command: ${args.command}.`,
        hint: 'Run `docs-harness schema`.',
      });
  }
}

function toSchemaAliasArgs(args: ReturnType<typeof parseArgs>): ReturnType<typeof parseArgs> {
  const flags = new Map(args.flags);
  flags.delete('help');
  flags.delete('h');
  return {
    command: 'schema',
    flags,
    positionals: args.positionals,
  };
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  writeFailure(error);
  process.exitCode = 1;
});
