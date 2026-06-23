import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const CLI = new URL('../dist/cli.js', import.meta.url).pathname;
const DEFAULT_IGNORE = [
  '.git/**',
  'node_modules/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.docs-harness/logs/**',
];

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-'));
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '- [agent-index] name="README" description="Use when understanding the project overview."',
      '- [agent-index] name="docs/runbook/deploy" description="Use when deploying the project."',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Use when understanding the project overview.',
      '---',
      '',
      '# Demo',
      '',
      'A demo project.',
      '',
    ].join('\n'),
  );
  writeFileSync(join(root, 'docs-runbook-placeholder.md'), '# placeholder\n');
  return root;
}

function run(args, options = {}) {
  const stdout = execFileSync('node', [CLI, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

function runFailure(args, options = {}) {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    envelope: JSON.parse(result.stdout),
  };
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function readLogFile(root, fileName) {
  const logsRoot = join(root, '.docs-harness/logs');
  if (!existsSync(logsRoot)) return [];
  return readdirSync(logsRoot).flatMap((directory) =>
    readJsonl(join(logsRoot, directory, fileName)),
  );
}

function readSignals(root) {
  return readLogFile(root, 'signal.jsonl');
}

function readRuns(root) {
  return readLogFile(root, 'runs.jsonl');
}

function waitForValue(read, description, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const value = read();
    if (value) return value;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

test('skills list returns compact success envelope by default', () => {
  const envelope = run(['skills', 'list'], { cwd: process.cwd() });
  assert.equal(envelope.ok, true);
  assert.deepEqual(Object.keys(envelope).sort(), ['data', 'ok']);
  assert.deepEqual(
    envelope.data.skills.map((skill) => skill.name),
    ['agent-init', 'schedule-document-quality-maintenance'],
  );
  assert.match(envelope.data.skills[0].description, /agent init skill/);
  const maintenanceSkill = envelope.data.skills.find(
    (skill) => skill.name === 'schedule-document-quality-maintenance',
  );
  assert.ok(maintenanceSkill);
  assert.match(maintenanceSkill.description, /scheduled workflow/);
  assert.equal(envelope.data.skills.some((skill) => skill.name === 'document-repair'), false);
  assert.equal(envelope.data.skills.some((skill) => skill.name === 'signal-repair'), false);
  assert.equal(envelope.data.skills.some((skill) => skill.name === 'document-drift-analysis'), false);

  const coreEnvelope = run(['skills', 'read', 'agent-init'], { cwd: process.cwd() });
  assert.equal(coreEnvelope.ok, true);
  assert.match(coreEnvelope.data.content, /# docs-harness Agent Init/);
  assert.match(coreEnvelope.data.content, /Agent Init Flow/);
  assert.match(coreEnvelope.data.content, /docs-harness init --dry-run/);
  assert.match(coreEnvelope.data.content, /docs-harness init --yes/);
  assert.match(coreEnvelope.data.content, /docs-harness validate/);
  assert.match(coreEnvelope.data.content, /docs-harness skills read document-repair/);
  assert.match(coreEnvelope.data.content, /docs-harness skills read schedule-document-quality-maintenance/);
  assert.doesNotMatch(coreEnvelope.data.content, /## Current Document Type Contracts/);

  const maintenanceEnvelope = run(['skills', 'read', 'schedule-document-quality-maintenance'], {
    cwd: process.cwd(),
  });
  assert.equal(maintenanceEnvelope.ok, true);
  assert.match(maintenanceEnvelope.data.content, /# docs-harness Scheduled Document Quality Maintenance/);
  assert.match(maintenanceEnvelope.data.content, /Review Window/);
  assert.match(maintenanceEnvelope.data.content, /docs-harness validate/);
  assert.match(maintenanceEnvelope.data.content, /docs-harness skills read signal-repair/);
  assert.match(maintenanceEnvelope.data.content, /docs-harness skills read document-drift-analysis/);
  assert.match(maintenanceEnvelope.data.content, /same time range/);

  const repairEnvelope = run(['skills', 'read', 'document-repair'], { cwd: process.cwd() });
  assert.equal(repairEnvelope.ok, true);
  assert.match(repairEnvelope.data.content, /Repair By Contract/);
  assert.match(repairEnvelope.data.content, /Entry: Execution Repair/);
  assert.match(repairEnvelope.data.content, /Complete Functional Entity Gate/);
  assert.match(repairEnvelope.data.content, /not a complete functional entity/);
  assert.match(repairEnvelope.data.content, /## Current Document Type Contracts/);
  assert.match(repairEnvelope.data.content, /### runbook/);
  assert.match(repairEnvelope.data.content, /hardLineLimit: 300/);
  assert.match(repairEnvelope.data.content, /Suggested sections:/);
  assert.match(repairEnvelope.data.content, /  - Steps/);
  assert.match(repairEnvelope.data.content, /Treat sections as writing guidance only/);
  assert.match(repairEnvelope.data.content, /For English descriptions, use the form "Use when \.\.\."/);

  const signalRepairEnvelope = run(['skills', 'read', 'signal-repair'], { cwd: process.cwd() });
  assert.equal(signalRepairEnvelope.ok, true);
  assert.match(signalRepairEnvelope.data.content, /Repair By Contract/);
  assert.match(signalRepairEnvelope.data.content, /Complete Functional Entity Gate/);
  assert.match(signalRepairEnvelope.data.content, /frictionPattern/);
  assert.match(signalRepairEnvelope.data.content, /docs-harness signal list --unhandled/);
  assert.match(signalRepairEnvelope.data.content, /docs-harness signal mark-handled <id>/);
  assert.match(signalRepairEnvelope.data.content, /non_target_document/);
  assert.match(signalRepairEnvelope.data.content, /readme_unindexed/);
  assert.match(signalRepairEnvelope.data.content, /route_without_readme/);
  assert.match(signalRepairEnvelope.data.content, /handled=false/);

  const driftAnalysisEnvelope = run(['skills', 'read', 'document-drift-analysis'], { cwd: process.cwd() });
  assert.equal(driftAnalysisEnvelope.ok, true);
  assert.match(driftAnalysisEnvelope.data.content, /# docs-harness Document Drift Analysis/);
  assert.match(driftAnalysisEnvelope.data.content, /docs-harness intent list/);
  assert.match(driftAnalysisEnvelope.data.content, /target.name/);
  assert.match(driftAnalysisEnvelope.data.content, /usage.description/);
  assert.match(driftAnalysisEnvelope.data.content, /observed intent/);
  assert.match(driftAnalysisEnvelope.data.content, /actual document content/);
  assert.match(driftAnalysisEnvelope.data.content, /relevant source code/);
  assert.match(driftAnalysisEnvelope.data.content, /Repair By Contract/);
  assert.match(driftAnalysisEnvelope.data.content, /Complete Functional Entity Gate/);
});

test('package exports reusable signal operations', async () => {
  const api = await import(new URL('../dist/index.js', import.meta.url));
  assert.equal(typeof api.buildSignal, 'function');
  assert.equal(typeof api.readIntentObservations, 'function');
  assert.equal(typeof api.writeSignals, 'function');
  assert.equal(typeof api.readSignals, 'function');
  assert.equal(typeof api.markSignalsHandled, 'function');
});

test('schema is the default machine-readable command contract', () => {
  const defaultEnvelope = run([], { cwd: process.cwd() });
  assert.equal(defaultEnvelope.ok, true);
  assert.ok(defaultEnvelope.data.commands.some((command) => command.id === 'schema'));
  assert.ok(defaultEnvelope.data.commands.some((command) => command.id === 'write'));
  assert.ok(defaultEnvelope.data.commands.some((command) => command.id === 'read'));
  assert.equal(
    defaultEnvelope.data.commands.every((command) => command.visibility === 'public'),
    true,
  );
  assert.equal(defaultEnvelope.data.commands.some((command) => command.id === 'intent.list'), false);
  assert.equal(defaultEnvelope.data.commands.some((command) => command.id === 'signal.list'), false);
  assert.equal(defaultEnvelope.data.commands.some((command) => command.id === 'graph'), false);
  assert.equal(defaultEnvelope.data.commands.some((command) => command.id === 'skills.read'), false);
  assert.equal(defaultEnvelope.data.commands.some((command) => command.id === 'show'), false);

  const helpEnvelope = run(['help'], { cwd: process.cwd() });
  assert.deepEqual(helpEnvelope, defaultEnvelope);
  const longHelpEnvelope = run(['--help'], { cwd: process.cwd() });
  assert.deepEqual(longHelpEnvelope, defaultEnvelope);
  const shortHelpEnvelope = run(['-h'], { cwd: process.cwd() });
  assert.deepEqual(shortHelpEnvelope, defaultEnvelope);

  const writeEnvelope = run(['schema', '--command', 'write'], { cwd: process.cwd() });
  assert.equal(writeEnvelope.ok, true);
  assert.equal(writeEnvelope.data.command.id, 'write');
  assert.deepEqual(writeEnvelope.data.command.capabilities.writes, ['document', 'routeEntry']);
  assert.ok(writeEnvelope.data.command.args.some((arg) => arg.name === 'no-route-entry'));
  assert.ok(writeEnvelope.data.command.branches.includes('route_not_found'));
  assert.ok(writeEnvelope.data.command.branches.includes('invalid_route_entry'));
  const helpWriteEnvelope = run(['help', '--command', 'write'], { cwd: process.cwd() });
  assert.deepEqual(helpWriteEnvelope, writeEnvelope);

  const internalEnvelope = run(['schema', '--internal'], { cwd: process.cwd() });
  assert.equal(internalEnvelope.ok, true);
  assert.ok(internalEnvelope.data.commands.some((command) => command.id === 'intent.list'));
  assert.ok(internalEnvelope.data.commands.some((command) => command.id === 'signal.list'));
  assert.ok(internalEnvelope.data.commands.some((command) => command.id === 'signal.mark-handled'));
  assert.ok(internalEnvelope.data.commands.some((command) => command.id === 'graph'));
  assert.ok(internalEnvelope.data.commands.some((command) => command.id === 'skills.read'));
  assert.ok(internalEnvelope.data.commands.some((command) => command.id === 'write'));
  assert.equal(
    internalEnvelope.data.commands.some((command) => command.visibility === 'internal'),
    true,
  );

  const initEnvelope = run(['schema', '--command', 'init'], { cwd: process.cwd() });
  assert.equal(initEnvelope.ok, true);
  assert.equal(initEnvelope.data.command.visibility, 'public');
  assert.ok(
    initEnvelope.data.command.capabilities.writes.includes(
      '.docs-harness/registry/document-types.json',
    ),
  );
  assert.equal(
    initEnvelope.data.command.capabilities.logs.signal,
    '.docs-harness/logs/<YYYY-MM-DD>/signal.jsonl',
  );
  const agentArg = initEnvelope.data.command.args.find((arg) => arg.name === 'agent');
  assert.deepEqual(agentArg.values, ['generic', 'claude']);

  const validateEnvelope = run(['schema', '--command', 'validate'], { cwd: process.cwd() });
  assert.equal(validateEnvelope.ok, true);
  assert.equal(validateEnvelope.data.command.output.success.valid, true);
  assert.equal(validateEnvelope.data.command.output.failure.code, 'validation_failed');
  assert.ok(Array.isArray(validateEnvelope.data.command.output.failure.issues));

  const insightSchema = run(['schema', '--command', 'insight'], { cwd: process.cwd() });
  assert.equal(insightSchema.ok, true);
  assert.ok(insightSchema.data.command.args.some((arg) => arg.name === 'intent'));
  assert.equal(insightSchema.data.command.output.fallback, 'boolean');
  assert.equal(insightSchema.data.command.output.module.readme.description, 'string');
  assert.equal(insightSchema.data.command.output.route.path, 'string');

  const readSchema = run(['schema', '--command', 'read'], { cwd: process.cwd() });
  assert.equal(readSchema.ok, true);
  assert.ok(readSchema.data.command.args.some((arg) => arg.name === 'intent'));
  assert.ok(readSchema.data.command.branches.includes('document_ignored'));
  assert.ok(readSchema.data.command.branches.includes('non_target_document'));
  assert.equal(readSchema.data.command.output.description, 'string');
  assert.equal(readSchema.data.command.output.path, 'string');
  const removedShowSchema = runFailure(['schema', '--command', 'show'], { cwd: process.cwd() });
  assert.equal(removedShowSchema.envelope.error.code, 'command_schema_not_found');

  const intentSchema = run(['schema', '--command', 'intent.list'], { cwd: process.cwd() });
  assert.equal(intentSchema.ok, true);
  assert.equal(intentSchema.data.command.visibility, 'internal');
  assert.equal(intentSchema.data.command.output.targets[0].name, 'string');
  assert.equal(intentSchema.data.command.output.targets[0].usage[0].intent, 'string');
  assert.equal(intentSchema.data.command.output.observations[0].intent, 'string');
  assert.deepEqual(
    intentSchema.data.command.args.find((arg) => arg.name === 'command').values,
    ['insight', 'read'],
  );

  const signalListSchema = run(['schema', '--command', 'signal.list'], { cwd: process.cwd() });
  assert.equal(signalListSchema.ok, true);
  assert.equal(signalListSchema.data.command.visibility, 'internal');
  assert.equal(signalListSchema.data.command.output.signals[0].frictionPattern, 'string');

  const signalHandledSchema = run(['schema', '--command', 'signal.mark-handled'], { cwd: process.cwd() });
  assert.equal(signalHandledSchema.ok, true);
  assert.equal(signalHandledSchema.data.command.output.updated, 'number');

  const validateCodes = validateEnvelope.data.command.output.failure.issues[0].code;
  assert.ok(validateCodes.includes('unreachable_route'));
  assert.ok(validateCodes.includes('route_cycle'));
  assert.ok(validateCodes.includes('hard_line_limit_exceeded'));
  assert.ok(validateCodes.includes('ignored_target_referenced'));
  assert.equal(validateCodes.includes('missing_required_section'), false);
  assert.equal(validateCodes.includes('missing_sibling_readme'), false);
  assert.equal(validateCodes.includes('missing_sibling_route'), false);
});

test('insight lists entries from nearest AGENTS.md', () => {
  const root = createProject();
  const envelope = run(['insight', '.', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.fallback, false);
  assert.deepEqual(envelope.data.module, {
    path: '.',
    readme: {
      name: 'README',
      description: 'Use when understanding the project overview.',
    },
  });
  assert.equal(envelope.data.route.path, 'AGENTS.md');
  assert.deepEqual(envelope.data.route.entries, [
    {
      name: 'README',
      description: 'Use when understanding the project overview.',
    },
    {
      name: 'docs/runbook/deploy',
      description: 'Use when deploying the project.',
    },
  ]);
});

test('read reads a document by stable name', () => {
  const root = createProject();
  const envelope = run(['read', 'README', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.name, 'README');
  assert.equal(envelope.data.description, 'Use when understanding the project overview.');
  assert.equal(envelope.data.kind, 'readme');
  assert.equal(envelope.data.path, 'README.md');
  assert.match(envelope.data.content, /A demo project/);
});

test('intent list returns structured insight and read observations', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-intent-observations-'));
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Use when understanding project overview, directory responsibilities, or basic usage.',
      '---',
      '',
      '# Demo',
      '',
      '## What It Is',
      'Project.',
      '',
      '## Why It Exists',
      'Context.',
      '',
      '## How To Use It',
      'Read it.',
      '',
    ].join('\n'),
  );
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });

  run(['insight', '.', '--intent', 'Find the project overview docs.', '--root', root], {
    cwd: root,
  });
  run(['read', 'README', '--intent', 'Confirm the project overview details.', '--root', root], {
    cwd: root,
  });
  run(['read', 'README', '--intent', 'Confirm the project overview details.', '--root', root], {
    cwd: root,
  });

  const envelope = waitForValue(() => {
    const result = run(['intent', 'list', '--root', root], { cwd: root });
    return result.data.count >= 3 ? result : undefined;
  }, 'intent observations');
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.targetCount, 1);
  assert.equal(envelope.data.targets.length, 1);
  const [targetSummary] = envelope.data.targets;
  assert.equal(targetSummary.name, 'README');
  assert.equal(targetSummary.path, 'README.md');
  assert.equal(targetSummary.kind, 'readme');
  assert.equal(targetSummary.observationCount, 3);
  assert.equal(targetSummary.readCount, 2);
  assert.equal(targetSummary.insightCount, 1);
  const readUsage = targetSummary.usage.find(
    (usage) =>
      usage.description ===
        'Use when understanding project overview, directory responsibilities, or basic usage.' &&
      usage.intent === 'Confirm the project overview details.',
  );
  assert.ok(readUsage);
  assert.equal(readUsage.count, 2);
  assert.deepEqual(readUsage.evidence, ['read']);
  const insightUsage = targetSummary.usage.find(
    (usage) =>
      usage.description ===
        'Use when understanding project overview, directory responsibilities, or basic usage.' &&
      usage.intent === 'Find the project overview docs.',
  );
  assert.ok(insightUsage);
  assert.equal(insightUsage.count, 1);
  assert.deepEqual(insightUsage.evidence, ['insight_entry']);

  const readObservation = envelope.data.observations.find(
    (observation) =>
      observation.evidence === 'read' &&
      observation.target.name === 'README' &&
      observation.intent === 'Confirm the project overview details.',
  );
  assert.ok(readObservation);
  assert.equal(readObservation.target.path, 'README.md');
  assert.equal(readObservation.target.kind, 'readme');
  assert.equal(
    readObservation.target.description,
    'Use when understanding project overview, directory responsibilities, or basic usage.',
  );

  const insightObservation = envelope.data.observations.find(
    (observation) =>
      observation.evidence === 'insight_entry' &&
      observation.target.name === 'README' &&
      observation.intent === 'Find the project overview docs.',
  );
  assert.ok(insightObservation);
  assert.equal(insightObservation.route.path, 'AGENTS.md');
  assert.equal(insightObservation.route.requestedPath, '.');
  assert.equal(insightObservation.route.fallback, false);

  const filtered = run(
    ['intent', 'list', '--command', 'read', '--target', 'README', '--root', root],
    { cwd: root },
  );
  assert.equal(filtered.ok, true);
  assert.equal(filtered.data.count, 2);
  assert.equal(filtered.data.targetCount, 1);
  assert.equal(filtered.data.targets[0].usage[0].count, 2);
  assert.equal(filtered.data.observations[0].evidence, 'read');

  const runEntry = waitForValue(
    () =>
      readRuns(root).find(
        (entry) =>
          entry.command === 'read' &&
          entry.intent === 'Confirm the project overview details.',
      ),
    'read run with top-level intent',
  );
  assert.equal(runEntry.args.flags.intent, 'Confirm the project overview details.');
});

test('show command is not retained as an alias', () => {
  const root = createProject();
  const result = runFailure(['show', 'README', '--root', root], { cwd: root });
  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.code, 'unknown_command');
});

test('validate fails with graph errors inside error.issues', () => {
  const root = createProject();
  const result = runFailure(['validate', '--root', root], { cwd: root });
  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.code, 'validation_failed');
  assert.equal(result.envelope.data, undefined);
  assert.match(result.envelope.error.hint, /docs-harness skills read document-repair/);
  assert.ok(
    result.envelope.error.issues.some(
      (issue) =>
        issue.code === 'target_not_found' &&
        issue.path === 'AGENTS.md' &&
        issue.hint.includes('docs-harness write --dry-run'),
    ),
  );
});

test('validate does not enforce typed document required sections', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-validate-structure-'));
  writeFileSync(
    join(root, 'AGENTS.md'),
    ['# Instructions', '', '## Document Graph Entries', '', ''].join('\n'),
  );
  writeFileSync(
    join(root, 'README.md'),
    ['# Demo', '', '## Resumen', 'Project.', '', '## Uso', 'Read it.', ''].join('\n'),
  );

  const envelope = run(['validate', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.valid, true);
});

test('validate reports hard line limit issues with repair skill hint', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-validate-line-limit-'));
  const filler = Array.from({ length: 205 }, (_, index) => `Line ${index + 1}.`);
  writeFileSync(
    join(root, 'README.md'),
    ['# Demo', '', '## What It Is', 'Project.', '', '## Why It Exists', 'Overview.', '', '## How To Use It', ...filler, ''].join(
      '\n',
    ),
  );
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });

  const result = runFailure(['validate', '--root', root], { cwd: root });
  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.code, 'validation_failed');
  const issue = result.envelope.error.issues.find(
    (candidate) =>
      candidate.code === 'hard_line_limit_exceeded' &&
      candidate.path === 'README.md' &&
      candidate.type === 'readme',
  );
  assert.ok(issue);
  assert.match(issue.message, /200/);
  assert.match(issue.hint, /docs-harness skills read document-repair/);
});

test('validate reports description metadata drift without enforcing use-when wording', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-validate-description-'));
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="README" description="Use when reading the project docs."',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Project documentation.',
      '---',
      '',
      '# Demo',
      '',
      '## What It Is',
      'Project.',
      '',
      '## Why It Exists',
      'Context.',
      '',
      '## How To Use It',
      'Read it.',
      '',
    ].join('\n'),
  );

  const result = runFailure(['validate', '--root', root], { cwd: root });
  assert.equal(result.status, 1);
  assert.equal(result.envelope.error.code, 'validation_failed');
  assert.ok(
    result.envelope.error.issues.some(
      (issue) => issue.code === 'description_mismatch' && issue.path === 'AGENTS.md',
    ),
  );
  assert.equal(
    result.envelope.error.issues.some((issue) => issue.code === 'description_not_use_when'),
    false,
  );
});

test('validate accepts localized description wording when metadata and route match', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-validate-localized-description-'));
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="README" description="用于了解项目概览。"',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: 用于了解项目概览。',
      '---',
      '',
      '# Demo',
      '',
      '## What It Is',
      'Project.',
      '',
      '## Why It Exists',
      'Context.',
      '',
      '## How To Use It',
      'Read it.',
      '',
    ].join('\n'),
  );

  const envelope = run(['validate', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.valid, true);
});

test('validate accepts standalone complete functional entity README without a sibling route', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-validate-standalone-readme-'));
  mkdirSync(join(root, 'packages/api'), { recursive: true });
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="packages/api/README" description="Use when understanding the API package."',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'packages/api/README.md'),
    [
      '---',
      'description: Use when understanding the API package.',
      '---',
      '',
      '# API',
      '',
      '## What It Is',
      'API package.',
      '',
      '## Why It Exists',
      'Boundary.',
      '',
      '## How To Use It',
      'Run it.',
      '',
    ].join('\n'),
  );

  const envelope = run(['validate', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.valid, true);
});

test('validate does not enforce typed document sibling README and route', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-validate-typed-siblings-'));
  mkdirSync(join(root, 'packages/api/docs/runbook'), { recursive: true });
  writeFileSync(
    join(root, 'AGENTS.md'),
    ['# Instructions', '', '## Document Graph Entries', '', ''].join('\n'),
  );
  writeFileSync(
    join(root, 'packages/api/docs/runbook/deploy.md'),
    [
      '---',
      'name: packages/api/docs/runbook/deploy',
      'description: Use when deploying the API.',
      '---',
      '',
      '# Deploy',
      '',
      '## When To Use',
      'Deploying.',
      '',
      '## Preconditions',
      'Access.',
      '',
      '## Steps',
      'Run deploy.',
      '',
      '## Verification',
      'Check health.',
      '',
      '## Rollback Or Recovery',
      'Rollback.',
      '',
      '## Entry Points',
      'CLI.',
      '',
    ].join('\n'),
  );

  const envelope = run(['validate', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.valid, true);
});

test('graph writes readme_unindexed signal for standalone README outside reachable routes', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-readme-unindexed-'));
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Use when understanding project overview, directory responsibilities, or basic usage.',
      '---',
      '',
      '# Demo',
      '',
      '## What It Is',
      'Project.',
      '',
      '## Why It Exists',
      'Context.',
      '',
      '## How To Use It',
      'Read it.',
      '',
    ].join('\n'),
  );
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  mkdirSync(join(root, 'packages/api'), { recursive: true });
  writeFileSync(
    join(root, 'packages/api/README.md'),
    [
      '---',
      'description: Use when understanding the API package.',
      '---',
      '',
      '# API',
      '',
      '## What It Is',
      'API package.',
      '',
      '## Why It Exists',
      'Boundary.',
      '',
      '## How To Use It',
      'Run it.',
      '',
    ].join('\n'),
  );

  const envelope = run(['graph', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.ok(envelope.data.nodes.some((node) => node.path === 'packages/api/README.md'));

  const signal = waitForValue(
    () =>
      readSignals(root).find(
        (record) =>
          record.frictionPattern === 'readme_unindexed' &&
          record.target.path === 'packages/api/README.md',
      ),
    'readme_unindexed signal',
  );
  assert.equal(signal.handled, false);
  assert.equal(signal.target.kind, 'document');
  assert.equal(signal.target.name, 'packages/api/README');
  assert.match(signal.suggestion, /add it to the appropriate route/);
  assert.match(signal.suggestion, /mark this signal handled/);
});

test('validate reports route files that are not reachable from the root route', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-validate-unreachable-route-'));
  mkdirSync(join(root, 'packages/api'), { recursive: true });

  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="README" description="Use when understanding the project overview."',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Use when understanding the project overview.',
      '---',
      '',
      '# Demo',
      '',
      '## What It Is',
      'Project.',
      '',
      '## Why It Exists',
      'Context.',
      '',
      '## How To Use It',
      'Read it.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'packages/api/AGENTS.md'),
    [
      '# API Docs',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="packages/api/README" description="Use when understanding the API package."',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'packages/api/README.md'),
    [
      '---',
      'description: Use when understanding the API package.',
      '---',
      '',
      '# API',
      '',
      '## What It Is',
      'API package.',
      '',
      '## Why It Exists',
      'Boundary.',
      '',
      '## How To Use It',
      'Run it.',
      '',
    ].join('\n'),
  );

  const result = runFailure(['validate', '--root', root], { cwd: root });
  assert.equal(result.status, 1);
  assert.equal(result.envelope.error.code, 'validation_failed');
  assert.ok(
    result.envelope.error.issues.some(
      (issue) => issue.code === 'unreachable_route' && issue.path === 'packages/api/AGENTS.md',
    ),
  );
});

test('validate reports route-to-route cycles', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-validate-route-cycle-'));
  mkdirSync(join(root, 'packages/api'), { recursive: true });

  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '---',
      'description: Use when reading root docs.',
      '---',
      '',
      '# Instructions',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="packages/api/AGENTS" description="Use when discovering API docs."',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'packages/api/AGENTS.md'),
    [
      '---',
      'description: Use when discovering API docs.',
      '---',
      '',
      '# API Docs',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="AGENTS" description="Use when reading root docs."',
      '',
    ].join('\n'),
  );

  const result = runFailure(['validate', '--root', root], { cwd: root });
  assert.equal(result.status, 1);
  assert.equal(result.envelope.error.code, 'validation_failed');
  assert.ok(
    result.envelope.error.issues.some(
      (issue) =>
        issue.code === 'route_cycle' &&
        issue.message.includes('AGENTS.md -> packages/api/AGENTS.md -> AGENTS.md'),
    ),
  );
});

test('init previews AGENTS.md setup without writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-init-'));
  writeFileSync(join(root, 'README.md'), '# Demo\n');
  const envelope = run(['init', '--dry-run', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.dryRun, true);
  assert.equal(envelope.data.agent, 'generic');
  assert.equal(envelope.data.instructionFile, 'AGENTS.md');
  assert.equal(existsSync(join(root, 'AGENTS.md')), false);
  assert.equal(existsSync(join(root, '.docs-harness/registry/document-types.json')), false);
  assert.equal(existsSync(join(root, '.docs-harness/.gitignore')), false);
  assert.ok(envelope.data.changes.some((change) => change.path === 'AGENTS.md'));
  assert.ok(
    envelope.data.changes.some(
      (change) => change.path === '.docs-harness/registry/document-types.json',
    ),
  );
  assert.ok(envelope.data.changes.some((change) => change.path === '.docs-harness/.gitignore'));
});

test('init writes CLAUDE.md and configures future route lookup', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-claude-'));
  writeFileSync(join(root, 'README.md'), '# Demo\n');
  const initEnvelope = run(['init', '--agent', 'claude', '--yes', '--root', root], { cwd: root });
  assert.equal(initEnvelope.ok, true);
  assert.equal(initEnvelope.data.instructionFile, 'CLAUDE.md');
  const routeContent = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  assert.match(routeContent, /docs-harness insight/);
  assert.match(routeContent, /docs-harness insight \[path\] --intent/);
  assert.match(routeContent, /docs-harness read <name> --intent/);
  assert.match(routeContent, /## How To Add Or Update Docs/);
  assert.match(routeContent, /docs-harness types list/);
  assert.match(routeContent, /docs-harness write --type <type> .* --dry-run/);
  assert.match(routeContent, /docs-harness write --type <type> .* --yes/);
  assert.equal(existsSync(join(root, '.docs-harness/logs')), true);
  assert.match(readFileSync(join(root, '.docs-harness/.gitignore'), 'utf8'), /logs\//);
  const config = JSON.parse(readFileSync(join(root, '.docs-harness/config.json'), 'utf8'));
  assert.deepEqual(config.ignore, DEFAULT_IGNORE);

  const insightEnvelope = run(['insight', '.', '--root', root], { cwd: root });
  assert.equal(insightEnvelope.ok, true);
  assert.equal(insightEnvelope.data.route.path, 'CLAUDE.md');
  assert.deepEqual(insightEnvelope.data.route.entries, [
    {
      name: 'README',
      description: 'Use when understanding project overview, directory responsibilities, or basic usage.',
    },
  ]);
  assert.equal(existsSync(join(root, '.docs-harness/registry/document-types.json')), true);
});

test('commands write deduplicated optimization signals discovered during execution', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-signal-'));
  writeFileSync(join(root, 'README.md'), '# Demo\n');
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });

  const envelope = run(['insight', 'packages/api/src', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.error, undefined);
  assert.equal(envelope.signal, undefined);

  const fallbackSignal = waitForValue(
    () => readSignals(root).find((signal) => signal.frictionPattern === 'route_fallback'),
    'route_fallback signal',
  );
  assert.equal(fallbackSignal.version, '0.1.0');
  assert.equal(fallbackSignal.handled, false);
  assert.equal(fallbackSignal.target.kind, 'module');
  assert.equal(fallbackSignal.target.path, 'packages/api/src');
  assert.match(fallbackSignal.id, /^sig_[a-f0-9]{16}$/);
  assert.match(fallbackSignal.suggestion, /^If this path is a complete functional entity/);

  const listEnvelope = run(['signal', 'list', '--unhandled', '--root', root], { cwd: root });
  assert.equal(listEnvelope.ok, true);
  assert.ok(listEnvelope.data.signals.some((signal) => signal.id === fallbackSignal.id));

  run(['insight', 'packages/api/src', '--root', root], { cwd: root });
  waitForValue(
    () => readSignals(root).filter((signal) => signal.id === fallbackSignal.id).length === 1,
    'deduped route_fallback signal',
  );

  const handledEnvelope = run(['signal', 'mark-handled', fallbackSignal.id, '--root', root], { cwd: root });
  assert.equal(handledEnvelope.ok, true);
  assert.equal(handledEnvelope.data.updated, 1);
  run(['insight', 'packages/api/src', '--root', root], { cwd: root });
  waitForValue(
    () => readSignals(root).filter((signal) => signal.id === fallbackSignal.id).length === 2,
    'recreated route_fallback signal after handled',
  );

  const runEntry = waitForValue(
    () => readRuns(root).find((entry) => entry.command === 'insight' && entry.signalCount > 0),
    'insight run with signalCount',
  );
  assert.equal(runEntry.command, 'insight');
});

test('commands suppress optimization signals whose target scope is ignored', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-ignored-signal-'));
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Use when understanding project overview, directory responsibilities, or basic usage.',
      '---',
      '',
      '# Demo',
      '',
    ].join('\n'),
  );
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  const configPath = join(root, '.docs-harness/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(
    configPath,
    `${JSON.stringify({ ...config, ignore: [...config.ignore, 'legacy/**'] }, null, 2)}\n`,
  );
  mkdirSync(join(root, 'legacy/sub'), { recursive: true });

  const envelope = run(['insight', 'legacy/sub/work.ts', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.fallback, true);
  assert.equal(envelope.data.requestedModulePath, 'legacy/sub');

  const ignoredScopeRun = waitForValue(
    () =>
      readRuns(root).find(
        (entry) =>
          entry.command === 'insight' &&
          entry.result?.requestedModulePath === 'legacy/sub',
      ),
    'ignored-scope insight run',
  );
  assert.equal(ignoredScopeRun.signalCount, 0);
  assert.equal(
    readSignals(root).some(
      (signal) =>
        signal.frictionPattern === 'route_fallback' &&
        signal.target.path === 'legacy/sub',
    ),
    false,
  );
});

test('signal list filters historical signals by current ignore config', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-read-ignored-signal-'));
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Use when understanding project overview, directory responsibilities, or basic usage.',
      '---',
      '',
      '# Demo',
      '',
    ].join('\n'),
  );
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });

  run(['insight', 'packages/api/src', '--root', root], { cwd: root });
  const fallbackSignal = waitForValue(
    () => readSignals(root).find((signal) => signal.frictionPattern === 'route_fallback'),
    'route_fallback signal before ignore',
  );
  assert.equal(fallbackSignal.target.path, 'packages/api/src');

  const configPath = join(root, '.docs-harness/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(
    configPath,
    `${JSON.stringify({ ...config, ignore: [...config.ignore, 'packages/**'] }, null, 2)}\n`,
  );

  const listEnvelope = run(['signal', 'list', '--all', '--dedupe=false', '--root', root], {
    cwd: root,
  });
  assert.equal(listEnvelope.ok, true);
  assert.equal(
    listEnvelope.data.signals.some((signal) => signal.id === fallbackSignal.id),
    false,
  );
});

test('graph writes complete functional entity route structure optimization signals', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-route-signals-'));
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Use when understanding the project overview.',
      '---',
      '',
      '# Demo',
      '',
      '## What It Is',
      'Project.',
      '',
      '## Why It Exists',
      'Context.',
      '',
      '## How To Use It',
      'Read it.',
      '',
    ].join('\n'),
  );
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  mkdirSync(join(root, 'packages/api'), { recursive: true });
  mkdirSync(join(root, 'packages/web'), { recursive: true });
  mkdirSync(join(root, 'packages/admin'), { recursive: true });
  mkdirSync(join(root, 'packages/billing'), { recursive: true });

  writeFileSync(
    join(root, 'packages/api/AGENTS.md'),
    ['# API Docs', '', '## Document Graph Entries', '', ''].join('\n'),
  );
  writeFileSync(
    join(root, 'packages/web/README.md'),
    [
      '---',
      'description: Use when understanding the web package.',
      '---',
      '',
      '# Web',
      '',
      '## What It Is',
      'Web package.',
      '',
      '## Why It Exists',
      'UI boundary.',
      '',
      '## How To Use It',
      'Read it.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'packages/web/AGENTS.md'),
    ['# Web Docs', '', '## Document Graph Entries', '', ''].join('\n'),
  );
  writeFileSync(
    join(root, 'packages/admin/README.md'),
    [
      '---',
      'description: Use when understanding the admin package.',
      '---',
      '',
      '# Admin',
      '',
      '## What It Is',
      'Admin package.',
      '',
      '## Why It Exists',
      'Admin boundary.',
      '',
      '## How To Use It',
      'Read it.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'packages/admin/AGENTS.md'),
    [
      '# Admin Docs',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="packages/admin/README" description="Use when understanding the admin package."',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'packages/billing/README.md'),
    [
      '---',
      'description: Use when understanding the billing package.',
      '---',
      '',
      '# Billing',
      '',
      '## What It Is',
      'Billing package.',
      '',
      '## Why It Exists',
      'Billing boundary.',
      '',
      '## How To Use It',
      'Read it.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'packages/billing/AGENTS.md'),
    [
      '# Billing Docs',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="packages/billing/README" description="Use when understanding the billing package."',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'AGENTS.md'),
    `${readFileSync(join(root, 'AGENTS.md'), 'utf8')}
- [agent-index] name="packages/admin/README" description="Use when understanding the admin package."
- [agent-index] name="packages/billing/AGENTS" description="Use when discovering billing package docs."
- [agent-index] name="packages/billing/README" description="Use when understanding the billing package."
`,
  );

  const envelope = run(['graph', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  const signals = waitForValue(() => {
    const records = readSignals(root);
    return records.some(
      (signal) =>
        signal.frictionPattern === 'route_without_readme' &&
        signal.target.path === 'packages/api/AGENTS.md',
    ) &&
      records.some(
        (signal) =>
          signal.frictionPattern === 'route_missing_readme_entry' &&
          signal.target.path === 'packages/web/AGENTS.md',
      ) &&
      records.some(
        (signal) =>
          signal.frictionPattern === 'parent_route_bypasses_module_route' &&
          signal.target.kind === 'entry' &&
          signal.target.name === 'packages/admin/README',
      ) &&
      records.some(
        (signal) =>
          signal.frictionPattern === 'route_duplicates_module_entry' &&
          signal.target.path === 'AGENTS.md',
      )
      ? records
      : undefined;
  }, 'complete functional entity route structure signals');
  assert.ok(
    signals.some(
      (signal) =>
        signal.frictionPattern === 'route_without_readme' &&
        signal.target.path === 'packages/api/AGENTS.md',
    ),
  );
  assert.ok(
    signals.some(
      (signal) =>
        signal.frictionPattern === 'route_missing_readme_entry' &&
        signal.target.path === 'packages/web/AGENTS.md',
    ),
  );
  assert.ok(
    signals.some(
      (signal) =>
        signal.frictionPattern === 'parent_route_bypasses_module_route' &&
        signal.target.kind === 'entry' &&
        signal.target.name === 'packages/admin/README',
    ),
  );
  assert.ok(
    signals.some(
      (signal) =>
        signal.frictionPattern === 'route_duplicates_module_entry' &&
        signal.target.path === 'AGENTS.md',
    ),
  );
});

test('non-target document is scanned as a signal but not exposed as a graph target', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-non-target-markdown-'));
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Use when understanding project overview, directory responsibilities, or basic usage.',
      '---',
      '',
      '# Demo',
      '',
      '## What It Is',
      'Project.',
      '',
      '## Why It Exists',
      'Context.',
      '',
      '## How To Use It',
      'Read it.',
      '',
    ].join('\n'),
  );
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(
    join(root, 'notes/context.md'),
    ['# Context', '', 'Loose project notes that may or may not belong in docs.', ''].join('\n'),
  );

  const graphEnvelope = run(['graph', '--root', root], { cwd: root });
  assert.equal(graphEnvelope.ok, true);
  assert.equal(
    graphEnvelope.data.nodes.some((node) => node.path === 'notes/context.md'),
    false,
  );
  assert.equal(
    graphEnvelope.data.issues.some((issue) => issue.path === 'notes/context.md'),
    false,
  );

  const validateEnvelope = run(['validate', '--root', root], { cwd: root });
  assert.equal(validateEnvelope.ok, true);
  assert.equal(validateEnvelope.data.valid, true);

  const readResult = runFailure(['read', 'notes/context', '--root', root], { cwd: root });
  assert.equal(readResult.status, 1);
  assert.equal(readResult.envelope.error.code, 'non_target_document');
  assert.match(readResult.envelope.error.message, /notes\/context\.md/);
  assert.match(readResult.envelope.error.hint, /docs-harness skills read document-repair/);

  const signal = waitForValue(
    () =>
      readSignals(root).find(
        (record) =>
          record.frictionPattern === 'non_target_document' &&
          record.target.path === 'notes/context.md',
      ),
    'non_target_document signal',
  );
  assert.equal(signal.handled, false);
  assert.equal(signal.target.kind, 'document');
  assert.equal(signal.target.name, 'notes/context');
  assert.match(signal.suggestion, /consolidate it into the right complete functional entity/);
  assert.match(signal.suggestion, /delete the original loose document/);
  assert.match(signal.suggestion, /mark this signal handled/);
});

test('validate writes global non-blocking optimization signals on success', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-validate-signal-'));
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Use when understanding project overview, directory responsibilities, or basic usage.',
      '---',
      '',
      '# Demo',
      '',
    ].join('\n'),
  );
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(
    join(root, 'notes/context.md'),
    ['# Context', '', 'Loose project notes that may or may not belong in docs.', ''].join('\n'),
  );

  const validateEnvelope = run(['validate', '--root', root], { cwd: root });
  assert.equal(validateEnvelope.ok, true);
  assert.equal(validateEnvelope.data.valid, true);
  assert.deepEqual(validateEnvelope.data.issues, []);

  const signal = waitForValue(
    () =>
      readSignals(root).find(
        (record) =>
          record.frictionPattern === 'non_target_document' &&
          record.target.path === 'notes/context.md',
      ),
    'validate non_target_document signal',
  );
  assert.equal(signal.handled, false);
  assert.equal(signal.target.name, 'notes/context');

  const runEntry = waitForValue(
    () => readRuns(root).find((entry) => entry.command === 'validate' && entry.signalCount > 0),
    'validate run with signalCount',
  );
  assert.equal(runEntry.ok, true);
});

test('config ignore excludes markdown from target scan and non-target signals', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-ignore-non-target-'));
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Use when understanding project overview, directory responsibilities, or basic usage.',
      '---',
      '',
      '# Demo',
      '',
    ].join('\n'),
  );
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  const configPath = join(root, '.docs-harness/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(
    configPath,
    `${JSON.stringify({ ...config, ignore: [...config.ignore, 'notes/**'] }, null, 2)}\n`,
  );
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(
    join(root, 'notes/context.md'),
    ['# Context', '', 'Loose project notes intentionally outside adoption scope.', ''].join('\n'),
  );

  const graphEnvelope = run(['graph', '--root', root], { cwd: root });
  assert.equal(graphEnvelope.ok, true);
  assert.equal(
    graphEnvelope.data.nodes.some((node) => node.path === 'notes/context.md'),
    false,
  );

  const validateEnvelope = run(['validate', '--root', root], { cwd: root });
  assert.equal(validateEnvelope.ok, true);
  assert.equal(validateEnvelope.data.valid, true);

  const readResult = runFailure(['read', 'notes/context', '--root', root], { cwd: root });
  assert.equal(readResult.status, 1);
  assert.equal(readResult.envelope.error.code, 'document_ignored');
  assert.match(readResult.envelope.error.message, /notes\/context\.md/);

  waitForValue(
    () => readRuns(root).some((record) => record.command === 'graph'),
    'graph run for ignored markdown',
  );
  assert.equal(
    readSignals(root).some(
      (record) =>
        record.frictionPattern === 'non_target_document' &&
        record.target.path === 'notes/context.md',
    ),
    false,
  );
});

test('validate reports route entries that point to ignored markdown', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-ignore-route-target-'));
  writeFileSync(
    join(root, 'README.md'),
    [
      '---',
      'description: Use when understanding project overview, directory responsibilities, or basic usage.',
      '---',
      '',
      '# Demo',
      '',
    ].join('\n'),
  );
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  const configPath = join(root, '.docs-harness/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(
    configPath,
    `${JSON.stringify({ ...config, ignore: [...config.ignore, 'notes/**'] }, null, 2)}\n`,
  );
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(
    join(root, 'notes/context.md'),
    [
      '---',
      'name: notes/context',
      'description: Use when reviewing legacy context.',
      '---',
      '',
      '# Context',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'AGENTS.md'),
    `${readFileSync(join(root, 'AGENTS.md'), 'utf8')}
- [agent-index] name="notes/context" description="Use when reviewing legacy context."
`,
  );

  const result = runFailure(['validate', '--root', root], { cwd: root });
  assert.equal(result.status, 1);
  assert.equal(result.envelope.error.code, 'validation_failed');
  assert.ok(
    result.envelope.error.issues.some(
      (issue) =>
        issue.code === 'ignored_target_referenced' &&
        issue.name === 'notes/context' &&
        issue.path === 'AGENTS.md' &&
        issue.hint.includes('notes/context.md'),
    ),
  );
  assert.equal(
    result.envelope.error.issues.some(
      (issue) => issue.code === 'target_not_found' && issue.name === 'notes/context',
    ),
    false,
  );
});

test('init requires confirmation before writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-confirm-'));
  const result = runFailure(['init', '--agent', 'generic', '--root', root], { cwd: root });
  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.code, 'confirmation_required');
  assert.equal(result.envelope.error.confirm, '--yes');
});

test('init rejects unsupported agent values', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-unsupported-agent-'));
  const result = runFailure(['init', '--agent', 'auto', '--dry-run', '--root', root], { cwd: root });
  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.code, 'unknown_agent');
  assert.match(result.envelope.error.hint, /generic/);
  assert.match(result.envelope.error.hint, /claude/);
  assert.doesNotMatch(result.envelope.error.hint, /auto/);
});

test('types list and describe expose built-in contracts', () => {
  const listEnvelope = run(['types', 'list'], { cwd: process.cwd() });
  assert.equal(listEnvelope.ok, true);
  assert.ok(listEnvelope.data.types.some((type) => type.name === 'runbook'));
  assert.equal(listEnvelope.data.types.some((type) => type.name === 'research'), false);

  const describeEnvelope = run(['types', 'describe', 'runbook'], { cwd: process.cwd() });
  assert.equal(describeEnvelope.ok, true);
  assert.equal(describeEnvelope.data.type.name, 'runbook');
  assert.equal(describeEnvelope.data.type.requiresDescription, true);
  assert.ok(describeEnvelope.data.type.sections.some((section) => section.heading === 'Steps'));
});

test('types prefer project-local registry written by init', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-types-registry-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  const registryPath = join(root, '.docs-harness/registry/document-types.json');
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  registry.types = registry.types.filter((type) => !['route', 'runbook'].includes(type.name));
  registry.types.push({
    name: 'decision',
    purpose: 'Record a durable project decision.',
    useWhen: ['A project decision should be discoverable by agents.'],
    pathPattern: 'decisions/{name}.md',
    requiresName: true,
    requiresDescription: true,
    requiresReadme: false,
    requiresRoute: false,
    softLineLimit: 80,
    hardLineLimit: 120,
    sections: [{ heading: 'Decision', required: true }],
  });
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  const listEnvelope = run(['types', 'list', '--root', root], { cwd: root });
  assert.equal(listEnvelope.ok, true);
  assert.ok(listEnvelope.data.types.some((type) => type.name === 'decision'));
  assert.equal(listEnvelope.data.types.some((type) => type.name === 'route'), false);
  assert.equal(listEnvelope.data.types.some((type) => type.name === 'runbook'), false);

  const removedRouteResult = runFailure(['types', 'describe', 'route', '--root', root], {
    cwd: root,
  });
  assert.equal(removedRouteResult.status, 1);
  assert.equal(removedRouteResult.envelope.ok, false);
  assert.equal(removedRouteResult.envelope.error.code, 'document_type_not_found');

  const removedTypeResult = runFailure(['types', 'describe', 'runbook', '--root', root], {
    cwd: root,
  });
  assert.equal(removedTypeResult.status, 1);
  assert.equal(removedTypeResult.envelope.ok, false);
  assert.equal(removedTypeResult.envelope.error.code, 'document_type_not_found');

  const describeEnvelope = run(['types', 'describe', 'decision', '--root', root], { cwd: root });
  assert.equal(describeEnvelope.ok, true);
  assert.equal(describeEnvelope.data.type.pathPattern, 'decisions/{name}.md');

  const skillEnvelope = run(['skills', 'read', 'document-repair', '--root', root], { cwd: root });
  assert.equal(skillEnvelope.ok, true);
  assert.match(skillEnvelope.data.content, /### decision/);
  assert.match(skillEnvelope.data.content, /Purpose: Record a durable project decision\./);
  assert.match(skillEnvelope.data.content, /pathPattern: decisions\/\{name\}\.md/);
  assert.match(skillEnvelope.data.content, /Suggested sections:/);
  assert.match(skillEnvelope.data.content, /  - Decision/);

  const decisionBody = ['# Deploy Strategy', '', '## Decision', 'Use feature flags.'].join('\n');
  const writeEnvelope = run(
    [
      'write',
      '--type',
      'decision',
      '--path',
      'packages/api',
      '--name',
      'deploy-strategy',
      '--description',
      'Use when reviewing deploy strategy decisions.',
      '--body',
      decisionBody,
      '--yes',
      '--root',
      root,
    ],
    { cwd: root },
  );
  assert.equal(writeEnvelope.ok, true);
  assert.equal(writeEnvelope.data.target.path, 'packages/api/decisions/deploy-strategy.md');

  const readEnvelope = run(['read', 'packages/api/decisions/deploy-strategy', '--root', root], {
    cwd: root,
  });
  assert.equal(readEnvelope.ok, true);
  assert.equal(readEnvelope.data.kind, 'decision');
  assert.match(readEnvelope.data.content, /Use feature flags/);

  mkdirSync(join(root, 'packages/api/docs/runbook'), { recursive: true });
  writeFileSync(
    join(root, 'packages/api/docs/runbook/deploy.md'),
    [
      '---',
      'name: packages/api/docs/runbook/deploy',
      'description: Use when deploying the API.',
      '---',
      '',
      '# Deploy',
      '',
      '## Steps',
      'Run deploy.',
      '',
    ].join('\n'),
  );

  const graphEnvelope = run(['graph', '--root', root], { cwd: root });
  assert.equal(graphEnvelope.ok, true);
  assert.ok(graphEnvelope.data.edges.some((edge) => edge.name === 'packages/api/decisions/deploy-strategy'));
  assert.equal(
    graphEnvelope.data.nodes.some((node) => node.path === 'packages/api/docs/runbook/deploy.md'),
    false,
  );

  const removedRunbookReadResult = runFailure([
    'read',
    'packages/api/docs/runbook/deploy',
    '--root',
    root,
  ], { cwd: root });
  assert.equal(removedRunbookReadResult.status, 1);
  assert.equal(removedRunbookReadResult.envelope.ok, false);
  assert.equal(removedRunbookReadResult.envelope.error.code, 'non_target_document');

  const nonTargetSignal = waitForValue(
    () =>
      readSignals(root).find(
        (record) =>
          record.frictionPattern === 'non_target_document' &&
          record.target.path === 'packages/api/docs/runbook/deploy.md',
      ),
    'non_target_document signal for removed runbook type',
  );
  assert.equal(nonTargetSignal.target.kind, 'document');
  assert.equal(nonTargetSignal.target.name, 'packages/api/docs/runbook/deploy');

  const validateEnvelope = run(['validate', '--root', root], { cwd: root });
  assert.equal(validateEnvelope.ok, true);

  const reinitEnvelope = run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  assert.equal(reinitEnvelope.ok, true);
  assert.ok(
    reinitEnvelope.data.changes.some(
      (change) =>
        change.path === '.docs-harness/registry/document-types.json' && change.action === 'noop',
    ),
  );
  const reloadedRegistry = JSON.parse(readFileSync(registryPath, 'utf8'));
  assert.ok(reloadedRegistry.types.some((type) => type.name === 'decision'));
  assert.equal(reloadedRegistry.types.some((type) => type.name === 'route'), false);
  assert.equal(reloadedRegistry.types.some((type) => type.name === 'runbook'), false);
});

test('types ignore legacy registry path and removed aliases', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-types-no-compat-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  writeFileSync(
    join(root, '.docs-harness/document-types.json'),
    JSON.stringify(
      {
        types: [
          {
            name: 'legacy',
            purpose: 'Legacy path.',
            useWhen: ['Legacy path exists.'],
            pathPattern: 'docs/legacy/{name}.md',
            requiresName: true,
            requiresDescription: true,
            requiresReadme: false,
            requiresRoute: false,
            softLineLimit: 80,
            hardLineLimit: 120,
            sections: [{ heading: 'Legacy', required: true }],
          },
        ],
      },
      null,
      2,
    ),
  );

  const listEnvelope = run(['types', 'list', '--root', root], { cwd: root });
  assert.equal(listEnvelope.ok, true);
  assert.equal(listEnvelope.data.types.some((type) => type.name === 'legacy'), false);

  const aliasResult = runFailure(['types', 'describe', 'agents', '--root', root], { cwd: root });
  assert.equal(aliasResult.status, 1);
  assert.equal(aliasResult.envelope.ok, false);
  assert.equal(aliasResult.envelope.error.code, 'document_type_not_found');
});

test('write previews readme without writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-readme-'));
  const body = ['# API', '', '## What It Is', 'API package.', '', '## Why It Exists', 'Boundary.', '', '## How To Use It', 'Run it.'].join(
    '\n',
  );
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  const envelope = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the API package.',
      '--body',
      body,
      '--dry-run',
      '--root',
      root,
    ],
    { cwd: root },
  );
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.dryRun, true);
  assert.equal(envelope.data.valid, true);
  assert.equal(envelope.data.target.path, 'packages/api/README.md');
  assert.equal(envelope.data.target.description, 'Use when understanding the API package.');
  assert.deepEqual(envelope.data.routeEntry, {
    enabled: true,
    route: 'AGENTS.md',
    name: 'packages/api/README',
    description: 'Use when understanding the API package.',
    action: 'add',
  });
  assert.ok(
    envelope.data.changes.some(
      (change) => change.kind === 'routeEntry' && change.path === 'AGENTS.md' && change.action === 'update',
    ),
  );
  assert.equal(existsSync(join(root, 'packages/api/README.md')), false);
  assert.doesNotMatch(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /packages\/api\/README/);
});

test('dogfood flow writes docs, indexes them, discovers them, and validates graph', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-dogfood-'));
  const readmeBody = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');
  const routeBody = [
    '# API Docs',
    '',
    '## Document Graph Entries',
    '',
    '- [agent-index] name="packages/api/README" description="Use when understanding the API package."',
  ].join('\n');
  const runbookBody = [
    '# Deploy',
    '',
    '## Contexto',
    'Deploying.',
    '',
    '## Antes De Ejecutar',
    'Access.',
    '',
    '## Procedimiento',
    'Run deploy.',
    '',
    '## Verificacion',
    'Check health.',
    '',
    '## Recuperacion',
    'Rollback.',
    '',
    '## Entradas',
    'CLI.',
  ].join('\n');

  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  const readmeDryRun = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the API package.',
      '--body',
      readmeBody,
      '--dry-run',
      '--root',
      root,
    ],
    { cwd: root },
  );
  assert.equal(readmeDryRun.ok, true);
  assert.equal(readmeDryRun.data.routeEntry.action, 'add');
  assert.equal(existsSync(join(root, 'packages/api/README.md')), false);
  assert.doesNotMatch(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /packages\/api\/README/);

  run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the API package.',
      '--body',
      readmeBody,
      '--yes',
      '--root',
      root,
    ],
    { cwd: root },
  );
  run(
    [
      'write',
      '--type',
      'route',
      '--path',
      'packages/api',
      '--description',
      'Use when discovering API package docs.',
      '--body',
      routeBody,
      '--yes',
      '--root',
      root,
    ],
    { cwd: root },
  );
  run(
    [
      'write',
      '--type',
      'runbook',
      '--path',
      'packages/api',
      '--name',
      'deploy',
      '--description',
      'Use when deploying the API.',
      '--body',
      runbookBody,
      '--yes',
      '--root',
      root,
    ],
    { cwd: root },
  );

  const insightEnvelope = run(['insight', 'packages/api', '--root', root], { cwd: root });
  assert.equal(insightEnvelope.ok, true);
  assert.equal(insightEnvelope.data.fallback, false);
  assert.deepEqual(insightEnvelope.data.module, {
    path: 'packages/api',
    readme: {
      name: 'packages/api/README',
      description: 'Use when understanding the API package.',
    },
  });
  assert.equal(insightEnvelope.data.route.path, 'packages/api/AGENTS.md');
  assert.ok(insightEnvelope.data.route.entries.some((entry) => entry.name === 'packages/api/README'));
  assert.ok(
    insightEnvelope.data.route.entries.some((entry) => entry.name === 'packages/api/docs/runbook/deploy'),
  );

  const fallbackInsight = run(['insight', 'packages/api/src/routes.ts', '--root', root], { cwd: root });
  assert.equal(fallbackInsight.ok, true);
  assert.equal(fallbackInsight.data.fallback, true);
  assert.equal(fallbackInsight.data.requestedModulePath, 'packages/api/src');
  assert.equal(fallbackInsight.data.module.path, 'packages/api');
  assert.equal(fallbackInsight.data.module.readme.description, 'Use when understanding the API package.');
  assert.equal(fallbackInsight.data.route.path, 'packages/api/AGENTS.md');
  assert.match(fallbackInsight.data.message, /using nearest ancestor module packages\/api/);

  const readEnvelope = run(['read', 'packages/api/docs/runbook/deploy', '--root', root], { cwd: root });
  assert.equal(readEnvelope.ok, true);
  assert.match(readEnvelope.data.content, /Run deploy\./);

  const validateEnvelope = run(['validate', '--root', root], { cwd: root });
  assert.equal(validateEnvelope.ok, true);
  assert.equal(validateEnvelope.data.valid, true);
});

test('write route honors configured CLAUDE.md filename', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-route-'));
  run(['init', '--agent', 'claude', '--yes', '--root', root], { cwd: root });
  const body = [
    '# API Docs',
    '',
    '## Document Graph Entries',
    '',
    '- [agent-index] name="README" description="Use when understanding the project overview."',
  ].join('\n');
  const envelope = run(
    [
      'write',
      '--type',
      'route',
      '--path',
      'packages/api',
      '--description',
      'Use when discovering API package docs.',
      '--body',
      body,
      '--yes',
      '--root',
      root,
    ],
    { cwd: root },
  );
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.target.path, 'packages/api/CLAUDE.md');
  assert.match(readFileSync(join(root, 'packages/api/CLAUDE.md'), 'utf8'), /Document Graph Entries/);
  assert.match(
    readFileSync(join(root, 'CLAUDE.md'), 'utf8'),
    /name="packages\/api\/CLAUDE" description="Use when discovering API package docs."/,
  );
});

test('write typed document validates sibling complete functional entity docs', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-invalid-'));
  const body = [
    '# Deploy',
    '',
    '## When To Use',
    'Deploying.',
    '',
    '## Preconditions',
    'Access.',
    '',
    '## Steps',
    'Run deploy.',
    '',
    '## Verification',
    'Check health.',
    '',
    '## Rollback Or Recovery',
    'Rollback.',
    '',
    '## Entry Points',
    'CLI.',
  ].join('\n');
  const envelope = run(
    [
      'write',
      '--type',
      'runbook',
      '--path',
      'packages/api',
      '--name',
      'deploy',
      '--description',
      'Use when deploying the API.',
      '--body',
      body,
      '--dry-run',
      '--root',
      root,
    ],
    { cwd: root },
  );
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.valid, false);
  assert.ok(envelope.data.errors.some((error) => error.includes('README.md')));
});

test('write typed document writes metadata after prerequisites exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-runbook-'));
  const readmeBody = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');
  const routeBody = [
    '# API Docs',
    '',
    '## Document Graph Entries',
    '',
    '- [agent-index] name="packages/api/README" description="Use when understanding the API package."',
  ].join('\n');
  const runbookBody = [
    '# Deploy',
    '',
    '## When To Use',
    'Deploying.',
    '',
    '## Preconditions',
    'Access.',
    '',
    '## Steps',
    'Run deploy.',
    '',
    '## Verification',
    'Check health.',
    '',
    '## Rollback Or Recovery',
    'Rollback.',
    '',
    '## Entry Points',
    'CLI.',
  ].join('\n');

  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the API package.',
      '--body',
      readmeBody,
      '--yes',
      '--root',
      root,
    ],
    {
      cwd: root,
    },
  );
  run(
    [
      'write',
      '--type',
      'route',
      '--path',
      'packages/api',
      '--description',
      'Use when discovering API package docs.',
      '--body',
      routeBody,
      '--yes',
      '--root',
      root,
    ],
    {
      cwd: root,
    },
  );
  const envelope = run(
    [
      'write',
      '--type',
      'runbook',
      '--path',
      'packages/api',
      '--name',
      'deploy',
      '--description',
      'Use when deploying the API.',
      '--body',
      runbookBody,
      '--yes',
      '--root',
      root,
    ],
    { cwd: root },
  );
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.valid, true);
  assert.equal(envelope.data.target.path, 'packages/api/docs/runbook/deploy.md');
  assert.deepEqual(envelope.data.routeEntry, {
    enabled: true,
    route: 'packages/api/AGENTS.md',
    name: 'packages/api/docs/runbook/deploy',
    description: 'Use when deploying the API.',
    action: 'add',
  });
  const written = readFileSync(join(root, 'packages/api/docs/runbook/deploy.md'), 'utf8');
  assert.match(written, /^---\nname: packages\/api\/docs\/runbook\/deploy\n/m);
  assert.match(written, /description: Use when deploying the API\./);
  assert.match(
    readFileSync(join(root, 'packages/api/AGENTS.md'), 'utf8'),
    /name="packages\/api\/docs\/runbook\/deploy" description="Use when deploying the API\."/,
  );
});

test('write can skip route entry maintenance explicitly', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-skip-route-'));
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');
  const envelope = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--body',
      body,
      '--no-route-entry',
      '--yes',
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.valid, true);
  assert.deepEqual(envelope.data.routeEntry, {
    enabled: false,
    name: 'packages/api/README',
    description: '',
    action: 'skipped',
  });
  assert.match(readFileSync(join(root, 'packages/api/README.md'), 'utf8'), /^# API/);
});

test('write requires confirmation before document or route entry writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-confirm-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');

  const result = runFailure(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the API package.',
      '--body',
      body,
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.code, 'confirmation_required');
  assert.equal(result.envelope.error.confirm, '--yes');
  assert.equal(existsSync(join(root, 'packages/api/README.md')), false);
  assert.doesNotMatch(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /packages\/api\/README/);
});

test('write updates an existing route entry description', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-update-route-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="packages/api/README" description="Use when understanding the old API package."',
      '',
    ].join('\n'),
  );
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');

  const envelope = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the updated API package.',
      '--body',
      body,
      '--yes',
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.routeEntry.action, 'update');
  const route = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.match(route, /<!-- docs-harness:START -->/);
  assert.match(route, /<!-- docs-harness:END -->/);
  assert.match(route, /name="packages\/api\/README" description="Use when understanding the updated API package\."/);
  assert.doesNotMatch(route, /Use when understanding the old API package/);
});

test('write keeps matching route entry as noop', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-noop-route-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '<!-- docs-harness:START -->',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="packages/api/README" description="Use when understanding the API package."',
      '',
      '<!-- docs-harness:END -->',
      '',
    ].join('\n'),
  );
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');

  const envelope = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the API package.',
      '--body',
      body,
      '--dry-run',
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.routeEntry.action, 'noop');
  assert.ok(
    envelope.data.changes.some(
      (change) => change.kind === 'routeEntry' && change.path === 'AGENTS.md' && change.action === 'noop',
    ),
  );
});

test('write creates managed graph section when route has no graph section', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-route-no-section-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  writeFileSync(join(root, 'AGENTS.md'), ['# Instructions', '', 'General project instructions.', ''].join('\n'));
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');

  const envelope = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the API package.',
      '--body',
      body,
      '--yes',
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.routeEntry.action, 'add');
  const route = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.match(route, /General project instructions\./);
  assert.match(route, /<!-- docs-harness:START -->\n## Document Graph Entries\n- \[agent-index\] name="packages\/api\/README" description="Use when understanding the API package\."\n\n<!-- docs-harness:END -->/);
});

test('write creates graph section inside existing managed route block', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-route-managed-no-section-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '<!-- docs-harness:START -->',
      'Managed by docs-harness. Edits outside this block are preserved.',
      '<!-- docs-harness:END -->',
      '',
    ].join('\n'),
  );
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');

  const envelope = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the API package.',
      '--body',
      body,
      '--yes',
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.routeEntry.action, 'add');
  const route = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.match(route, /<!-- docs-harness:START -->\nManaged by docs-harness\. Edits outside this block are preserved\.\n\n## Document Graph Entries\n- \[agent-index\] name="packages\/api\/README" description="Use when understanding the API package\."\n\n<!-- docs-harness:END -->/);
});

test('write migrates existing route entries into managed route block', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-route-migrate-unmanaged-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '<!-- docs-harness:START -->',
      '## Document Graph Entries',
      '',
      '<!-- docs-harness:END -->',
      '',
      '- [agent-index] name="README" description="Use when understanding the project overview."',
      '',
    ].join('\n'),
  );
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');

  const envelope = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the API package.',
      '--body',
      body,
      '--yes',
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(envelope.ok, true);
  const route = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.match(route, /<!-- docs-harness:START -->\n## Document Graph Entries\n- \[agent-index\] name="README" description="Use when understanding the project overview\."\n- \[agent-index\] name="packages\/api\/README" description="Use when understanding the API package\."\n\n<!-- docs-harness:END -->/);
  assert.doesNotMatch(route.replace(/<!-- docs-harness:START -->[\s\S]*<!-- docs-harness:END -->/, ''), /\[agent-index\]/);
});

test('write reports missing ancestor route for linkable documents', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-route-missing-'));
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');

  const result = runFailure(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the API package.',
      '--body',
      body,
      '--dry-run',
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.code, 'route_not_found');
  assert.match(result.envelope.error.hint, /--no-route-entry/);
  assert.match(result.envelope.error.hint, /docs-harness skills read document-repair/);
});

test('write rejects descriptions that cannot be encoded in agent-index attributes', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-description-quote-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');

  const envelope = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding "the API" package.',
      '--body',
      body,
      '--dry-run',
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.valid, false);
  assert.ok(envelope.data.errors.some((error) => error.includes('double quotes')));
});

test('write accepts localized description wording', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-localized-description-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');

  const envelope = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      '用于了解 API 包。',
      '--body',
      body,
      '--dry-run',
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.valid, true);
  assert.equal(envelope.data.target.description, '用于了解 API 包。');
  assert.equal(envelope.data.routeEntry.description, '用于了解 API 包。');
});

test('write rejects duplicate route entries for the target name', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-duplicate-route-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="packages/api/README" description="One."',
      '- [agent-index] name="packages/api/README" description="Two."',
      '',
    ].join('\n'),
  );
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');

  const result = runFailure(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the updated API package.',
      '--body',
      body,
      '--dry-run',
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.code, 'duplicate_route_entry');
  assert.match(result.envelope.error.message, /duplicate entries/);
  assert.match(result.envelope.error.hint, /docs-harness skills read document-repair/);
});

test('write rejects invalid existing route entry syntax for the target name', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-invalid-route-entry-'));
  run(['init', '--agent', 'generic', '--yes', '--root', root], { cwd: root });
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '## Document Graph Entries',
      '',
      '- [agent-index] name="packages/api/README" description="One." owner="docs"',
      '',
    ].join('\n'),
  );
  const body = [
    '# API',
    '',
    '## What It Is',
    'API package.',
    '',
    '## Why It Exists',
    'Boundary.',
    '',
    '## How To Use It',
    'Run it.',
  ].join('\n');

  const result = runFailure(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Use when understanding the API package.',
      '--body',
      body,
      '--dry-run',
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.code, 'invalid_route_entry');
  assert.match(result.envelope.error.hint, /docs-harness skills read document-repair/);
  assert.match(result.envelope.error.message, /invalid agent-index syntax/);
});
