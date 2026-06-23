import { basename } from 'node:path';

import { fileExists, readTextFile } from './files.js';
import { DEFAULT_IGNORE_PATTERNS } from './ignore.js';
import { getConfigPath, type HarnessConfig } from './project.js';

export type RuntimeConfig = {
  ignore: string[];
  instructionFile: string;
  instructionFileName: string;
};

export async function loadRuntimeConfig(root: string): Promise<RuntimeConfig> {
  const configPath = getConfigPath(root);
  if (!fileExists(configPath)) {
    return {
      ignore: DEFAULT_IGNORE_PATTERNS,
      instructionFile: 'AGENTS.md',
      instructionFileName: 'AGENTS.md',
    };
  }

  const parsed = JSON.parse(await readTextFile(configPath)) as Partial<HarnessConfig>;
  const instructionFile = parsed.instructionFile || 'AGENTS.md';
  return {
    ignore: Array.isArray(parsed.ignore)
      ? parsed.ignore.filter((pattern): pattern is string => typeof pattern === 'string')
      : DEFAULT_IGNORE_PATTERNS,
    instructionFile,
    instructionFileName: basename(instructionFile),
  };
}
