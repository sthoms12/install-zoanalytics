export type KeywordSource = {
  value: string | null | undefined;
  weight: number;
};

const STOPWORDS = new Set([
  "a", "about", "across", "after", "all", "also", "an", "and", "any", "are", "as", "at", "be", "because", "been", "before", "but", "by", "can", "do", "for", "from", "get", "have", "how", "in", "into", "is", "it", "its", "more", "not", "of", "on", "or", "our", "that", "the", "their", "this", "to", "use", "was", "we", "were", "what", "when", "where", "which", "with", "you", "your",
]);

const GENERIC = new Set([
  "app", "better", "click", "create", "home", "learn", "links", "model", "page", "pages", "prior", "read", "site", "source", "tool", "tools", "view",
]);

function tokens(value: string) {
  return value.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g) ?? [];
}

function usefulToken(value: string) {
  return value.length >= 3 && !STOPWORDS.has(value) && !GENERIC.has(value) && !/^\d+$/.test(value);
}

export function isUsefulKeyword(value: string) {
  const parts = tokens(value);
  if (!parts.length || parts.length > 5) return false;
  if (!usefulToken(parts[0]!) || !usefulToken(parts.at(-1)!)) return false;
  return parts.some(usefulToken);
}

export function inferKeywordCandidates(sources: KeywordSource[]) {
  const scores = new Map<string, number>();
  const singleScores = new Map<string, number>();

  for (const source of sources) {
    const words = tokens(source.value ?? "");
    for (const word of new Set(words)) {
      if (usefulToken(word)) singleScores.set(word, (singleScores.get(word) ?? 0) + source.weight);
    }
    for (const size of [3, 2]) {
      const sourcePhrases = new Set<string>();
      for (let index = 0; index <= words.length - size; index += 1) {
        const phraseParts = words.slice(index, index + size);
        if (!usefulToken(phraseParts[0]) || !usefulToken(phraseParts.at(-1)!)) continue;
        if (phraseParts.filter(usefulToken).length < 2) continue;
        sourcePhrases.add(phraseParts.join(" "));
      }
      for (const phrase of sourcePhrases) {
        const specificity = size === 3 ? 1.25 : 1;
        scores.set(phrase, (scores.get(phrase) ?? 0) + source.weight * specificity);
      }
    }
  }

  const phrases = [...scores.entries()]
    .filter(([keyword]) => isUsefulKeyword(keyword))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const selected = phrases.length ? phrases : [...singleScores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return selected.slice(0, 12).map(([keyword, weight]) => ({ keyword, weight: Math.round(weight * 10) / 10, source: "page-copy" }));
}
