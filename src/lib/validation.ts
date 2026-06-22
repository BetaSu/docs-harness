import { loadDocumentTypes, type DocumentTypeDefinition } from './document-types.js';
import { type DocumentDocument, type DocumentEntry, type DocumentGraph } from './document-graph.js';
import { fileExists, resolvePath } from './files.js';
import { parseMetadata } from './markdown.js';

export type ValidationIssue = {
  code:
    | 'duplicate_name'
    | 'hard_line_limit_exceeded'
    | 'missing_description'
    | 'missing_metadata_description'
    | 'missing_metadata_name'
    | 'missing_name'
    | 'missing_required_section'
    | 'missing_sibling_route'
    | 'target_name_duplicate'
    | 'target_not_found'
    | 'unknown_document_type';
  hint: string;
  message: string;
  path: string;
  line?: number;
  name?: string;
  type?: string;
};

export async function validateDocumentGraph(
  root: string,
  graph: DocumentGraph,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  for (const [name, paths] of graph.duplicateNames.entries()) {
    issues.push({
      code: 'duplicate_name',
      path: paths[0] ?? '.',
      name,
      message: `Document name is duplicated: ${name}.`,
      hint: `Make document metadata names unique. Conflicting paths: ${paths.join(', ')}.`,
    });
  }

  for (const entry of graph.entries) {
    issues.push(...validateEntry(entry));
  }

  issues.push(...(await validateDocuments(root, graph)));
  return issues.sort(compareIssues);
}

function validateEntry(entry: DocumentEntry): ValidationIssue[] {
  return entry.errors.map((error) => {
    const base = {
      line: entry.line,
      name: entry.name || undefined,
      path: entry.source,
    };

    if (error === 'missing_name') {
      return {
        ...base,
        code: 'missing_name' as const,
        message: 'Agent-index entry is missing name.',
        hint: 'Add name="<stable-document-name>" to this agent-index entry.',
      };
    }

    if (error === 'missing_description') {
      return {
        ...base,
        code: 'missing_description' as const,
        message: 'Agent-index entry is missing description.',
        hint: 'Add description="<when an agent should read this document>" to this entry.',
      };
    }

    if (error === 'target_not_found') {
      return {
        ...base,
        code: 'target_not_found' as const,
        message: `Agent-index target was not found: ${entry.name || '<missing>'}.`,
        hint: 'Create the target document with docs-harness write --dry-run, or fix the entry name.',
      };
    }

    return {
      ...base,
      code: 'target_name_duplicate' as const,
      message: `Agent-index target name is duplicated: ${entry.name || '<missing>'}.`,
      hint: 'Make target document names unique, then rerun docs-harness validate.',
    };
  });
}

async function validateDocuments(root: string, graph: DocumentGraph): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const types = await loadDocumentTypes(root);
  const typeByName = new Map(types.map((type) => [type.name, type]));

  for (const document of graph.documents) {
    issues.push(...validateSiblingRoute(root, graph, document));

    const type = resolveDocumentType(document, graph.routeFileName, typeByName);
    if (!type) {
      if (isTypedDocsPath(document.path)) {
        issues.push({
          code: 'unknown_document_type',
          path: document.path,
          type: document.target.kind,
          message: `Document path uses unknown document type: ${document.target.kind}.`,
          hint: 'Add this type to .docs-harness/registry/document-types.json or move the document under a known docs/<type>/ path.',
        });
      }
      continue;
    }

    issues.push(...validateDocumentAgainstType(document, type));
  }

  return issues;
}

function validateSiblingRoute(
  root: string,
  graph: DocumentGraph,
  document: DocumentDocument,
): ValidationIssue[] {
  if (!document.path.endsWith('/README.md')) return [];

  const routePath = `${document.path.slice(0, -'README.md'.length)}${graph.routeFileName}`;
  if (fileExists(resolvePath(root, routePath))) return [];

  return [
    {
      code: 'missing_sibling_route',
      path: document.path,
      message: `README document is missing sibling route: ${routePath}.`,
      hint: `Create the sibling route with docs-harness write --type route --path ${document.path.slice(
        0,
        -'/README.md'.length,
      )} --dry-run, then retry with --yes after review.`,
    },
  ];
}

function resolveDocumentType(
  document: DocumentDocument,
  routeFileName: string,
  typeByName: Map<string, DocumentTypeDefinition>,
): DocumentTypeDefinition | undefined {
  if (document.path === routeFileName || document.path.endsWith(`/${routeFileName}`)) {
    return typeByName.get('route');
  }
  if (document.path === 'README.md' || document.path.endsWith('/README.md')) {
    return typeByName.get('readme');
  }
  return typeByName.get(document.target.kind);
}

function validateDocumentAgainstType(
  document: DocumentDocument,
  type: DocumentTypeDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const metadata = parseMetadata(document.content);
  const body = stripFrontmatter(document.content).trim();

  if (type.requiresName && !metadata.name) {
    issues.push({
      code: 'missing_metadata_name',
      path: document.path,
      type: type.name,
      message: `Document type ${type.name} requires metadata field: name.`,
      hint: 'Add frontmatter field `name`, or regenerate the document with docs-harness write --dry-run.',
    });
  }

  if (type.requiresDescription && !metadata.description) {
    issues.push({
      code: 'missing_metadata_description',
      path: document.path,
      type: type.name,
      message: `Document type ${type.name} requires metadata field: description.`,
      hint: 'Add frontmatter field `description`, or regenerate the document with docs-harness write --dry-run.',
    });
  }

  const lineCount = body ? body.split('\n').length : 0;
  if (lineCount > type.hardLineLimit) {
    issues.push({
      code: 'hard_line_limit_exceeded',
      path: document.path,
      type: type.name,
      message: `Document type ${type.name} hard line limit exceeded: ${lineCount}/${type.hardLineLimit}.`,
      hint: 'Shorten or split this document. For the repair workflow, run docs-harness skills read document-repair.',
    });
  }

  for (const section of type.sections.filter((candidate) => candidate.required)) {
    if (!hasHeading(body, section.heading)) {
      issues.push({
        code: 'missing_required_section',
        path: document.path,
        type: type.name,
        message: `Document type ${type.name} requires heading: ${section.heading}.`,
        hint: `Add a Markdown heading \`## ${section.heading}\`, or run docs-harness skills read document-repair for the repair workflow.`,
      });
    }
  }

  return issues;
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const endIndex = content.indexOf('\n---', 4);
  if (endIndex < 0) return content;
  return content.slice(endIndex + '\n---'.length).replace(/^\n/, '');
}

function hasHeading(body: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'm').test(body);
}

function isTypedDocsPath(path: string): boolean {
  return path.split('/').includes('docs') && !path.endsWith('/README.md');
}

function compareIssues(left: ValidationIssue, right: ValidationIssue): number {
  return (
    left.path.localeCompare(right.path) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.code.localeCompare(right.code)
  );
}
