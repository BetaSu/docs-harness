export type MarkdownMetadata = Record<string, string>;

export function parseMetadata(content: string): MarkdownMetadata {
  if (!content.startsWith('---\n')) return {};

  const endIndex = content.indexOf('\n---', 4);
  if (endIndex < 0) return {};

  const body = content.slice(4, endIndex);
  const metadata: MarkdownMetadata = {};
  for (const line of body.split('\n')) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    metadata[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return metadata;
}
