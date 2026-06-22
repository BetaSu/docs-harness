import { CliError } from './envelope.js';

export type ParsedArgs = {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const [rawCommand = 'schema', ...rest] = argv;
  const command = rawCommand.startsWith('--') ? 'help' : rawCommand;
  const tokens = rawCommand.startsWith('--') ? argv : rest;
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const equalsIndex = token.indexOf('=');
    if (equalsIndex >= 0) {
      flags.set(token.slice(2, equalsIndex), token.slice(equalsIndex + 1));
      continue;
    }

    const key = token.slice(2);
    const next = tokens[index + 1];
    if (next && !next.startsWith('--') && expectsValue(key)) {
      flags.set(key, next);
      index += 1;
      continue;
    }

    flags.set(key, true);
  }

  return { command, flags, positionals };
}

export function getStringFlag(args: ParsedArgs, name: string): string {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : '';
}

export function getBooleanFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

export function requireNoUnknownFlags(args: ParsedArgs, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = [...args.flags.keys()].filter((name) => !allowedSet.has(name));
  if (unknown.length === 0) return;

  throw new CliError({
    type: 'validation',
    message: `Unknown flag: --${unknown[0]}.`,
    hint: 'Run docs-harness schema.',
  });
}

function expectsValue(key: string): boolean {
  return new Set([
    'agent',
    'body',
    'command',
    'description',
    'file',
    'name',
    'path',
    'root',
    'type',
  ]).has(key);
}
