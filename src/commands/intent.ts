import {
  getStringFlag,
  requireNoUnknownFlags,
  type ParsedArgs,
} from '../lib/args.js';
import { CliError } from '../lib/envelope.js';
import {
  readIntentObservations,
  type IntentCommandFilter,
} from '../lib/intents.js';

export async function commandIntent(
  root: string,
  args: ParsedArgs,
): Promise<Awaited<ReturnType<typeof readIntentObservations>>> {
  const [action = 'list'] = args.positionals;

  if (action === 'list') {
    requireNoUnknownFlags(args, ['command', 'limit', 'root', 'since', 'target', 'until']);
    return readIntentObservations({
      root,
      since: getStringFlag(args, 'since'),
      until: getStringFlag(args, 'until'),
      command: resolveCommandFilter(getStringFlag(args, 'command')),
      target: getStringFlag(args, 'target') || undefined,
      limit: resolveLimit(getStringFlag(args, 'limit')),
    });
  }

  throw new CliError({
    code: 'unknown_intent_action',
    message: `Unknown intent action: ${action}.`,
    hint: 'Run `docs-harness intent list`.',
  });
}

function resolveCommandFilter(value: string): IntentCommandFilter | undefined {
  if (!value) return undefined;
  if (value === 'insight' || value === 'read') return value;

  throw new CliError({
    code: 'invalid_intent_command_filter',
    message: `Intent command filter must be "insight" or "read": ${value}.`,
    hint: 'Pass `--command insight`, `--command read`, or omit the flag.',
  });
}

function resolveLimit(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError({
      code: 'invalid_intent_limit',
      message: `Intent limit must be a non-negative integer: ${value}.`,
      hint: 'Pass `--limit <number>` or omit the flag.',
    });
  }
  return parsed;
}
