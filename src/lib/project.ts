import { existsSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

import type { ParsedArgs } from './args.js';
import { getStringFlag } from './args.js';

export const HARNESS_DIRECTORY = '.docs-harness';
export const CONFIG_FILE = 'config.json';
export const REGISTRY_DIRECTORY = 'registry';
export const DOCUMENT_TYPES_FILE = 'document-types.json';

export type AgentKind = 'claude' | 'codex';

export type HarnessConfig = {
  version: 1;
  instructionFile: string;
  agent: AgentKind;
};

export function resolveProjectRoot(args: ParsedArgs): string {
  const flagRoot = getStringFlag(args, 'root');
  if (flagRoot) return resolve(flagRoot);

  const envRoot = process.env.DOCS_HARNESS_ROOT;
  if (envRoot) return resolve(envRoot);

  const configuredRoot = findUp(process.cwd(), join(HARNESS_DIRECTORY, CONFIG_FILE));
  if (configuredRoot) return configuredRoot;

  const gitRoot = findUp(process.cwd(), '.git');
  return gitRoot ?? process.cwd();
}

export function getHarnessDirectory(root: string): string {
  return join(root, HARNESS_DIRECTORY);
}

export function getConfigPath(root: string): string {
  return join(getHarnessDirectory(root), CONFIG_FILE);
}

export function getRegistryDirectory(root: string): string {
  return join(getHarnessDirectory(root), REGISTRY_DIRECTORY);
}

export function getDocumentTypesPath(root: string): string {
  return join(getRegistryDirectory(root), DOCUMENT_TYPES_FILE);
}

function findUp(startPath: string, target: string): string | undefined {
  let current = resolve(startPath);
  const root = parse(current).root;

  while (true) {
    if (existsSync(join(current, target))) return current;
    if (current === root) return undefined;
    current = dirname(current);
  }
}
