export function parseStars(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > 5) return null;
  return n;
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeEnglish(english: string, korean: string): string {
  const trimmed = english.trim();
  if (!trimmed) return korean;
  if (trimmed.toLowerCase() === "null") return korean;
  return trimmed;
}
