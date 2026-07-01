import ignore from 'ignore';

import { normalizePath } from './files.js';
import type { SignalTarget } from './signal-patterns.js';

export const DEFAULT_IGNORE_PATTERNS = [
  '.git/**',
  'node_modules/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.agents/**',
  '.claude/**',
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

export function isSignalTargetIgnored(
  target: SignalTarget,
  routeFileName: string,
  isIgnored: IgnoreMatcher,
): boolean {
  return signalTargetPaths(target, routeFileName).some((path) => isIgnored(path));
}

function signalTargetPaths(target: SignalTarget, routeFileName: string): string[] {
  if (!target.path) return [];
  if (target.kind !== 'module') return [target.path];

  return [
    target.path,
    joinModulePath(target.path, 'README.md'),
    joinModulePath(target.path, routeFileName),
  ];
}

function joinModulePath(modulePath: string, path: string): string {
  return modulePath === '.' ? path : `${modulePath}/${path}`;
}
