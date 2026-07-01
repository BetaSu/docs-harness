import { fileExists, readTextFile } from './files.js';
import { getDocumentTypesPath } from './project.js';

export type DocumentTypeName = string;

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

export type DocumentTypePathMatch = {
  type: DocumentTypeDefinition;
  modulePath: string;
};

const BUILTIN_DOCUMENT_TYPES: Record<string, DocumentTypeDefinition> = {
  readme: {
    name: 'readme',
    purpose: 'Explain what a complete functional entity is and how to use it.',
    useWhen: [
      'A complete functional entity needs a concise overview for humans and agents.',
      'A complete functional entity needs enough context to decide which deeper documents to read.',
    ],
    pathPattern: 'README.md',
    requiresName: true,
    requiresDescription: true,
    requiresReadme: false,
    requiresRoute: false,
    softLineLimit: 120,
    hardLineLimit: 200,
    sections: [
      { heading: 'What It Is', required: true },
      { heading: 'Why It Exists', required: true },
      { heading: 'How To Use It', required: true },
    ],
  },
  route: {
    name: 'route',
    purpose: 'Expose the document graph entries for a complete functional entity and its children.',
    useWhen: [
      'A complete functional entity needs its own README or docs directory.',
      'Agents need path-scoped document discovery below this complete functional entity.',
    ],
    pathPattern: '{instructionFile}',
    requiresName: false,
    requiresDescription: false,
    requiresReadme: false,
    requiresRoute: false,
    softLineLimit: 40,
    hardLineLimit: 120,
    sections: [{ heading: 'Document Graph Entries', required: true }],
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
      { heading: 'When To Use', required: true },
      { heading: 'Preconditions', required: true },
      { heading: 'Steps', required: true },
      { heading: 'Verification', required: true },
      { heading: 'Rollback Or Recovery', required: true },
      { heading: 'Entry Points', required: true },
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
      { heading: 'Scope', required: true },
      { heading: 'Structure', required: true },
      { heading: 'Data Or Control Flow', required: true },
      { heading: 'Boundaries And Dependencies', required: true },
      { heading: 'Entry Points', required: true },
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
      { heading: 'Must Follow', required: true },
      { heading: 'Boundaries', required: true },
      { heading: 'Common Risks', required: true },
      { heading: 'Entry Points', required: true },
    ],
  },
};

export async function loadDocumentTypes(root: string): Promise<DocumentTypeDefinition[]> {
  const registryPath = getDocumentTypesPath(root);
  if (!fileExists(registryPath)) return getBuiltinDocumentTypes();

  const registry = JSON.parse(await readTextFile(registryPath)) as {
    types?: DocumentTypeDefinition[];
  };
  if (!Array.isArray(registry.types)) return getBuiltinDocumentTypes();

  return registry.types
    .filter((definition) => definition?.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getDocumentType(
  root: string,
  typeName: string,
): Promise<DocumentTypeDefinition | undefined> {
  return (await loadDocumentTypes(root)).find((definition) => definition.name === typeName);
}

export function getBuiltinDocumentTypes(): DocumentTypeDefinition[] {
  return Object.values(BUILTIN_DOCUMENT_TYPES).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function serializeBuiltinDocumentTypes(): string {
  return `${JSON.stringify({ types: getBuiltinDocumentTypes() }, null, 2)}\n`;
}

export function resolveDocumentTypePath(
  path: string,
  documentTypes: DocumentTypeDefinition[],
  instructionFileName: string,
): DocumentTypePathMatch | undefined {
  const normalizedPath = normalizePatternPath(path);
  const candidates = [...documentTypes].sort(comparePatternSpecificity);

  for (const type of candidates) {
    const pattern = buildDocumentTypePathRegex(type, instructionFileName);
    const match = pattern.exec(normalizedPath);
    if (!match) continue;

    return {
      type,
      modulePath: match.groups?.module || '.',
    };
  }

  return undefined;
}

function buildDocumentTypePathRegex(
  type: DocumentTypeDefinition,
  instructionFileName: string,
): RegExp {
  const pattern = normalizePatternPath(type.pathPattern);
  let regex = '';
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern.startsWith('{instructionFile}', index)) {
      regex += escapeRegex(instructionFileName);
      index += '{instructionFile}'.length - 1;
      continue;
    }
    if (pattern.startsWith('{type}', index)) {
      regex += escapeRegex(type.name);
      index += '{type}'.length - 1;
      continue;
    }
    if (pattern[index] === '{') {
      const endIndex = pattern.indexOf('}', index + 1);
      if (endIndex >= 0) {
        regex += '[^/]+';
        index = endIndex;
        continue;
      }
    }
    regex += escapeRegex(pattern[index]);
  }

  return new RegExp(`^(?:(?<module>.+)/)?${regex}$`);
}

function comparePatternSpecificity(
  left: DocumentTypeDefinition,
  right: DocumentTypeDefinition,
): number {
  return (
    concretePatternLength(right) - concretePatternLength(left) ||
    right.pathPattern.length - left.pathPattern.length ||
    left.name.localeCompare(right.name)
  );
}

function concretePatternLength(type: DocumentTypeDefinition): number {
  return type.pathPattern
    .replaceAll('{instructionFile}', '')
    .replaceAll('{type}', type.name)
    .replace(/\{[^}]+}/g, '').length;
}

function normalizePatternPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
