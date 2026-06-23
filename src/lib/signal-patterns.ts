import { createHash } from 'node:crypto';

export type FrictionPattern =
  | 'empty_route'
  | 'non_target_document'
  | 'parent_route_bypasses_module_route'
  | 'readme_unindexed'
  | 'route_fallback'
  | 'route_duplicates_module_entry'
  | 'route_missing_readme_entry'
  | 'route_without_readme'
  | 'read_unindexed_target'
  | 'read_unreachable_target';

export type SignalTarget = {
  kind: 'document' | 'entry' | 'module' | 'route';
  path?: string;
  name?: string;
  line?: number;
};

export type Signal = {
  version: string;
  id: string;
  createdAt: string;
  handled: boolean;
  frictionPattern: FrictionPattern;
  target: SignalTarget;
  impact: string;
  suggestion: string;
};

const SIGNAL_PATTERNS: Record<
  FrictionPattern,
  {
    impact: string;
    suggestion: string;
  }
> = {
  empty_route: {
    impact: 'This route cannot help agents discover any document.',
    suggestion: 'Add the relevant document entries, or remove the route if this path is not a complete functional entity that should expose documentation.',
  },
  non_target_document: {
    impact: 'This document file is scanned but is not part of the stable document graph, so agents cannot discover or read it by stable name.',
    suggestion: 'Inspect the content. If it should support agent work, consolidate it into the right complete functional entity by creating or updating the entity README, route, and typed docs only as needed; after the content is split into suitable targets, delete the original loose document when it is no longer needed. If it should stay outside the graph, mark this signal handled.',
  },
  parent_route_bypasses_module_route: {
    impact: 'A route links directly to a complete functional entity README even though that entity has its own route, so agents may bypass the fuller entry list.',
    suggestion: 'Review whether the upstream route should point to the entity route instead; if the entity is simple, consider removing the entity route.',
  },
  readme_unindexed: {
    impact: 'This README is a stable document target but is not discoverable from any reachable route entry.',
    suggestion: 'If this README belongs to a complete functional entity and should be agent-discoverable, add it to the appropriate route or create an entity route when the entity needs more documents. If it is intentionally outside discovery, mark this signal handled.',
  },
  route_fallback: {
    impact: 'Agents asking for this path receive an ancestor route, so path-specific documentation may be missed.',
    suggestion: 'If this path is a complete functional entity, create only the README and route structure it needs; otherwise leave it covered by the nearest complete functional entity route.',
  },
  route_duplicates_module_entry: {
    impact: 'The same route exposes both a complete functional entity route and that entity README, creating competing discovery entries for one entity.',
    suggestion: 'Choose the entity route as the entry when the complete functional entity needs multiple documents; otherwise keep the README entry and remove the child route.',
  },
  route_missing_readme_entry: {
    impact: 'This route has a sibling README but does not list it, so agents may miss the complete functional entity overview before reading deeper documents.',
    suggestion: 'Add the sibling README as a route entry so agents can discover the complete functional entity overview.',
  },
  route_without_readme: {
    impact: 'This route has no sibling README, so agents lack complete functional entity context before choosing deeper documents.',
    suggestion: 'If this route represents a complete functional entity, add a README with a use-when description; otherwise move its entries to the nearest complete functional entity and remove the route.',
  },
  read_unindexed_target: {
    impact: 'The document can be read by known name but cannot be discovered from route entries.',
    suggestion: 'Decide which route should expose this document, then add an agent-index entry there if it should be discoverable.',
  },
  read_unreachable_target: {
    impact: 'The document can be read directly but is not reachable through the root route graph.',
    suggestion: 'Review the route chain and add or adjust route-to-route entries if this document should be discoverable from the root.',
  },
};

export function buildSignal(input: {
  version: string;
  createdAt: string;
  frictionPattern: FrictionPattern;
  target: SignalTarget;
}): Signal {
  const pattern = SIGNAL_PATTERNS[input.frictionPattern];
  return {
    version: input.version,
    id: buildSignalId(input.frictionPattern, input.target),
    createdAt: input.createdAt,
    handled: false,
    frictionPattern: input.frictionPattern,
    target: normalizeTarget(input.target),
    impact: pattern.impact,
    suggestion: pattern.suggestion,
  };
}

function buildSignalId(frictionPattern: FrictionPattern, target: SignalTarget): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({ frictionPattern, target: normalizeTarget(target) }))
    .digest('hex')
    .slice(0, 16);
  return `sig_${hash}`;
}

function normalizeTarget(target: SignalTarget): SignalTarget {
  return {
    kind: target.kind,
    ...(target.path ? { path: target.path } : {}),
    ...(target.name ? { name: target.name } : {}),
    ...(typeof target.line === 'number' ? { line: target.line } : {}),
  };
}
