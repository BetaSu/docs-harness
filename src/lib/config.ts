import { basename } from 'node:path';

import { fileExists, readTextFile } from './files.js';
import { getConfigPath, type HarnessConfig } from './project.js';

export type RuntimeConfig = {
  instructionFile: string;
  instructionFileName: string;
};

export async function loadRuntimeConfig(root: string): Promise<RuntimeConfig> {
  const configPath = getConfigPath(root);
  if (!fileExists(configPath)) {
    return {
      instructionFile: 'AGENTS.md',
      instructionFileName: 'AGENTS.md',
    };
  }

  const parsed = JSON.parse(await readTextFile(configPath)) as Partial<HarnessConfig>;
  const instructionFile = parsed.instructionFile || 'AGENTS.md';
  return {
    instructionFile,
    instructionFileName: basename(instructionFile),
  };
}
