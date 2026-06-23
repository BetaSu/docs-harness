import { type ParsedArgs, requireNoUnknownFlags } from '../lib/args.js';
import { CliError } from '../lib/envelope.js';
import { getDocumentType, loadDocumentTypes } from '../lib/document-types.js';

export async function commandTypes(
  root: string,
  args: ParsedArgs,
): Promise<
  | { types: Array<{ name: string; purpose: string; useWhen: string[] }> }
  | { type: Awaited<ReturnType<typeof getDocumentType>> }
> {
  requireNoUnknownFlags(args, ['root']);
  const [action = 'list', typeName = ''] = args.positionals;

  if (action === 'list') {
    const types = await loadDocumentTypes(root);
    return {
      types: types.map((definition) => ({
        name: definition.name,
        purpose: definition.purpose,
        useWhen: definition.useWhen,
      })),
    };
  }

  if (action === 'describe') {
    const type = await getDocumentType(root, typeName);
    if (!type) {
      throw new CliError({
        code: 'document_type_not_found',
        message: `Document type not found: ${typeName || '<missing>'}.`,
        hint: 'Run `docs-harness types list`.',
      });
    }
    return { type };
  }

  throw new CliError({
    code: 'unknown_types_action',
    message: `Unknown types action: ${action}.`,
    hint: 'Run `docs-harness types list` or `docs-harness types describe <type>`.',
  });
}
