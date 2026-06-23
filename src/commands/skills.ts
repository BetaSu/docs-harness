import { type ParsedArgs, requireNoUnknownFlags } from '../lib/args.js';
import { loadDocumentTypes } from '../lib/document-types.js';
import { CliError } from '../lib/envelope.js';
import { buildBuiltinSkills } from '../lib/skill-templates.js';

export async function commandSkills(root: string, args: ParsedArgs): Promise<{
  skills?: Array<{ name: string; version: string; description: string }>;
  name?: string;
  version?: string;
  content?: string;
}> {
  requireNoUnknownFlags(args, ['root']);
  const [action = 'list', name = ''] = args.positionals;
  const skillIndex = buildBuiltinSkills();

  if (action === 'list') {
    const externalSkills = skillIndex.filter((skill) => skill.visibility === 'external');
    return {
      skills: externalSkills.map((skill) => ({
        name: skill.name,
        version: skill.version,
        description: skill.description,
      })),
    };
  }

  if (action === 'read') {
    if (!skillIndex.some((skill) => skill.name === name)) {
      throw new CliError({
        code: 'skill_not_found',
        message: `Skill not found: ${name || '<missing>'}.`,
        hint: 'Run `docs-harness skills list`.',
      });
    }

    const skills = buildBuiltinSkills({ documentTypes: await loadDocumentTypes(root) });
    const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
    const skill = skillsByName.get(name);
    if (!skill) {
      throw new CliError({
        code: 'skill_not_found',
        message: `Skill not found: ${name || '<missing>'}.`,
        hint: 'Run `docs-harness skills list`.',
      });
    }

    return { name: skill.name, version: skill.version, content: skill.content };
  }

  throw new CliError({
    code: 'unknown_skills_action',
    message: `Unknown skills action: ${action}.`,
    hint: 'Run `docs-harness skills list` or `docs-harness skills read agent-init`.',
  });
}
