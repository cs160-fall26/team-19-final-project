import type { DesignReference } from "@/lib/types";

/**
 * Keyword search over the library, run in the browser on every keystroke.
 *
 * Every word of the query has to match the reference somewhere. A match in a
 * label counts most, then the title, then the description, the prompt and the
 * designer's note. A word
 * matches when it equals a word of the reference (plurals aside) or begins
 * one. A word that matches nothing anywhere in the library is treated as a
 * typo and compared loosely against the labels and titles instead.
 *
 * The parts of a deep analysis are searched by the same rules: anything with
 * labels, a title and some text can be (see part-search.ts).
 */

/** What the search reads of a thing. A reference has all of it. */
export type Searchable = Pick<
  DesignReference,
  "title" | "labels" | "semantic" | "prompt" | "addedAt" | "note"
>;

type Field = "label" | "title" | "text";
type Kind = "exact" | "prefix" | "typo";

const WEIGHTS: Record<Field, Partial<Record<Kind, number>>> = {
  label: { exact: 10, prefix: 7, typo: 4 },
  title: { exact: 6, prefix: 4, typo: 3 },
  text: { exact: 3, prefix: 2 },
};
const FIELDS: Field[] = ["label", "title", "text"];
/** Added when the whole query is one of the reference's labels. */
const WHOLE_LABEL_BONUS = 5;

export type TextMatch<T extends Searchable = DesignReference> = {
  ref: T;
  score: number;
  /** The reference's labels that the query matched, in label order. */
  labels: string[];
};

export type TextSearch<T extends Searchable = DesignReference> = {
  /** Best match first. */
  matches: TextMatch<T>[];
  /** Query words found nowhere, with the library words used in their place. */
  corrections: { typed: string; used: string[] }[];
};

export type LabelCount = { label: string; count: number };

/** Lower case, without accents. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
}

/** The words of a text: runs of letters and digits. */
export function wordsOf(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Folds English plurals so that "chairs" and "chair" are the same word. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && /[^su]s$/.test(word) && !word.endsWith("is")) {
    return word.slice(0, -1);
  }
  return word;
}

type Entry = {
  /** Whole labels, normalized, for matching a query that is a label. */
  labels: string[];
  /** Every word of each field, both as written and stemmed. */
  words: Record<Field, Set<string>>;
  /** The labels each label word came from. */
  labelsByWord: Map<string, string[]>;
};

// References are immutable once loaded, so each is indexed once.
const entries = new WeakMap<Searchable, Entry>();

function addWords(target: Set<string>, text: string): string[] {
  const added: string[] = [];
  for (const word of wordsOf(text)) {
    for (const form of [word, stem(word)]) {
      target.add(form);
      added.push(form);
    }
  }
  return added;
}

function entryFor(ref: Searchable): Entry {
  let entry = entries.get(ref);
  if (entry) return entry;

  entry = {
    labels: ref.labels.map((label) => wordsOf(label).join(" ")),
    words: { label: new Set(), title: new Set(), text: new Set() },
    labelsByWord: new Map(),
  };
  for (const label of ref.labels) {
    const forms = addWords(entry.words.label, label);
    // "mid-century" should also answer "midcentury".
    const joined = wordsOf(label).join("");
    if (forms.length > 2) {
      entry.words.label.add(joined);
      forms.push(joined);
    }
    for (const form of forms) {
      const owners = entry.labelsByWord.get(form) ?? [];
      if (!owners.includes(label)) owners.push(label);
      entry.labelsByWord.set(form, owners);
    }
  }
  addWords(entry.words.title, ref.title);
  addWords(entry.words.text, ref.semantic);
  addWords(entry.words.text, ref.prompt);
  if (ref.note) addWords(entry.words.text, ref.note);
  entries.set(ref, entry);
  return entry;
}

/** The words of `field` that the query word matches, with how it matched. */
function hits(
  words: Set<string>,
  word: string,
): { kind: "exact" | "prefix"; words: string[] } | null {
  const stemmed = stem(word);
  const exact = [word, stemmed].filter((form) => words.has(form));
  if (exact.length > 0) return { kind: "exact", words: exact };
  // One letter begins far too many words to mean anything.
  if (word.length < 2) return null;
  const begun = [...words].filter((candidate) => candidate.startsWith(word));
  return begun.length > 0 ? { kind: "prefix", words: begun } : null;
}

/** Edits allowed before two words stop counting as the same word mistyped. */
function allowedEdits(word: string) {
  if (word.length < 4) return 0;
  return word.length < 8 ? 1 : 2;
}

/** Edit distance where swapping two neighbouring letters is one edit. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let twoBack: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }
      current.push(value);
      rowBest = Math.min(rowBest, value);
    }
    if (rowBest > limit) return limit + 1;
    twoBack = previous;
    previous = current;
  }
  return previous[b.length];
}

/** Label and title words within typo distance of a word found nowhere. */
function corrections(word: string, all: Entry[]): string[] {
  const limit = allowedEdits(word);
  if (limit === 0) return [];
  const found = new Map<string, number>();
  for (const entry of all) {
    for (const field of ["label", "title"] as const) {
      for (const candidate of entry.words[field]) {
        if (found.has(candidate)) continue;
        const distance = editDistance(word, candidate, limit);
        if (distance <= limit) found.set(candidate, distance);
      }
    }
  }
  if (found.size === 0) return [];
  // Only the closest spellings: one edit away beats two.
  const nearest = Math.min(...found.values());
  return [...found].filter(([, d]) => d === nearest).map(([w]) => w);
}

export function searchReferences<T extends Searchable>(
  references: T[],
  query: string,
): TextSearch<T> {
  const queryWords = [...new Set(wordsOf(query))];
  if (queryWords.length === 0) return { matches: [], corrections: [] };

  const all = references.map(entryFor);
  // A word is a typo candidate only if no reference has it in any field.
  const typos = new Map<string, Set<string>>();
  for (const word of queryWords) {
    const known = all.some((entry) =>
      FIELDS.some((field) => hits(entry.words[field], word)),
    );
    if (!known) typos.set(word, new Set(corrections(word, all)));
  }

  const wholeQuery = queryWords.join(" ");
  const matches: TextMatch<T>[] = [];
  references.forEach((ref, index) => {
    const entry = all[index];
    const matchedLabels = new Set<string>();
    let score = 0;

    for (const word of queryWords) {
      let best = 0;
      const substitutes = typos.get(word);
      for (const field of FIELDS) {
        let kind: Kind | undefined;
        let matchedWords: string[] = [];
        if (substitutes) {
          matchedWords = [...substitutes].filter((s) => entry.words[field].has(s));
          if (matchedWords.length > 0) kind = "typo";
        } else {
          const hit = hits(entry.words[field], word);
          if (hit) {
            kind = hit.kind;
            matchedWords = hit.words;
          }
        }
        const weight = kind ? (WEIGHTS[field][kind] ?? 0) : 0;
        if (weight === 0) continue;
        best = Math.max(best, weight);
        if (field === "label") {
          for (const matched of matchedWords) {
            for (const label of entry.labelsByWord.get(matched) ?? []) {
              matchedLabels.add(label);
            }
          }
        }
      }
      if (best === 0) return; // every word has to match
      score += best;
    }

    if (entry.labels.includes(wholeQuery)) score += WHOLE_LABEL_BONUS;
    matches.push({
      ref,
      score,
      labels: ref.labels.filter((label) => matchedLabels.has(label)),
    });
  });

  matches.sort(
    (a, b) => b.score - a.score || b.ref.addedAt.localeCompare(a.ref.addedAt),
  );
  return {
    matches,
    corrections: [...typos]
      .filter(([, used]) => used.size > 0)
      .map(([typed, used]) => ({ typed, used: [...used].sort() })),
  };
}

/** The word still being typed: empty once the query ends in a space. */
function unfinishedWord(query: string): string {
  return /[\p{L}\p{N}]$/u.test(query) ? (wordsOf(query).at(-1) ?? "") : "";
}

/**
 * Labels to offer under the search box: the library's most used labels, or,
 * while a word is being typed, the labels that word could become.
 */
export function suggestLabels(
  references: Searchable[],
  query: string,
  limit = 10,
): LabelCount[] {
  const counts = new Map<string, number>();
  for (const ref of references) {
    for (const label of new Set(ref.labels)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  const typing = unfinishedWord(query);
  const typed = new Set(wordsOf(query));

  let candidates = [...counts.keys()];
  if (typing) {
    const begins = (label: string) =>
      wordsOf(label).some((word) => word.startsWith(typing));
    candidates = candidates.filter(begins);
    if (candidates.length === 0) {
      const all = references.map(entryFor);
      const substitutes = new Set(corrections(typing, all));
      candidates = [...counts.keys()].filter((label) =>
        wordsOf(label).some(
          (word) => substitutes.has(word) || substitutes.has(stem(word)),
        ),
      );
    }
  } else {
    // Between words: do not offer what the query already says.
    candidates = candidates.filter(
      (label) => !wordsOf(label).every((word) => typed.has(word)),
    );
  }

  return candidates
    .map((label) => ({ label, count: counts.get(label) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** The query with the word being typed completed to `label`. */
export function completeWith(query: string, label: string): string {
  const head = unfinishedWord(query)
    ? query.replace(/[\p{L}\p{N}]+$/u, "")
    : query;
  const kept = head.trim().split(/\s+/).filter(Boolean);
  // "art dec" completed to "art deco" should not become "art art deco".
  const labelWords = wordsOf(label);
  for (let n = Math.min(kept.length, labelWords.length - 1); n > 0; n -= 1) {
    if (wordsOf(kept.slice(-n).join(" ")).join(" ") === labelWords.slice(0, n).join(" ")) {
      kept.splice(-n);
      break;
    }
  }
  return [...kept, label].join(" ");
}
