import ignore from 'ignore';

import { normalizePath } from './files.js';

export const DEFAULT_IGNORE_PATTERNS = [
  '.git/**',
  'node_modules/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.docs-harness/logs/**',
];

export type IgnoreMatcher = (path: string) => boolean;

export function createIgnoreMatcher(patterns: string[]): IgnoreMatcher {
  const matcher = ignore().add(patterns);
  return (path: string) => matcher.ignores(normalizePath(path));
}

export function isIgnoredPath(path: string, patterns: string[]): boolean {
  return createIgnoreMatcher(patterns)(path);
}
