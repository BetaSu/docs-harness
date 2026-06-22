#!/usr/bin/env node

import { parseArgs } from './lib/args.js';
import { CliError, writeFailure, writeSuccess } from './lib/envelope.js';
import { resolveProjectRoot } from './lib/project.js';
import { commandInit } from './commands/init.js';
import { commandGraph, commandInsight, commandShow, commandValidate } from './commands/graph.js';
import { commandHelp } from './commands/help.js';
import { commandSchema } from './commands/schema.js';
import { commandSkills } from './commands/skills.js';
import { commandTypes } from './commands/types.js';
import { commandWrite } from './commands/write.js';

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const root = resolveProjectRoot(args);

  switch (args.command) {
    case 'help':
    case '--help':
    case '-h':
      writeSuccess(commandHelp());
      return;
    case 'schema':
      writeSuccess(commandSchema(args));
      return;
    case 'init':
      writeSuccess(await commandInit(root, args));
      return;
    case 'insight':
      writeSuccess(await commandInsight(root, args));
      return;
    case 'show':
      writeSuccess(await commandShow(root, args));
      return;
    case 'validate':
      writeSuccess(await commandValidate(root, args));
      return;
    case 'graph':
      writeSuccess(await commandGraph(root, args));
      return;
    case 'skills':
      writeSuccess(commandSkills(args));
      return;
    case 'types':
      writeSuccess(await commandTypes(root, args));
      return;
    case 'write':
      writeSuccess(await commandWrite(root, args));
      return;
    default:
      throw new CliError({
        type: 'validation',
        message: `Unknown command: ${args.command}.`,
        hint: 'Run docs-harness schema.',
      });
  }
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  writeFailure(error);
  process.exitCode = 1;
});
