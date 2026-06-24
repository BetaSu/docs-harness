import { type ParsedArgs, requireNoUnknownFlags } from '../lib/args.js';
import { CLI_VERSION } from '../lib/version.js';

export function commandVersion(args: ParsedArgs): { version: string } {
  requireNoUnknownFlags(args, ['root']);
  return { version: CLI_VERSION };
}
