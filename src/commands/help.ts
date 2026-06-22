export function commandHelp(): { commands: Array<{ command: string; description: string }> } {
  return {
    commands: [
      { command: 'schema', description: 'List machine-readable command contracts.' },
      { command: 'schema --command <command-id>', description: 'Describe one command contract.' },
      { command: 'init --agent <agent>', description: 'Create .docs-harness config, registry defaults, and the root route file.' },
      { command: 'insight [path]', description: 'List document entries relevant to a path.' },
      { command: 'show <name>', description: 'Read a document by stable name.' },
      { command: 'validate', description: 'Validate document graph links.' },
      { command: 'graph', description: 'Return document graph nodes and edges.' },
      { command: 'types list', description: 'List document type contracts.' },
      { command: 'types describe <type>', description: 'Describe when and how to write a type.' },
      { command: 'write --type <type> ...', description: 'Preview or write a document from a type contract.' },
      { command: 'skills list', description: 'List built-in agent skills.' },
      { command: 'skills read core', description: 'Read core operating rules.' },
    ],
  };
}
