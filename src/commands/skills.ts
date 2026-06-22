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
4. Run docs-harness validate after writing and inspect data.issues when data.valid is false.

By default, write maintains both the target document and the nearest ancestor route entry. Pass --no-route-entry only when the user explicitly wants an unlinked draft or a migration step.

## Safety Rules

- Do not guess document paths when a stable name is available.
- Do not parse Markdown tables from stdout; parse the JSON envelope.
- Do not auto-confirm write operations, including route entry updates performed by write.
- Run init with --dry-run first. Use --yes only after the user approves the plan.
`,
};

const DOCUMENT_REPAIR_SKILL: Skill = {
  name: 'document-repair',
  version: '0.1.0',
  description: 'Repair workflow for docs-harness validate issues.',
  content: `# docs-harness Document Repair

Use this when docs-harness validate returns data.valid=false.

## Workflow

1. Read data.issues. Do not parse free-text summaries.
2. Group issues by path.
3. For graph issues such as target_not_found, missing_name, missing_description, duplicate_name, or missing_sibling_route, fix the route entry or create the missing document with docs-harness write --dry-run first.
4. For missing_required_section, add the required Markdown heading shown in issue.message. Use a heading level that matches the document structure; ## is preferred for top-level required sections.
5. For hard_line_limit_exceeded, shorten the document or split it into a smaller typed document and link the new document through the nearest route.
6. For missing_metadata_name or missing_metadata_description, add frontmatter or regenerate the document with docs-harness write --dry-run.
7. Rerun docs-harness validate and repeat until data.valid=true.

## Safety Rules

- Do not add --yes until the user has reviewed a dry-run for generated writes.
- Preserve existing route entry names unless validate reports a concrete name problem.
- Keep descriptions task-oriented: explain when an agent should read the document.
`,
};

const SKILLS = new Map<string, Skill>([
  [CORE_SKILL.name, CORE_SKILL],
  [DOCUMENT_REPAIR_SKILL.name, DOCUMENT_REPAIR_SKILL],
]);

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
