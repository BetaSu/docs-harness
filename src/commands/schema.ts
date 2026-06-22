import { getStringFlag, requireNoUnknownFlags, type ParsedArgs } from '../lib/args.js';
import { CliError } from '../lib/envelope.js';

type CommandSchema = {
  id: string;
  path: string[];
  summary: string;
  type: 'read' | 'write' | 'diagnostic' | 'destructiveAction';
  args: Array<{
    name: string;
    type: 'boolean' | 'enum' | 'path' | 'string';
    required: boolean;
    values?: string[];
  }>;
  capabilities: {
    output: {
      envelope: 'json';
      stdout: 'json-only';
    };
    safety?: {
      dryRun?: 'supported' | 'required';
      confirmation?: 'required';
    };
    writes?: string[];
  };
  branches: string[];
  output?: Record<string, unknown>;
};

const COMMANDS: CommandSchema[] = [
  {
    id: 'init',
    path: ['init'],
    summary: 'Create .docs-harness config, registry defaults, and the root route file.',
    type: 'write',
    args: [
      {
        name: 'agent',
        type: 'enum',
        required: false,
        values: ['codex', 'claude'],
      },
      { name: 'dry-run', type: 'boolean', required: false },
      { name: 'yes', type: 'boolean', required: false },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      safety: { dryRun: 'supported', confirmation: 'required' },
      writes: ['.docs-harness/config.json', '.docs-harness/registry/document-types.json', 'routeFile'],
    },
    branches: ['validation_error', 'dry_run', 'confirmation_required', 'success'],
  },
  {
    id: 'insight',
    path: ['insight'],
    summary: 'List document entries relevant to a path.',
    type: 'read',
    args: [
      { name: 'path', type: 'path', required: false },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
    },
    branches: ['validation_error', 'not_found', 'success'],
  },
  {
    id: 'show',
    path: ['show'],
    summary: 'Read a document by stable name.',
    type: 'read',
    args: [
      { name: 'name', type: 'string', required: true },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
    },
    branches: ['validation_error', 'not_found', 'success'],
  },
  {
    id: 'validate',
    path: ['validate'],
    summary: 'Validate document graph links and document type structure.',
    type: 'diagnostic',
    args: [{ name: 'root', type: 'path', required: false }],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
    },
    branches: ['success'],
    output: {
      valid: 'boolean',
      issues: [
        {
          code: 'string',
          path: 'string',
          message: 'string',
          hint: 'string',
          line: 'number?',
          name: 'string?',
          type: 'string?',
        },
      ],
    },
  },
  {
    id: 'graph',
    path: ['graph'],
    summary: 'Return document graph nodes, entries, and validation issues.',
    type: 'diagnostic',
    args: [{ name: 'root', type: 'path', required: false }],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
    },
    branches: ['success'],
  },
  {
    id: 'types.list',
    path: ['types', 'list'],
    summary: 'List document type contracts.',
    type: 'read',
    args: [{ name: 'root', type: 'path', required: false }],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
    },
    branches: ['success'],
  },
  {
    id: 'types.describe',
    path: ['types', 'describe'],
    summary: 'Describe one document type contract.',
    type: 'read',
    args: [
      { name: 'type', type: 'string', required: true },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
    },
    branches: ['validation_error', 'not_found', 'success'],
  },
  {
    id: 'write',
    path: ['write'],
    summary: 'Preview or write a typed document and its route entry.',
    type: 'write',
    args: [
      { name: 'type', type: 'string', required: true },
      { name: 'path', type: 'path', required: false },
      { name: 'name', type: 'string', required: false },
      { name: 'description', type: 'string', required: false },
      { name: 'body', type: 'string', required: true },
      { name: 'no-route-entry', type: 'boolean', required: false },
      { name: 'dry-run', type: 'boolean', required: false },
      { name: 'yes', type: 'boolean', required: false },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      safety: { dryRun: 'supported', confirmation: 'required' },
      writes: ['document', 'routeEntry'],
    },
    branches: [
      'validation_error',
      'route_not_found',
      'route_entry_validation_error',
      'dry_run',
      'confirmation_required',
      'success',
    ],
  },
  {
    id: 'skills.list',
    path: ['skills', 'list'],
    summary: 'List built-in operating skills.',
    type: 'read',
    args: [{ name: 'root', type: 'path', required: false }],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
    },
    branches: ['success'],
  },
  {
    id: 'skills.read',
    path: ['skills', 'read'],
    summary: 'Read a built-in operating skill.',
    type: 'read',
    args: [
      { name: 'name', type: 'string', required: true },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
    },
    branches: ['validation_error', 'not_found', 'success'],
  },
];

export function commandSchema(args: ParsedArgs): {
  commands?: Array<{ id: string; path: string[]; summary: string; type: CommandSchema['type'] }>;
  command?: CommandSchema;
} {
  requireNoUnknownFlags(args, ['command', 'root']);
  const commandId = getStringFlag(args, 'command');

  if (!commandId) {
    return {
      commands: COMMANDS.map((command) => ({
        id: command.id,
        path: command.path,
        summary: command.summary,
        type: command.type,
      })),
    };
  }

  const command = COMMANDS.find((candidate) => candidate.id === commandId);
  if (!command) {
    throw new CliError({
      type: 'not_found',
      message: `Command schema not found: ${commandId}.`,
      hint: 'Run docs-harness schema.',
    });
  }

  return { command };
}
