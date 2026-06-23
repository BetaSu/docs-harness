import {
  getBooleanFlag,
  getStringFlag,
  requireNoUnknownFlags,
  type ParsedArgs,
} from '../lib/args.js';
import { CliError } from '../lib/envelope.js';
import { markSignalsHandled, readSignals, type SignalHandledFilter } from '../lib/signals.js';

export async function commandSignal(
  root: string,
  args: ParsedArgs,
): Promise<
  | Awaited<ReturnType<typeof readSignals>>
  | Awaited<ReturnType<typeof markSignalsHandled>>
> {
  const [action = 'list', ...ids] = args.positionals;

  if (action === 'list') {
    requireNoUnknownFlags(args, [
      'all',
      'dedupe',
      'handled',
      'limit',
      'root',
      'since',
      'unhandled',
      'until',
    ]);
    return readSignals({
      root,
      since: getStringFlag(args, 'since'),
      until: getStringFlag(args, 'until'),
      handled: resolveHandledFilter(args),
      dedupe: resolveDedupe(args),
      limit: resolveLimit(args),
    });
  }

  if (action === 'mark-handled') {
    requireNoUnknownFlags(args, ['root']);
    if (ids.length === 0) {
      throw new CliError({
        code: 'missing_required_argument',
        message: 'Missing required argument: id.',
        hint: 'Run `docs-harness signal list --unhandled`, then `docs-harness signal mark-handled <id>`.',
      });
    }
    return markSignalsHandled(root, ids);
  }

  throw new CliError({
    code: 'unknown_signal_action',
    message: `Unknown signal action: ${action}.`,
    hint: 'Run `docs-harness signal list` or `docs-harness signal mark-handled <id>`.',
  });
}

function resolveHandledFilter(args: ParsedArgs): SignalHandledFilter {
  if (getBooleanFlag(args, 'all')) return 'all';
  if (getBooleanFlag(args, 'handled')) return true;
  if (getBooleanFlag(args, 'unhandled')) return false;
  return false;
}

function resolveDedupe(args: ParsedArgs): boolean {
  const value = getStringFlag(args, 'dedupe');
  if (value === 'false' || value === '0' || value === 'no') return false;
  return true;
}

function resolveLimit(args: ParsedArgs): number | undefined {
  const value = getStringFlag(args, 'limit');
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError({
      code: 'invalid_signal_limit',
      message: `Signal limit must be a non-negative integer: ${value}.`,
      hint: 'Pass `--limit <number>` or omit the flag.',
    });
  }
  return parsed;
}
