export function isUseWhenDescription(description: string): boolean {
  const value = description.trim();
  if (!value) return false;
  return /^use when\b/i.test(value);
}

export function useWhenDescriptionHint(): string {
  return 'Rewrite description as an English use-when condition, for example: "Use when ...".';
}
