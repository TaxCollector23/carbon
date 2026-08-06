/**
 * Extract a JSON object from a model's text response. Models frequently wrap
 * JSON in ```json fences or prefix it with prose; a raw JSON.parse would fail
 * on those. This is best-effort — the caller should still Zod-validate the
 * parsed result.
 */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text.trim();
}
