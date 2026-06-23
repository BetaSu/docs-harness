import { getStringFlag, requireNoUnknownFlags, type ParsedArgs } from '../lib/args.js';
import { CliError } from '../lib/envelope.js';

type CommandSchema = {
  id: string;
  path: string[];
  summary: string;
  type: 'read' | 'write' | 'diagnostic' | 'destructiveAction';
  visibility: 'internal' | 'public';
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
    logs?: {
      runs: string;
      signal: string;
    };
    writes?: string[];
  };
  branches: string[];
  output?: Record<string, unknown>;
};

const LOG_CAPABILITY = {
  runs: '.docs-harness/logs/<YYYY-MM-DD>/runs.jsonl',
  signal: '.docs-harness/logs/<YYYY-MM-DD>/signal.jsonl',
};

const COMMANDS: CommandSchema[] = [
  {
    id: 'schema',
    path: ['schema'],
    summary: 'List public command contracts, or describe one command contract.',
    type: 'read',
    visibility: 'public',
    args: [
      { name: 'command', type: 'string', required: false },
      { name: 'internal', type: 'boolean', required: false },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
    },
    branches: ['unknown_flag', 'command_schema_not_found', 'success'],
  },
  {
    id: 'init',
    path: ['init'],
    summary: 'Create .docs-harness config, registry defaults, and the root route file.',
    type: 'write',
    visibility: 'public',
    args: [
      {
        name: 'agent',
        type: 'enum',
        required: false,
        values: ['generic', 'claude'],
      },
      { name: 'dry-run', type: 'boolean', required: false },
      { name: 'yes', type: 'boolean', required: false },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
      safety: { dryRun: 'supported', confirmation: 'required' },
      writes: [
        '.docs-harness/config.json',
        '.docs-harness/.gitignore',
        '.docs-harness/registry/document-types.json',
        'routeFile',
      ],
    },
    branches: ['unknown_flag', 'unknown_agent', 'dry_run', 'confirmation_required', 'success'],
  },
  {
    id: 'insight',
    path: ['insight'],
    summary: 'Return the complete functional entity README description and route entries relevant to a path.',
    type: 'read',
    visibility: 'public',
    args: [
      { name: 'path', type: 'path', required: false },
      { name: 'intent', type: 'string', required: false },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
    },
    branches: ['unknown_flag', 'route_not_found', 'success'],
    output: {
      fallback: 'boolean',
      path: 'string',
      requestedModulePath: 'string',
      module: {
        path: 'string',
        readme: {
          name: 'string',
          description: 'string',
        },
      },
      route: {
        path: 'string',
        entries: [{ name: 'string', description: 'string' }],
      },
      message: 'string?',
      hint: 'string?',
    },
  },
  {
    id: 'read',
    path: ['read'],
    summary: 'Read a document by stable name.',
    type: 'read',
    visibility: 'public',
    args: [
      { name: 'name', type: 'string', required: true },
      { name: 'intent', type: 'string', required: false },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
    },
    branches: [
      'unknown_flag',
      'missing_required_argument',
      'duplicate_document_name',
      'document_not_found',
      'non_target_document',
      'success',
    ],
    output: {
      name: 'string',
      description: 'string',
      kind: 'string',
      path: 'string',
      content: 'string',
    },
  },
  {
    id: 'validate',
    path: ['validate'],
    summary: 'Validate document graph links and document type structure.',
    type: 'diagnostic',
    visibility: 'public',
    args: [{ name: 'root', type: 'path', required: false }],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
    },
    branches: ['unknown_flag', 'validation_failed', 'success'],
    output: {
      success: {
        valid: true,
        issues: [],
      },
      failure: {
        code: 'validation_failed',
        issues: [
          {
            code: [
              'description_mismatch',
              'duplicate_name',
              'hard_line_limit_exceeded',
              'missing_description',
              'missing_metadata_description',
              'missing_name',
              'route_cycle',
              'target_name_duplicate',
              'target_not_found',
              'unreachable_route',
            ],
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
  },
  {
    id: 'graph',
    path: ['graph'],
    summary: 'Return document graph nodes, entries, and validation issues.',
    type: 'diagnostic',
    visibility: 'internal',
    args: [{ name: 'root', type: 'path', required: false }],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
    },
    branches: ['unknown_flag', 'success'],
  },
  {
    id: 'types.list',
    path: ['types', 'list'],
    summary: 'List document type contracts.',
    type: 'read',
    visibility: 'public',
    args: [{ name: 'root', type: 'path', required: false }],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
    },
    branches: ['unknown_flag', 'success'],
  },
  {
    id: 'types.describe',
    path: ['types', 'describe'],
    summary: 'Describe one document type contract.',
    type: 'read',
    visibility: 'public',
    args: [
      { name: 'type', type: 'string', required: true },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
    },
    branches: ['unknown_flag', 'document_type_not_found', 'success'],
  },
  {
    id: 'write',
    path: ['write'],
    summary: 'Preview or write a typed document and its route entry.',
    type: 'write',
    visibility: 'public',
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
      logs: LOG_CAPABILITY,
      safety: { dryRun: 'supported', confirmation: 'required' },
      writes: ['document', 'routeEntry'],
    },
    branches: [
      'unknown_flag',
      'document_type_not_found',
      'path_not_directory',
      'path_outside_root',
      'route_not_found',
      'duplicate_route_entry',
      'invalid_route_entry',
      'write_validation_failed',
      'dry_run',
      'confirmation_required',
      'success',
    ],
  },
  {
    id: 'intent.list',
    path: ['intent', 'list'],
    summary: 'List structured read/insight intent observations from run logs.',
    type: 'read',
    visibility: 'internal',
    args: [
      { name: 'since', type: 'string', required: false },
      { name: 'until', type: 'string', required: false },
      {
        name: 'command',
        type: 'enum',
        required: false,
        values: ['insight', 'read'],
      },
      { name: 'target', type: 'string', required: false },
      { name: 'limit', type: 'string', required: false },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
    },
    branches: [
      'unknown_flag',
      'unknown_intent_action',
      'invalid_intent_command_filter',
      'invalid_intent_limit',
      'success',
    ],
    output: {
      targets: [
        {
          name: 'string',
          usage: [
            {
              description: 'string',
              intent: 'string',
              count: 'number',
              evidence: ['insight_entry|read'],
              firstObservedAt: 'string',
              lastObservedAt: 'string',
            },
          ],
          observationCount: 'number',
          readCount: 'number',
          insightCount: 'number',
          path: 'string?',
          kind: 'string?',
          firstObservedAt: 'string',
          lastObservedAt: 'string',
        },
      ],
      observations: [
        {
          id: 'string',
          observedAt: 'string',
          command: 'insight|read',
          evidence: 'insight_entry|read',
          intent: 'string',
          target: {
            name: 'string',
            description: 'string',
            path: 'string?',
            kind: 'string?',
          },
          route: {
            path: 'string',
            requestedPath: 'string?',
            fallback: 'boolean?',
          },
        },
      ],
      count: 'number',
      targetCount: 'number',
    },
  },
  {
    id: 'signal.list',
    path: ['signal', 'list'],
    summary: 'List optimization signals from the logs.',
    type: 'read',
    visibility: 'internal',
    args: [
      { name: 'since', type: 'string', required: false },
      { name: 'until', type: 'string', required: false },
      { name: 'unhandled', type: 'boolean', required: false },
      { name: 'handled', type: 'boolean', required: false },
      { name: 'all', type: 'boolean', required: false },
      { name: 'dedupe', type: 'string', required: false },
      { name: 'limit', type: 'string', required: false },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
    },
    branches: ['unknown_flag', 'invalid_signal_limit', 'success'],
    output: {
      signals: [
        {
          version: 'string',
          id: 'string',
          createdAt: 'string',
          handled: 'boolean',
          handledAt: 'string?',
          frictionPattern: 'string',
          target: {
            kind: 'string',
            path: 'string?',
            name: 'string?',
            line: 'number?',
          },
          impact: 'string',
          suggestion: 'string',
        },
      ],
      count: 'number',
      dedupe: 'boolean',
      handled: 'boolean|all',
      since: 'string?',
      until: 'string?',
    },
  },
  {
    id: 'signal.mark-handled',
    path: ['signal', 'mark-handled'],
    summary: 'Mark one or more optimization signals as handled.',
    type: 'write',
    visibility: 'internal',
    args: [
      { name: 'id', type: 'string', required: true },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
      writes: ['.docs-harness/logs/<YYYY-MM-DD>/signal.jsonl'],
    },
    branches: ['unknown_flag', 'missing_required_argument', 'unknown_signal_action', 'success'],
    output: {
      ids: ['string'],
      matched: 'number',
      updated: 'number',
      handledAt: 'string',
    },
  },
  {
    id: 'skills.list',
    path: ['skills', 'list'],
    summary: 'List external built-in agent skills.',
    type: 'read',
    visibility: 'internal',
    args: [{ name: 'root', type: 'path', required: false }],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
    },
    branches: ['unknown_flag', 'success'],
  },
  {
    id: 'skills.read',
    path: ['skills', 'read'],
    summary: 'Read a built-in agent skill.',
    type: 'read',
    visibility: 'internal',
    args: [
      { name: 'name', type: 'string', required: true },
      { name: 'root', type: 'path', required: false },
    ],
    capabilities: {
      output: { envelope: 'json', stdout: 'json-only' },
      logs: LOG_CAPABILITY,
    },
    branches: ['unknown_flag', 'skill_not_found', 'success'],
  },
];

export function commandSchema(args: ParsedArgs): {
  commands?: Array<{
    id: string;
    path: string[];
    summary: string;
    type: CommandSchema['type'];
    visibility: CommandSchema['visibility'];
  }>;
  command?: CommandSchema;
} {
  requireNoUnknownFlags(args, ['command', 'internal', 'root']);
  const commandId = getStringFlag(args, 'command');

  if (!commandId) {
    const includeInternal = args.flags.get('internal') === true;
    return {
      commands: COMMANDS
        .filter((command) => includeInternal || command.visibility === 'public')
        .map((command) => ({
          id: command.id,
          path: command.path,
          summary: command.summary,
          type: command.type,
          visibility: command.visibility,
        })),
    };
  }

  const command = COMMANDS.find((candidate) => candidate.id === commandId);
  if (!command) {
    throw new CliError({
      code: 'command_schema_not_found',
      message: `Command schema not found: ${commandId}.`,
      hint: 'Run `docs-harness schema`.',
    });
  }

  return { command };
}
