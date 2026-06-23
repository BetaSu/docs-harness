import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { CliError } from './envelope.js';

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function toProjectPath(root: string, input: string): string {
  const absolute = resolvePath(root, input);
  const projectPath = normalizePath(relative(root, absolute));
  return projectPath || '.';
}

export function resolvePath(root: string, input: string): string {
  return resolve(isAbsolute(input) ? input : join(root, input));
}

export function assertInsideRoot(root: string, absolutePath: string, input: string): void {
  const relativePath = relative(root, absolutePath);
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return;
  }

  throw new CliError({
    code: 'path_outside_root',
    message: `Path must be inside the project root: ${input}.`,
    hint: 'Pass a path inside this project or use `--root <path>`.',
  });
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await ensureDirectory(dirname(path));
  await writeFile(path, content, 'utf8');
}

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export async function collectMarkdownFiles(root: string, relativeDirectory = '.'): Promise<string[]> {
  const absoluteDirectory = resolvePath(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relativePath =
      relativeDirectory === '.' ? entry.name : normalizePath(join(relativeDirectory, entry.name));

    if (entry.isDirectory()) {
      if (isExcludedDirectory(entry.name)) continue;
      files.push(...(await collectMarkdownFiles(root, relativePath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) files.push(relativePath);
  }

  return files.sort();
}

function isExcludedDirectory(name: string): boolean {
  return new Set([
    '.docs-harness',
    '.git',
    '.history',
    '.next',
    '.turbo',
    '.worktrees',
    'coverage',
    'dist',
    'node_modules',
  ]).has(name);
}
