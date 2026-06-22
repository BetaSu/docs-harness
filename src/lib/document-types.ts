import { join } from 'node:path';

import { fileExists, readTextFile } from './files.js';
import { getDocumentTypesPath, getHarnessDirectory } from './project.js';

export type DocumentTypeName = 'architecture' | 'constraints' | 'readme' | 'route' | 'runbook';

export type DocumentTypeSection = {
  heading: string;
  required: boolean;
};

export type DocumentTypeDefinition = {
  name: string;
  purpose: string;
  useWhen: string[];
  pathPattern: string;
  requiresName: boolean;
  requiresDescription: boolean;
  requiresReadme: boolean;
  requiresRoute: boolean;
  softLineLimit: number;
  hardLineLimit: number;
  sections: DocumentTypeSection[];
};

const BUILTIN_DOCUMENT_TYPES: Record<DocumentTypeName, DocumentTypeDefinition> = {
  readme: {
    name: 'readme',
    purpose: 'Explain what a project, package, or directory is and how to use it.',
    useWhen: [
      'A directory needs a concise overview for humans and agents.',
      'A topic needs enough context to decide which deeper documents to read.',
    ],
    pathPattern: 'README.md',
    requiresName: false,
    requiresDescription: false,
    requiresReadme: false,
    requiresRoute: false,
    softLineLimit: 120,
    hardLineLimit: 200,
    sections: [
      { heading: '是什么', required: true },
      { heading: '为什么', required: true },
      { heading: '怎么用', required: true },
    ],
  },
  route: {
    name: 'route',
    purpose: 'Expose the document graph entries for a directory and its children.',
    useWhen: [
      'A directory becomes a documentation subject with its own README or docs directory.',
      'Agents need path-scoped document discovery below this directory.',
    ],
    pathPattern: '{instructionFile}',
    requiresName: false,
    requiresDescription: false,
    requiresReadme: false,
    requiresRoute: false,
    softLineLimit: 40,
    hardLineLimit: 120,
    sections: [{ heading: '文档图入口', required: true }],
  },
  runbook: {
    name: 'runbook',
    purpose: 'Record an ordered operational procedure.',
    useWhen: [
      'The content is a sequence of steps.',
      'Running steps in the wrong order can cause failure, misdiagnosis, or expensive recovery.',
    ],
    pathPattern: 'docs/{type}/{name}.md',
    requiresName: true,
    requiresDescription: true,
    requiresReadme: true,
    requiresRoute: true,
    softLineLimit: 200,
    hardLineLimit: 300,
    sections: [
      { heading: '适用场景', required: true },
      { heading: '前置条件', required: true },
      { heading: '步骤', required: true },
      { heading: '验证', required: true },
      { heading: '回滚或恢复', required: true },
      { heading: '入口', required: true },
    ],
  },
  architecture: {
    name: 'architecture',
    purpose: 'Explain implementation structure, boundaries, and data/control flow.',
    useWhen: [
      'Agents need to understand module structure before changing code.',
      'The document explains shape and boundaries rather than step-by-step operations.',
    ],
    pathPattern: 'docs/{type}/{name}.md',
    requiresName: true,
    requiresDescription: true,
    requiresReadme: true,
    requiresRoute: true,
    softLineLimit: 180,
    hardLineLimit: 250,
    sections: [
      { heading: '范围', required: true },
      { heading: '结构', required: true },
      { heading: '数据流或控制流', required: true },
      { heading: '边界与依赖', required: true },
      { heading: '入口', required: true },
    ],
  },
  constraints: {
    name: 'constraints',
    purpose: 'Record maintenance rules, boundaries, risks, and non-negotiable contracts.',
    useWhen: [
      'Violating the content would introduce bugs or break contracts.',
      'The document captures long-lived rules rather than temporary plans.',
    ],
    pathPattern: 'docs/{type}/{name}.md',
    requiresName: true,
    requiresDescription: true,
    requiresReadme: true,
    requiresRoute: true,
    softLineLimit: 120,
    hardLineLimit: 180,
    sections: [
      { heading: '必须遵守', required: true },
      { heading: '边界', required: true },
      { heading: '常见风险', required: true },
      { heading: '入口', required: true },
    ],
  },
};

export async function loadDocumentTypes(root: string): Promise<DocumentTypeDefinition[]> {
  const registryPath = getDocumentTypesPath(root);
  const legacyPath = join(getHarnessDirectory(root), 'document-types.json');
  const sourcePath = fileExists(registryPath) ? registryPath : legacyPath;
  if (!fileExists(sourcePath)) return getBuiltinDocumentTypes();

  const registry = JSON.parse(await readTextFile(sourcePath)) as {
    types?: DocumentTypeDefinition[];
  };
  if (!Array.isArray(registry.types)) return getBuiltinDocumentTypes();

  const byName = new Map(getBuiltinDocumentTypes().map((definition) => [definition.name, definition]));
  for (const definition of registry.types) {
    if (definition?.name) byName.set(definition.name, definition);
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function getDocumentType(
  root: string,
  typeName: string,
): Promise<DocumentTypeDefinition | undefined> {
  const normalizedType = typeName === 'agents' ? 'route' : typeName;
  return (await loadDocumentTypes(root)).find((definition) => definition.name === normalizedType);
}

export function getBuiltinDocumentTypes(): DocumentTypeDefinition[] {
  return Object.values(BUILTIN_DOCUMENT_TYPES).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function serializeBuiltinDocumentTypes(): string {
  return `${JSON.stringify({ types: getBuiltinDocumentTypes() }, null, 2)}\n`;
}
