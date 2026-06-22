import { CliError } from '../lib/envelope.js';
import { type ParsedArgs, requireNoUnknownFlags } from '../lib/args.js';

type Skill = {
  name: string;
  version: string;
  description: string;
  content: string;
};

const CORE_SKILL: Skill = {
  name: 'core',
  version: '0.1.0',
  description: 'Operating rules for invoking docs-harness from coding agents.',
  content: `# docs-harness Core Operating Rules

## When To Use

Use docs-harness when you need to discover project documentation, read a document by stable name, or validate document graph links.

## Command Contract

Run docs-harness schema to list command ids. Run docs-harness schema --command <command-id> before using an unfamiliar command. Schema owns command paths, arguments, output shape, safety capabilities, and branches.

## Project Registry

After init, document type contracts are read from .docs-harness/registry/document-types.json. Treat that file as the project-local source of truth. Before init, docs-harness falls back to bundled defaults.

## Output Contract

stdout is always a JSON envelope. Do not parse stderr or human text.

Success:

\`\`\`json
{ "ok": true, "data": {} }
\`\`\`

Failure:

\`\`\`json
{ "ok": false, "error": { "type": "validation", "message": "...", "hint": "..." } }
\`\`\`

## Error Recovery

- validation: fix the command arguments and retry.
- not_found: run insight or validate to discover valid document names; for write route failures, initialize or create the needed route before retrying.
- confirmation_required: ask the user before retrying with the suggested confirmation.
- runtime: inspect the message, then retry only if the cause is transient.

## Document Write Flow

1. Run docs-harness types list or docs-harness types describe <type> to choose a document type.
2. Run docs-harness write ... --dry-run and inspect data.target, data.routeEntry, data.changes, and data.errors.
3. Ask the user before retrying with --yes when changes are not all noop.
4. Run docs-harness validate after writing.

By default, write maintains both the target document and the nearest ancestor route entry. Pass --no-route-entry only when the user explicitly wants an unlinked draft or a migration step.

## Safety Rules

- Do not guess document paths when a stable name is available.
- Do not parse Markdown tables from stdout; parse the JSON envelope.
- Do not auto-confirm write operations, including route entry updates performed by write.
- Run init with --dry-run first. Use --yes only after the user approves the plan.
`,
};

const SKILLS = new Map<string, Skill>([[CORE_SKILL.name, CORE_SKILL]]);

export function commandSkills(args: ParsedArgs): {
  skills?: Array<{ name: string; version: string; description: string }>;
  name?: string;
  version?: string;
  content?: string;
} {
  requireNoUnknownFlags(args, ['root']);
  const [action = 'list', name = ''] = args.positionals;

  if (action === 'list') {
    return {
      skills: [...SKILLS.values()].map((skill) => ({
        name: skill.name,
        version: skill.version,
        description: skill.description,
      })),
    };
  }

  if (action === 'read') {
    const skill = SKILLS.get(name);
    if (!skill) {
      throw new CliError({
        type: 'not_found',
        message: `Skill not found: ${name || '<missing>'}.`,
        hint: 'Run docs-harness skills list.',
      });
    }

    return {
      name: skill.name,
      version: skill.version,
      content: skill.content,
    };
  }

  throw new CliError({
    type: 'validation',
    message: `Unknown skills action: ${action}.`,
    hint: 'Run docs-harness skills list or docs-harness skills read core.',
  });
}
