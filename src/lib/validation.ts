import {
  loadDocumentTypes,
  type DocumentTypeDefinition,
} from './document-types.js';
import { type DocumentDocument, type DocumentEntry, type DocumentGraph } from './document-graph.js';

export type ValidationIssue = {
  code:
    | 'description_mismatch'
    | 'duplicate_name'
    | 'hard_line_limit_exceeded'
    | 'ignored_target_referenced'
    | 'missing_description'
    | 'missing_metadata_description'
    | 'missing_name'
    | 'route_cycle'
    | 'target_name_duplicate'
    | 'target_not_found'
    | 'unreachable_route';
  hint: string;
  message: string;
  path: string;
  line?: number;
  name?: string;
  type?: string;
};

const DOCUMENT_REPAIR_HINT = 'For repair workflow, run `docs-harness skills read document-repair`.';

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
      hint: repairHint(`Make document metadata names unique. Conflicting paths: ${paths.map((path) => `\`${path}\``).join(', ')}.`),
    });
  }

  for (const entry of graph.entries) {
    issues.push(...validateEntry(entry));
  }

  issues.push(...(await validateDocuments(root, graph)));
  issues.push(...validateRouteReachability(graph));
  issues.push(...validateRouteCycles(graph));
  return issues.sort(compareIssues);
}

function validateEntry(entry: DocumentEntry): ValidationIssue[] {
  const base = {
    line: entry.line,
    name: entry.name || undefined,
    path: entry.source,
  };
  const issues: ValidationIssue[] = entry.errors.map((error) => {
    if (error === 'missing_name') {
      return {
        ...base,
        code: 'missing_name' as const,
        message: 'Agent-index entry is missing name.',
        hint: repairHint('Add `name="<stable-document-name>"` to this `agent-index` entry.'),
      };
    }

    if (error === 'missing_description') {
      return {
        ...base,
        code: 'missing_description' as const,
        message: 'Agent-index entry is missing description.',
        hint: repairHint('Add `description="<when an agent should read this document>"` to this entry.'),
      };
    }

    if (error === 'target_not_found') {
      return {
        ...base,
        code: 'target_not_found' as const,
        message: `Agent-index target was not found: ${entry.name || '<missing>'}.`,
        hint: repairHint('Create the target document with `docs-harness write --dry-run`, or fix the entry name.'),
      };
    }

    if (error === 'ignored_target_referenced') {
      return {
        ...base,
        code: 'ignored_target_referenced' as const,
        message: `Agent-index target is excluded by docs-harness ignore config: ${entry.name || '<missing>'}.`,
        hint: repairHint(
          entry.ignoredTarget
            ? `Remove or narrow the \`ignore\` rule for \`${entry.ignoredTarget.path}\`, or remove this route entry.`
            : 'Remove or narrow the `ignore` rule for this target, or remove this route entry.',
        ),
      };
    }

    return {
      ...base,
      code: 'target_name_duplicate' as const,
      message: `Agent-index target name is duplicated: ${entry.name || '<missing>'}.`,
      hint: repairHint('Make target document names unique, then rerun `docs-harness validate`.'),
    };
  });

  if (entry.target && entry.description) {
    if (!entry.target.description) {
      issues.push({
        code: 'missing_metadata_description',
        path: entry.target.path,
        name: entry.target.name,
        type: entry.target.kind,
        message: `Indexed document is missing metadata field: description.`,
        hint: repairHint('Add frontmatter field `description` that matches the route entry.'),
      });
    } else if (entry.description !== entry.target.description) {
      issues.push({
        ...base,
        code: 'description_mismatch',
        message: `Agent-index description does not match target metadata for: ${entry.name}.`,
        hint: repairHint('Update the route entry description or regenerate it with `docs-harness write --dry-run`.'),
      });
    }
  }

  return issues;
}

async function validateDocuments(root: string, graph: DocumentGraph): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const types = await loadDocumentTypes(root);
  const typeByName = new Map(types.map((type) => [type.name, type]));

  for (const document of graph.documents) {
    if (!document.isTarget) continue;

    const type = typeByName.get(document.target.kind);
    if (!type) continue;

    issues.push(...validateDocumentLineLimit(document, type));
  }

  return issues;
}

function validateRouteReachability(graph: DocumentGraph): ValidationIssue[] {
  return graph.targets
    .filter(
      (target) =>
        target.kind === 'route' &&
        target.path !== graph.routeFileName &&
        !graph.reachableRoutePaths.has(target.path),
    )
    .map((target) => ({
      code: 'unreachable_route' as const,
      path: target.path,
      name: target.name,
      type: target.kind,
      message: `Route document is not reachable from root ${graph.routeFileName}: ${target.path}.`,
      hint: repairHint(`Add an \`agent-index\` entry from \`${graph.routeFileName}\` or another reachable route to \`${target.name}\`, or remove the stale route.`),
    }));
}

function validateRouteCycles(graph: DocumentGraph): ValidationIssue[] {
  return graph.routeCycles.map((cycle) => ({
    code: 'route_cycle' as const,
    path: cycle.paths[0] ?? graph.routeFileName,
    message: `Route cycle detected: ${cycle.paths.join(' -> ')}.`,
    hint: repairHint('Remove or redirect one route-to-route entry so route discovery cannot return to an already visited route.'),
  }));
}

function validateDocumentLineLimit(
  document: DocumentDocument,
  type: DocumentTypeDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const body = stripFrontmatter(document.content).trim();

  const lineCount = body ? body.split('\n').length : 0;
  if (lineCount > type.hardLineLimit) {
    issues.push({
      code: 'hard_line_limit_exceeded',
      path: document.path,
      type: type.name,
      message: `Document type ${type.name} hard line limit exceeded: ${lineCount}/${type.hardLineLimit}.`,
      hint: repairHint('Shorten or split this document.'),
    });
  }

  return issues;
}

function repairHint(hint: string): string {
  return `${hint} ${DOCUMENT_REPAIR_HINT}`;
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const endIndex = content.indexOf('\n---', 4);
  if (endIndex < 0) return content;
  return content.slice(endIndex + '\n---'.length).replace(/^\n/, '');
}

function compareIssues(left: ValidationIssue, right: ValidationIssue): number {
  return (
    left.path.localeCompare(right.path) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.code.localeCompare(right.code)
  );
}
