import { CLI_VERSION } from './version.js';
import type { DocumentTypeDefinition } from './document-types.js';

export type BuiltinSkill = {
  name: string;
  version: string;
  description: string;
  visibility: 'external' | 'internal';
  content: string;
};

type SkillTemplateContext = {
  agentInitSkill: string;
  cli: string;
  documentDriftAnalysisSkill: string;
  documentRepairSkill: string;
  documentQualityMaintenanceSkill: string;
  documentTypes: DocumentTypeDefinition[];
  intentListCommand: string;
  skillVersion: string;
  signalLogPath: string;
  signalListCommand: string;
  signalMarkHandledCommand: string;
  signalRepairSkill: string;
  typesDescribeCommand: string;
  typesListCommand: string;
  validateCommand: string;
  writeApplyCommand: string;
  writeDryRunCommand: string;
};

const DEFAULT_CONTEXT: SkillTemplateContext = {
  agentInitSkill: 'agent-init',
  cli: 'docs-harness',
  documentDriftAnalysisSkill: 'document-drift-analysis',
  documentQualityMaintenanceSkill: 'schedule-document-quality-maintenance',
  documentRepairSkill: 'document-repair',
  documentTypes: [],
  intentListCommand: 'docs-harness intent list',
  skillVersion: CLI_VERSION,
  signalLogPath: '.docs-harness/logs/<YYYY-MM-DD>/signal.jsonl',
  signalListCommand: 'docs-harness signal list --unhandled',
  signalMarkHandledCommand: 'docs-harness signal mark-handled <id>',
  signalRepairSkill: 'signal-repair',
  typesDescribeCommand: 'docs-harness types describe <type>',
  typesListCommand: 'docs-harness types list',
  validateCommand: 'docs-harness validate',
  writeApplyCommand: 'docs-harness write ... --yes',
  writeDryRunCommand: 'docs-harness write ... --dry-run',
};

export function buildBuiltinSkills(
  overrides: Partial<SkillTemplateContext> = {},
): BuiltinSkill[] {
  const context = { ...DEFAULT_CONTEXT, ...overrides };
  return [
    buildAgentInitSkill(context),
    buildDocumentQualityMaintenanceSkill(context),
    buildDocumentRepairSkill(context),
    buildSignalRepairSkill(context),
    buildDocumentDriftAnalysisSkill(context),
  ];
}

function buildAgentInitSkill(context: SkillTemplateContext): BuiltinSkill {
  return {
    name: context.agentInitSkill,
    version: context.skillVersion,
    description: `${context.cli} agent init skill for initializing a project, validating and repairing document issues, and recommending scheduled maintenance.`,
    visibility: 'external',
    content: joinSections(
      `# ${context.cli} Agent Init`,
      renderCoreWhenToUse(context),
      renderAgentInitFlow(context),
      renderCommandContract(context),
      renderProjectRegistry(context),
      renderOutputContract(),
      renderLogs(context),
      renderErrorRecovery(context),
      renderCoreSafetyRules(),
    ),
  };
}

function buildDocumentQualityMaintenanceSkill(context: SkillTemplateContext): BuiltinSkill {
  return {
    name: context.documentQualityMaintenanceSkill,
    version: context.skillVersion,
    description: `${context.cli} scheduled workflow for maintaining document quality by processing signals and intent-driven drift.`,
    visibility: 'external',
    content: joinSections(
      `# ${context.cli} Scheduled Document Quality Maintenance`,
      `Use this as a scheduled or periodic maintenance workflow. For a currently blocked command, follow the returned hint and read ${context.documentRepairSkill} instead.`,
      renderScheduleWindow(context),
      renderScheduledSignalPhase(context),
      renderScheduledDriftPhase(context),
      renderScheduledFinish(context),
    ),
  };
}

function buildDocumentRepairSkill(context: SkillTemplateContext): BuiltinSkill {
  return {
    name: context.documentRepairSkill,
    version: context.skillVersion,
    description: `${context.cli} execution repair workflow for blocking document graph, route, metadata, or type-contract failures.`,
    visibility: 'internal',
    content: joinSections(
      `# ${context.cli} Document Repair`,
      `Use this when a ${context.cli} command is blocked by a document graph, route, metadata, or type-contract failure and the returned hint points to this skill.`,
      renderValidateIssueEntry(context),
      renderRepairByContract(context),
      renderDocumentTypeContracts(context),
      renderRepairSafetyRules(context),
    ),
  };
}

function buildSignalRepairSkill(context: SkillTemplateContext): BuiltinSkill {
  return {
    name: context.signalRepairSkill,
    version: context.skillVersion,
    description: `${context.cli} workflow for repairing the document-quality friction described by handled=false signal records.`,
    visibility: 'internal',
    content: joinSections(
      `# ${context.cli} Signal Repair`,
      `Use this when ${context.signalListCommand} returns handled=false records that should be inspected or repaired.`,
      renderSignalEntry(context),
      renderRepairByContract(context),
      renderDocumentTypeContracts(context),
      renderSignalFinish(context),
      renderRepairSafetyRules(context),
    ),
  };
}

function buildDocumentDriftAnalysisSkill(context: SkillTemplateContext): BuiltinSkill {
  return {
    name: context.documentDriftAnalysisSkill,
    version: context.skillVersion,
    description: `${context.cli} workflow for comparing target name, description, intent, document content, and relevant source code to detect and correct documentation drift.`,
    visibility: 'internal',
    content: joinSections(
      `# ${context.cli} Document Drift Analysis`,
      `Use this when recent agent intent observations need to be compared with target names, descriptions, actual document content, and relevant source code before deciding whether documentation has drifted.`,
      renderIntentObservationEntry(context),
      renderRepairByContract(context),
      renderDocumentTypeContracts(context),
      renderDriftAnalysisFinish(context),
      renderRepairSafetyRules(context),
    ),
  };
}

function renderCoreWhenToUse(context: SkillTemplateContext): string {
  return `## When To Use

Use this when an agent needs to initialize ${context.cli} in a project, or bring an existing project to a valid docs-harness baseline before normal document work.`;
}

function renderAgentInitFlow(context: SkillTemplateContext): string {
  return `## Agent Init Flow

1. Decide the init agent from your runtime identity:
   - If you are Claude, use \`--agent claude\`.
   - Otherwise, use \`--agent generic\`.
2. Tell the user which agent identity and entry file you plan to use, then ask them to confirm or correct it.
3. After the agent identity is confirmed, run \`${context.cli} init --agent <agent> --dry-run\`.
4. Use data.impact to confirm the document management scope with the user:
   - State how many Markdown documents will be managed.
   - List data.impact.managedMarkdown in returned order.
   - List data.impact.defaultSkippedMarkdown as documents you will not manage by default.
   - Offer data.impact.skipCandidates as paths the user can ask you to skip for now.
   - Do not explain the mechanical file changes from data.changes unless the user asks.
5. After the user confirms the agent identity and management scope, run \`${context.cli} init --agent <agent> --yes\`.
6. If the user asked you to skip paths, apply those skip choices to the project configuration after init and before validation. Keep the explanation user-facing: say you will ignore those paths for now, not how the configuration is implemented.
7. Run \`${context.validateCommand}\`.
8. If validation fails, read \`${context.cli} skills read ${context.documentRepairSkill}\`, repair every reported issue, then rerun \`${context.validateCommand}\`. Repeat until validation succeeds.
9. When validation succeeds, summarize the initialized state and any document decisions made during repair.
10. Recommend that the user configure \`${context.cli} skills read ${context.documentQualityMaintenanceSkill}\` as a daily idle-time document maintenance workflow. Use this skill to keep project documents synchronized with the actual project over time. If the current agent supports long-running or recurring capabilities such as goals, loops, scheduled tasks, monitors, or automations, recommend using that native capability to run the maintenance workflow automatically. Otherwise, tell the user they can run the maintenance skill manually when they want to clean up document drift.`;
}

function renderCommandContract(context: SkillTemplateContext): string {
  return `## Command Contract

Run \`${context.cli} schema\` to list command ids. Run \`${context.cli} schema --command <command-id>\` before using an unfamiliar command. Schema owns command paths, arguments, output shape, safety capabilities, and branches. Treat branches as possible success states or error.code values.

When running \`${context.cli} insight\` or \`${context.cli} read\` for a real task, pass \`--intent "<why this lookup/read is needed>"\` when you can state the purpose clearly. Intent is usage evidence for later document-content correction; it does not affect command success, target selection, validation, or signal ids.`;
}

function renderProjectRegistry(context: SkillTemplateContext): string {
  return `## Project Registry

After init, document type contracts are read from \`.docs-harness/registry/document-types.json\`. Treat that file as the project-local source of truth. The project config may also define gitignore-style \`ignore\` patterns for Markdown that is intentionally outside the current adoption scope. Before init, \`${context.cli}\` falls back to bundled defaults. Repair workflows must use \`${context.typesListCommand}\` and \`${context.typesDescribeCommand}\`; do not hard-code document type guidance or line limits.`;
}

function renderDocumentTypeContracts(context: SkillTemplateContext): string {
  if (context.documentTypes.length === 0) {
    return `## Current Document Type Contracts

No document type contracts were loaded into this skill output. Run \`${context.typesListCommand}\` and \`${context.typesDescribeCommand}\` before creating or repairing typed documents. Treat configured sections as writing guidance, not mandatory headings.`;
  }

  return `## Current Document Type Contracts

These contracts are generated from the current project registry when this skill is read. If the registry changes, read this skill again or run \`${context.typesDescribeCommand}\`.

${context.documentTypes.map(renderDocumentTypeContract).join('\n\n')}`;
}

function renderDocumentTypeContract(type: DocumentTypeDefinition): string {
  const useWhen = type.useWhen.map((item) => `  - ${item}`).join('\n');
  const sections = type.sections.length
    ? type.sections.map((section) => `  - ${section.heading}`).join('\n')
    : '  - none';

  return `### ${type.name}

Purpose: ${type.purpose}

Use when:
${useWhen}

Constraints:
- pathPattern: ${type.pathPattern}
- requiresName: ${formatBoolean(type.requiresName)}
- requiresDescription: ${formatBoolean(type.requiresDescription)}
- requiresReadme: ${formatBoolean(type.requiresReadme)}
- requiresRoute: ${formatBoolean(type.requiresRoute)}
- softLineLimit: ${type.softLineLimit}
- hardLineLimit: ${type.hardLineLimit}

Suggested sections:
${sections}`;
}

function renderOutputContract(): string {
  return `## Output Contract

stdout is always a JSON envelope. Do not parse stderr or human text.

Success:

\`\`\`json
{ "ok": true, "data": {} }
\`\`\`

Failure:

\`\`\`json
{ "ok": false, "error": { "code": "document_not_found", "message": "...", "hint": "..." } }
\`\`\`

Field rules:

- ok: whether the command completed its semantic goal.
- data: successful command result; present only when ok=true.
- error: failed command result; present only when ok=false.
- error.code: stable machine-readable failure code. Use this for branching.
- error.message: short description of what happened. Do not parse it for control flow.
- error.hint: suggested next action for a human or agent.
- error.confirm: explicit confirmation flag required to continue, such as \`--yes\`.
- error.issues: detailed validation issues for aggregate failures such as validation_failed.
- issue.code: stable machine-readable code for one validation issue.
- issue.message: concrete description of that issue.
- issue.hint: suggested fix for that issue.

Exit status mirrors ok: 0 for ok=true, nonzero for ok=false.`;
}

function renderLogs(context: SkillTemplateContext): string {
  return `## Logs

After init, commands may write execution records to \`.docs-harness/logs/<YYYY-MM-DD>/runs.jsonl\`. insight/read calls may include an intent field when \`--intent\` is supplied; use \`${context.intentListCommand}\` to inspect these observations. Commands may also write optimization signals to \`${context.signalLogPath}\` for document-quality friction discovered during execution: non-blocking problems that cannot be automatically repaired and affect the practical document experience. Successful \`${context.validateCommand}\` runs write global optimization signals while keeping stdout focused on hard validation issues. Generated logs are ignored by \`.docs-harness/.gitignore\`.`;
}

function renderErrorRecovery(context: SkillTemplateContext): string {
  return `## Error Recovery

- unknown_flag, unknown_command, unknown_*_action, unknown_agent, missing_required_argument, path_not_directory, path_outside_root: fix the command arguments and retry.
- document_not_found, document_type_not_found, skill_not_found, command_schema_not_found: run the relevant list, insight, schema, or validate command to discover valid names.
- document_ignored: if the document should be managed, manually edit \`.docs-harness/config.json\` and remove or narrow the matching \`ignore\` pattern; otherwise choose a managed document.
- ignored_target_referenced: if the target should be managed, manually edit \`.docs-harness/config.json\` and remove or narrow the matching \`ignore\` pattern; otherwise remove the route entry.
- non_target_document: read the repair workflow and convert, migrate, or remove the existing non-target document.
- route_not_found: initialize \`${context.cli}\`, create the needed route, or pass \`--no-route-entry\` only when the user explicitly wants an unlinked document.
- validation_failed: read error.issues and repair each issue by code.
- write_validation_failed: inspect the returned hint, then retry with corrected document input.
- confirmation_required: ask the user before retrying with the suggested confirmation.
- runtime_error: inspect the message, then retry only if the cause is transient.`;
}

function renderDocumentWriteFlow(context: SkillTemplateContext): string {
  return `## Document Write Flow

1. Run \`${context.typesListCommand}\` or \`${context.typesDescribeCommand}\` to choose a document type.
2. Run \`${context.writeDryRunCommand}\` and inspect data.target, data.routeEntry, data.changes, and data.errors.
3. Ask the user before retrying with \`--yes\` when changes are not all noop.
4. Run \`${context.validateCommand}\` after writing. Success means data.valid=true. Failure with error.code=validation_failed means inspect error.issues and repair them.

By default, write maintains both the target document and the nearest ancestor route entry. Pass \`--no-route-entry\` only when the user explicitly wants an unlinked draft or a migration step.

Document descriptions are read triggers, not summaries. In English, prefer "Use when ..."; in other languages, use equivalent task-oriented phrasing. Route entry descriptions must match target document metadata descriptions exactly.`;
}

function renderCoreSafetyRules(): string {
  return `## Safety Rules

- Do not guess document paths when a stable name is available.
- Do not parse Markdown tables from stdout; parse the JSON envelope.
- Do not auto-confirm write operations, including route entry updates performed by write.
- Run init with \`--dry-run\` first. Use \`--yes\` only after the user approves the plan.`;
}

function renderValidateIssueEntry(context: SkillTemplateContext): string {
  return `## Entry: Execution Repair

1. Read the command failure envelope and the returned hint.
2. If error.issues exists, group issues by path and identify the complete functional entity each path belongs to.
3. Use issue.code only to locate the symptom. The repair should follow "Repair By Contract"; do not assume a one-line patch is enough.
4. For hard_line_limit_exceeded or a document whose content does not match its current role, split or migrate content into documents whose contracts come from \`${context.typesDescribeCommand}\`.
5. Rerun the blocked command, then run \`${context.validateCommand}\` when a document or route was changed.`;
}

function renderScheduleWindow(context: SkillTemplateContext): string {
  return `## Entry: Review Window

1. Choose the maintenance time range before collecting data. Use a concrete since/until window, usually from the previous scheduled run to now.
2. Run \`${context.validateCommand}\` first.
3. If validation fails, stop scheduled maintenance and read \`${context.cli} skills read ${context.documentRepairSkill}\`. Complete the blocking repair before continuing.
4. Use the same time range for signal review and intent drift review so the final report is coherent.`;
}

function renderScheduledSignalPhase(context: SkillTemplateContext): string {
  return `## Phase 1: Signal Repair

1. Read the internal workflow with \`${context.cli} skills read ${context.signalRepairSkill}\`.
2. Run \`${context.signalListCommand}\` with the selected time range when applicable.
3. Process handled=false signals using the internal signal repair workflow.
4. Repair only when the signal reflects real document-quality friction.
5. Mark each processed signal handled after repair, or after deciding no document change is needed.`;
}

function renderScheduledDriftPhase(context: SkillTemplateContext): string {
  return `## Phase 2: Intent Drift Analysis

1. Read the internal workflow with \`${context.cli} skills read ${context.documentDriftAnalysisSkill}\`.
2. Run \`${context.intentListCommand}\` with the selected time range.
3. Use data.targets as the primary input. Each target is grouped by name, and each usage row groups one description + intent pair.
4. For each target with meaningful usage, inspect at most once:
   - name
   - usage.description
   - usage.intent
   - actual document content
   - relevant source code when the content describes implementation, APIs, configuration, entry points, ownership, or workflows
5. Correct real drift through the internal drift analysis workflow.`;
}

function renderScheduledFinish(context: SkillTemplateContext): string {
  return `## Finish

1. Run \`${context.validateCommand}\`.
2. Summarize the selected time range, handled signals, drift decisions, changed documents, and targets intentionally left unchanged.
3. Keep scheduled maintenance open while validation is failing for changes made during the run.`;
}

function renderSignalEntry(context: SkillTemplateContext): string {
  return `## Entry: Optimization Signals

Signals are non-blocking document-effectiveness problems discovered during command execution. They are not command failures, and they are not issues the CLI can automatically repair.

1. Run \`${context.signalListCommand}\`.
2. Only inspect returned records with handled=false.
3. Treat frictionPattern as the document-quality friction to inspect. Current signals may include route_fallback, empty_route, non_target_document, readme_unindexed, route_without_readme, route_missing_readme_entry, parent_route_bypasses_module_route, route_duplicates_module_entry, read_unindexed_target, and read_unreachable_target.
4. Use target.kind/path/name/line to locate the affected complete functional entity, route, or document.
5. Before editing, confirm the current state with \`${context.cli} insight\`, \`${context.cli} read\`, or \`${context.cli} graph\` as appropriate.
6. Then follow "Repair By Contract". If inspection shows the signal is acceptable for this project, do not force a document change; mark the signal handled after recording that judgment in your final response.`;
}

function renderIntentObservationEntry(context: SkillTemplateContext): string {
  return `## Entry: Intent Observations

1. Run \`${context.intentListCommand}\` with a time window, for example \`${context.intentListCommand} --since <YYYY-MM-DD> --until <YYYY-MM-DD>\`.
2. Use data.targets as the primary analysis input. Each target is grouped by target.name.
3. Within a target, use usage[] to inspect each observed description + intent pair. count shows repeated use of the same pair.
4. Prefer read evidence as strong evidence: it means an agent actually opened a target for a stated task intent.
5. Treat insight_entry evidence as weaker evidence: it shows which route entries were presented for a stated lookup intent, not which document was ultimately read.
6. For each target, compare all five evidence surfaces:
   - name: the stable identity agents use to request the document.
   - usage.description: the task-oriented read trigger exposed by metadata or route entries.
   - usage.intent: why agents actually ran insight/read.
   - actual document content: what the target really explains or instructs.
   - relevant source code: implementation, APIs, configuration, entry points, or workflows that the content claims to describe.
7. Form a concrete drift hypothesis before editing:
   - The name suggests a responsibility the content does not support.
   - The description is narrower than the observed intents that repeatedly caused reads.
   - The description is broader than the actual content or relevant source code supports.
   - The content is stale or misleading compared with the relevant source code.
   - The intents show that one document is carrying multiple distinct responsibilities and should be split.
   - The route exposed a document for intents that the document content does not satisfy.
8. Read the target content with \`${context.cli} read <name>\` after a mismatch hypothesis exists.
9. If the content mentions source-level behavior, APIs, configuration, entry points, ownership, or workflows, inspect the relevant source files before deciding whether drift is real.
10. If drift is real, follow "Repair By Contract". If the observations are acceptable for the target, make no document changes and state that judgment in your final response.`;
}

function renderRepairByContract(context: SkillTemplateContext): string {
  return `## Shared Flow: Repair By Contract

Use this flow for both validate issues and signal repair. The goal is to improve the document system according to the current project contracts, not to patch the surface symptom.

1. Discover the local document context:
   - Run \`${context.cli} insight <target-path>\` for the affected path or complete functional entity.
   - Run \`${context.cli} read <name>\` when a stable document name is available.
   - Run \`${context.cli} graph\` when route reachability or indexing is part of the problem.
2. Apply the Complete Functional Entity Gate:
   - A complete functional entity has independent functional meaning, a clear responsibility boundary, and maintenance value; an agent can understand, change, and verify it as one coherent target.
   - A directory, implementation layer, temporary split, or file grouping is not automatically a complete functional entity.
   - Only a complete functional entity should receive its own README, route, or configured typed documents. A small complete functional entity may only need a README; add a route only when multiple documents need discovery.
   - If the affected path is not a complete functional entity, do not create README, route, or typed documents there. Move or consolidate the content into the nearest or most accurate complete functional entity, then repair that entity.
3. Load current type contracts:
   - Run \`${context.typesListCommand}\`.
   - Run \`${context.typesDescribeCommand}\` for every candidate type you might create or update.
   - Use returned fields such as requiresName, requiresDescription, hardLineLimit, and pathPattern as the source of truth.
   - Treat sections as writing guidance only; adapt headings to the document language when needed.
4. Classify the document shape:
   - Decide which current type contract the target should satisfy.
   - If the content mixes responsibilities, identify which parts belong in other currently configured document types.
   - Rely on the configured type contracts returned by the CLI.
5. Repair shape before metadata:
   - For document_ignored or ignored_target_referenced, first decide whether the ignored Markdown should enter docs-harness management. If yes, manually edit \`.docs-harness/config.json\` and remove or narrow the matching \`ignore\` pattern before continuing repair. If no, choose another managed document or remove the stale route entry.
   - If the document shape is correct and only metadata or route entries are missing, repair those.
   - If the document is too large, stale, or mixes multiple responsibilities, split, shorten, or migrate content first.
   - If a non-target document contains useful agent-facing knowledge, consolidate it into one or more appropriate configured document types under the correct complete functional entity; create or update that entity's README and route only when needed, then delete the original loose document if its content has been fully migrated.
   - If a typed document is needed, place it under a complete functional entity with the README or route required by the current type contract.
6. Write through \`${context.cli}\`:
   - Preview generated writes with \`${context.writeDryRunCommand}\`.
   - Inspect data.target, data.routeEntry, data.changes, and data.errors.
   - Apply with \`${context.writeApplyCommand}\` only after the change is appropriate for the current task.
   - If manual route edits are needed, preserve stable names and make descriptions match target metadata.
7. Validate:
   - Run \`${context.validateCommand}\`.
   - If validation fails, use error.issues as the next repair input and continue this same flow.`;
}

function renderSignalFinish(context: SkillTemplateContext): string {
  return `## Signal Completion

After the document graph is valid, mark the signal you processed as handled:

1. Run \`${context.signalMarkHandledCommand}\` for the processed signal id.
2. Confirm the command reports updated >= 1, or matched >= 1 if it was already handled.
3. If the signal did not require a document change after inspection, it can still be marked handled, but explain the judgment briefly in the final response.

Do not mark a signal handled while \`${context.validateCommand}\` is failing for changes you made.`;
}

function renderDriftAnalysisFinish(context: SkillTemplateContext): string {
  return `## Drift Analysis Completion

After changing descriptions, route entries, or document content:

1. Run \`${context.validateCommand}\`.
2. Confirm descriptions remain task-oriented read triggers, not summaries.
3. In your final response, state which target observations drove the correction and whether the drift was in name, description, content, source-code alignment, or document structure.`;
}

function renderRepairSafetyRules(context: SkillTemplateContext): string {
  return `## Safety Rules

- Do not hard-code document type structure; always read it through \`${context.typesListCommand}\` and \`${context.typesDescribeCommand}\`.
- Do not make a cosmetic-only fix when the document violates its current type contract or should be split.
- Do not create README, routes, or typed documents under a path that is not a complete functional entity just to satisfy a signal.
- Preserve existing route entry names unless a concrete validation issue requires changing them.
- Keep descriptions task-oriented: explain when an agent should read the document, not what the document is about. For English descriptions, use the form "Use when ..."; for other languages, use an equivalent read-trigger phrase.`;
}

function joinSections(...sections: string[]): string {
  return `${sections.map((section) => section.trim()).join('\n\n')}\n`;
}

function formatBoolean(value: boolean): string {
  return value ? 'yes' : 'no';
}
