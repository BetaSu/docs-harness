import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const installGlobal = args.has('--install-global');
const packDirectory = join(root, '.pack');

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await rm(packDirectory, { force: true, recursive: true });
await mkdir(packDirectory, { recursive: true });

run('npm', ['run', 'clean']);
run('npm', ['run', 'build']);
await runTests();

const packOutput = run('npm', ['pack', '--pack-destination', packDirectory, '--ignore-scripts'], {
  captureStdout: true,
});
const tarballName = packOutput
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .at(-1);

if (!tarballName) {
  throw new Error('npm pack did not report a tarball name.');
}

const tarballPath = join(packDirectory, tarballName);
await stat(tarballPath);

const tempPrefix = await mkdtemp(join(tmpdir(), 'docs-harness-local-pack-'));
try {
  run('npm', ['install', '--global', '--prefix', tempPrefix, tarballPath]);
  const tempBin = process.platform === 'win32'
    ? join(tempPrefix, 'docs-harness.cmd')
    : join(tempPrefix, 'bin', 'docs-harness');

  run(tempBin, ['skills', 'list']);
  run(tempBin, ['skills', 'read', 'agent-init']);
} finally {
  await rm(tempPrefix, { force: true, recursive: true });
}

if (installGlobal) {
  run('npm', ['install', '--global', tarballPath]);
  run('docs-harness', ['skills', 'list']);
  run('docs-harness', ['skills', 'read', 'agent-init']);
}

console.log(`Packed ${packageJson.name}@${packageJson.version}: ${tarballPath}`);
if (!installGlobal) {
  console.log(`Verified local install in a temporary npm prefix.`);
  console.log(`Install locally with: npm install --global ${tarballPath}`);
}

async function runTests() {
  const testDirectory = join(root, 'test');
  const testFiles = (await readdir(testDirectory))
    .filter((file) => file.endsWith('.test.js'))
    .sort()
    .map((file) => join(testDirectory, file));

  run('node', ['--test', ...testFiles]);
}

function run(command, commandArgs, options = {}) {
  console.log(`$ ${[command, ...commandArgs].join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    stdio: options.captureStdout ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${[command, ...commandArgs].join(' ')}`);
  }

  return options.captureStdout ? result.stdout : '';
}
