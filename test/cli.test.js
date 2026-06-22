import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const CLI = new URL('../dist/cli.js', import.meta.url).pathname;

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-'));
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '- [agent-index] name="README" description="Understand the project overview."',
      '- [agent-index] name="docs/runbook/deploy" description="Deploy the project."',
      '',
    ].join('\n'),
  );
  writeFileSync(join(root, 'README.md'), '# Demo\n\nA demo project.\n');
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

test('skills list returns compact success envelope by default', () => {
  const envelope = run(['skills', 'list'], { cwd: process.cwd() });
  assert.equal(envelope.ok, true);
  assert.deepEqual(Object.keys(envelope).sort(), ['data', 'ok']);
  assert.equal(envelope.data.skills[0].name, 'core');
});

test('schema is the default machine-readable command contract', () => {
  const defaultEnvelope = run([], { cwd: process.cwd() });
  assert.equal(defaultEnvelope.ok, true);
  assert.ok(defaultEnvelope.data.commands.some((command) => command.id === 'write'));

  const writeEnvelope = run(['schema', '--command', 'write'], { cwd: process.cwd() });
  assert.equal(writeEnvelope.ok, true);
  assert.equal(writeEnvelope.data.command.id, 'write');
  assert.deepEqual(writeEnvelope.data.command.capabilities.writes, ['document', 'routeEntry']);
  assert.ok(writeEnvelope.data.command.args.some((arg) => arg.name === 'no-route-entry'));
  assert.ok(writeEnvelope.data.command.branches.includes('route_not_found'));
  assert.ok(writeEnvelope.data.command.branches.includes('route_entry_validation_error'));

  const initEnvelope = run(['schema', '--command', 'init'], { cwd: process.cwd() });
  assert.equal(initEnvelope.ok, true);
  assert.ok(
    initEnvelope.data.command.capabilities.writes.includes(
      '.docs-harness/registry/document-types.json',
    ),
  );
  const agentArg = initEnvelope.data.command.args.find((arg) => arg.name === 'agent');
  assert.deepEqual(agentArg.values, ['codex', 'claude']);
});

test('insight lists entries from nearest AGENTS.md', () => {
  const root = createProject();
  const envelope = run(['insight', '.', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.route, 'AGENTS.md');
  assert.deepEqual(envelope.data.entries, [
    {
      name: 'README',
      description: 'Understand the project overview.',
    },
    {
      name: 'docs/runbook/deploy',
      description: 'Deploy the project.',
    },
  ]);
});

test('show reads a document by stable name', () => {
  const root = createProject();
  const envelope = run(['show', 'README', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.name, 'README');
  assert.equal(envelope.data.kind, 'readme');
  assert.match(envelope.data.content, /A demo project/);
});

test('validate reports graph errors inside data', () => {
  const root = createProject();
  const envelope = run(['validate', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.valid, false);
  assert.ok(envelope.data.errors.some((error) => error.includes('target_not_found')));
});

test('init previews AGENTS.md setup without writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-init-'));
  writeFileSync(join(root, 'README.md'), '# Demo\n');
  const envelope = run(['init', '--dry-run', '--root', root], { cwd: root });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.dryRun, true);
  assert.equal(envelope.data.agent, 'codex');
  assert.equal(envelope.data.instructionFile, 'AGENTS.md');
  assert.equal(existsSync(join(root, 'AGENTS.md')), false);
  assert.equal(existsSync(join(root, '.docs-harness/registry/document-types.json')), false);
  assert.ok(envelope.data.changes.some((change) => change.path === 'AGENTS.md'));
  assert.ok(
    envelope.data.changes.some(
      (change) => change.path === '.docs-harness/registry/document-types.json',
    ),
  );
});

test('init writes CLAUDE.md and configures future route lookup', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-claude-'));
  writeFileSync(join(root, 'README.md'), '# Demo\n');
  const initEnvelope = run(['init', '--agent', 'claude', '--yes', '--root', root], { cwd: root });
  assert.equal(initEnvelope.ok, true);
  assert.equal(initEnvelope.data.instructionFile, 'CLAUDE.md');
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), /docs-harness insight/);

  const insightEnvelope = run(['insight', '.', '--root', root], { cwd: root });
  assert.equal(insightEnvelope.ok, true);
  assert.equal(insightEnvelope.data.route, 'CLAUDE.md');
  assert.deepEqual(insightEnvelope.data.entries, [
    {
      name: 'README',
      description: '了解项目概览、目录职责或基础使用方式时',
    },
  ]);
  assert.equal(existsSync(join(root, '.docs-harness/registry/document-types.json')), true);
});

test('init requires confirmation before writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-confirm-'));
  const result = runFailure(['init', '--agent', 'codex', '--root', root], { cwd: root });
  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.type, 'confirmation_required');
  assert.equal(result.envelope.error.confirm, '--yes');
});

test('init rejects unsupported agent values', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-unsupported-agent-'));
  const result = runFailure(['init', '--agent', 'auto', '--dry-run', '--root', root], { cwd: root });
  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.type, 'validation');
  assert.match(result.envelope.error.hint, /codex/);
  assert.match(result.envelope.error.hint, /claude/);
  assert.doesNotMatch(result.envelope.error.hint, /auto/);
});

test('types list and describe expose built-in contracts', () => {
  const listEnvelope = run(['types', 'list'], { cwd: process.cwd() });
  assert.equal(listEnvelope.ok, true);
  assert.ok(listEnvelope.data.types.some((type) => type.name === 'runbook'));

  const describeEnvelope = run(['types', 'describe', 'runbook'], { cwd: process.cwd() });
  assert.equal(describeEnvelope.ok, true);
  assert.equal(describeEnvelope.data.type.name, 'runbook');
  assert.equal(describeEnvelope.data.type.requiresDescription, true);
  assert.ok(describeEnvelope.data.type.sections.some((section) => section.heading === '步骤'));
});

test('types prefer project-local registry written by init', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-types-registry-'));
  run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  const registryPath = join(root, '.docs-harness/registry/document-types.json');
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  registry.types.push({
    name: 'decision',
    purpose: 'Record a durable project decision.',
    useWhen: ['A project decision should be discoverable by agents.'],
    pathPattern: 'docs/decision/{name}.md',
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

  const describeEnvelope = run(['types', 'describe', 'decision', '--root', root], { cwd: root });
  assert.equal(describeEnvelope.ok, true);
  assert.equal(describeEnvelope.data.type.pathPattern, 'docs/decision/{name}.md');

  const reinitEnvelope = run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  assert.equal(reinitEnvelope.ok, true);
  assert.ok(
    reinitEnvelope.data.changes.some(
      (change) =>
        change.path === '.docs-harness/registry/document-types.json' && change.action === 'noop',
    ),
  );
  assert.ok(JSON.parse(readFileSync(registryPath, 'utf8')).types.some((type) => type.name === 'decision'));
});

test('write previews readme without writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-readme-'));
  const body = ['# API', '', '## 是什么', 'API package.', '', '## 为什么', 'Boundary.', '', '## 怎么用', 'Run it.'].join(
    '\n',
  );
  run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  const envelope = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Understand the API package.',
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
  assert.equal(envelope.data.target.description, 'Understand the API package.');
  assert.deepEqual(envelope.data.routeEntry, {
    enabled: true,
    route: 'AGENTS.md',
    name: 'packages/api/README',
    description: 'Understand the API package.',
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
    '## 是什么',
    'API package.',
    '',
    '## 为什么',
    'Boundary.',
    '',
    '## 怎么用',
    'Run it.',
  ].join('\n');
  const routeBody = [
    '# API Docs',
    '',
    '## 文档图入口',
    '',
    '- [agent-index] name="packages/api/README" description="Understand the API package."',
  ].join('\n');
  const runbookBody = [
    '# Deploy',
    '',
    '## 适用场景',
    'Deploying.',
    '',
    '## 前置条件',
    'Access.',
    '',
    '## 步骤',
    'Run deploy.',
    '',
    '## 验证',
    'Check health.',
    '',
    '## 回滚或恢复',
    'Rollback.',
    '',
    '## 入口',
    'CLI.',
  ].join('\n');

  run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  const readmeDryRun = run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Understand the API package.',
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
      'Understand the API package.',
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
      'Discover API package docs.',
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
      'Deploy the API.',
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
  assert.equal(insightEnvelope.data.route, 'packages/api/AGENTS.md');
  assert.ok(insightEnvelope.data.entries.some((entry) => entry.name === 'packages/api/README'));
  assert.ok(
    insightEnvelope.data.entries.some((entry) => entry.name === 'packages/api/docs/runbook/deploy'),
  );

  const showEnvelope = run(['show', 'packages/api/docs/runbook/deploy', '--root', root], { cwd: root });
  assert.equal(showEnvelope.ok, true);
  assert.match(showEnvelope.data.content, /Run deploy\./);

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
    '## 文档图入口',
    '',
    '- [agent-index] name="README" description="了解项目概览时"',
  ].join('\n');
  const envelope = run(
    [
      'write',
      '--type',
      'route',
      '--path',
      'packages/api',
      '--description',
      '了解 API 包文档入口时',
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
  assert.match(readFileSync(join(root, 'packages/api/CLAUDE.md'), 'utf8'), /文档图入口/);
  assert.match(
    readFileSync(join(root, 'CLAUDE.md'), 'utf8'),
    /name="packages\/api\/CLAUDE" description="了解 API 包文档入口时"/,
  );
});

test('write typed document validates sibling subject docs', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-invalid-'));
  const body = [
    '# Deploy',
    '',
    '## 适用场景',
    'Deploying.',
    '',
    '## 前置条件',
    'Access.',
    '',
    '## 步骤',
    'Run deploy.',
    '',
    '## 验证',
    'Check health.',
    '',
    '## 回滚或恢复',
    'Rollback.',
    '',
    '## 入口',
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
      'Deploy the API.',
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
    '## 是什么',
    'API package.',
    '',
    '## 为什么',
    'Boundary.',
    '',
    '## 怎么用',
    'Run it.',
  ].join('\n');
  const routeBody = [
    '# API Docs',
    '',
    '## 文档图入口',
    '',
    '- [agent-index] name="packages/api/README" description="了解 API 包时"',
  ].join('\n');
  const runbookBody = [
    '# Deploy',
    '',
    '## 适用场景',
    'Deploying.',
    '',
    '## 前置条件',
    'Access.',
    '',
    '## 步骤',
    'Run deploy.',
    '',
    '## 验证',
    'Check health.',
    '',
    '## 回滚或恢复',
    'Rollback.',
    '',
    '## 入口',
    'CLI.',
  ].join('\n');

  run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  run(
    [
      'write',
      '--type',
      'readme',
      '--path',
      'packages/api',
      '--description',
      'Understand the API package.',
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
      'Discover API package docs.',
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
      'Deploy the API.',
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
    description: 'Deploy the API.',
    action: 'add',
  });
  const written = readFileSync(join(root, 'packages/api/docs/runbook/deploy.md'), 'utf8');
  assert.match(written, /^---\nname: packages\/api\/docs\/runbook\/deploy\n/m);
  assert.match(written, /description: Deploy the API\./);
  assert.match(
    readFileSync(join(root, 'packages/api/AGENTS.md'), 'utf8'),
    /name="packages\/api\/docs\/runbook\/deploy" description="Deploy the API\."/,
  );
});

test('write can skip route entry maintenance explicitly', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-skip-route-'));
  const body = [
    '# API',
    '',
    '## 是什么',
    'API package.',
    '',
    '## 为什么',
    'Boundary.',
    '',
    '## 怎么用',
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
  run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  const body = [
    '# API',
    '',
    '## 是什么',
    'API package.',
    '',
    '## 为什么',
    'Boundary.',
    '',
    '## 怎么用',
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
      'Understand the API package.',
      '--body',
      body,
      '--root',
      root,
    ],
    { cwd: root },
  );

  assert.equal(result.status, 1);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.type, 'confirmation_required');
  assert.equal(result.envelope.error.confirm, '--yes');
  assert.equal(existsSync(join(root, 'packages/api/README.md')), false);
  assert.doesNotMatch(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /packages\/api\/README/);
});

test('write updates an existing route entry description', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-update-route-'));
  run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '## 文档图入口',
      '',
      '- [agent-index] name="packages/api/README" description="Old description."',
      '',
    ].join('\n'),
  );
  const body = [
    '# API',
    '',
    '## 是什么',
    'API package.',
    '',
    '## 为什么',
    'Boundary.',
    '',
    '## 怎么用',
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
      'New description.',
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
  assert.match(route, /name="packages\/api\/README" description="New description\."/);
  assert.doesNotMatch(route, /Old description/);
});

test('write keeps matching route entry as noop', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-noop-route-'));
  run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '## 文档图入口',
      '',
      '- [agent-index] name="packages/api/README" description="Understand the API package."',
      '',
    ].join('\n'),
  );
  const body = [
    '# API',
    '',
    '## 是什么',
    'API package.',
    '',
    '## 为什么',
    'Boundary.',
    '',
    '## 怎么用',
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
      'Understand the API package.',
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

test('write appends route entry at file end when route has no graph section', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-route-no-section-'));
  run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  writeFileSync(join(root, 'AGENTS.md'), ['# Instructions', '', 'General project instructions.', ''].join('\n'));
  const body = [
    '# API',
    '',
    '## 是什么',
    'API package.',
    '',
    '## 为什么',
    'Boundary.',
    '',
    '## 怎么用',
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
      'Understand the API package.',
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
  assert.match(
    readFileSync(join(root, 'AGENTS.md'), 'utf8'),
    /General project instructions\.\n\n- \[agent-index\] name="packages\/api\/README" description="Understand the API package\."\n$/,
  );
});

test('write reports missing ancestor route for linkable documents', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-route-missing-'));
  const body = [
    '# API',
    '',
    '## 是什么',
    'API package.',
    '',
    '## 为什么',
    'Boundary.',
    '',
    '## 怎么用',
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
      'Understand the API package.',
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
  assert.equal(result.envelope.error.type, 'not_found');
  assert.match(result.envelope.error.hint, /--no-route-entry/);
});

test('write rejects descriptions that cannot be encoded in agent-index attributes', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-description-quote-'));
  run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  const body = [
    '# API',
    '',
    '## 是什么',
    'API package.',
    '',
    '## 为什么',
    'Boundary.',
    '',
    '## 怎么用',
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
      'Understand "the API" package.',
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

test('write rejects duplicate route entries for the target name', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-duplicate-route-'));
  run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '## 文档图入口',
      '',
      '- [agent-index] name="packages/api/README" description="One."',
      '- [agent-index] name="packages/api/README" description="Two."',
      '',
    ].join('\n'),
  );
  const body = [
    '# API',
    '',
    '## 是什么',
    'API package.',
    '',
    '## 为什么',
    'Boundary.',
    '',
    '## 怎么用',
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
      'New description.',
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
  assert.equal(result.envelope.error.type, 'validation');
  assert.match(result.envelope.error.message, /duplicate entries/);
});

test('write rejects invalid existing route entry syntax for the target name', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-harness-write-invalid-route-entry-'));
  run(['init', '--agent', 'codex', '--yes', '--root', root], { cwd: root });
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '# Instructions',
      '',
      '## 文档图入口',
      '',
      '- [agent-index] name="packages/api/README" description="One." owner="docs"',
      '',
    ].join('\n'),
  );
  const body = [
    '# API',
    '',
    '## 是什么',
    'API package.',
    '',
    '## 为什么',
    'Boundary.',
    '',
    '## 怎么用',
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
      'Understand the API package.',
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
  assert.equal(result.envelope.error.type, 'validation');
  assert.match(result.envelope.error.message, /invalid agent-index syntax/);
});
