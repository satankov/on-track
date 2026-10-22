import type { Note } from "../domain/types.js";
import { analyzeMarkdown } from "./markdown-analysis.js";

export interface SearchQuery {
  terms: string[];
  key: string;
  error?: string;
}

function normalize(value: string): string {
  return value.normalize("NFC").toLowerCase().normalize("NFC");
}

export function parseSearchQuery(value: string): SearchQuery {
  if (value.length > 256)
    return { terms: [], key: "invalid", error: "Use 256 characters or fewer." };
  const terms = [
    ...new Set(normalize(value).split(/\s+/u).filter(Boolean)),
  ].sort();
  return { terms, key: terms.length ? JSON.stringify(terms) : "" };
}

export function buildSearchDocument(
  note: Note,
  analysis = analyzeMarkdown(note.body),
) {
  return {
    hasLinks: analysis.hasLinks,
    fields: [
      analysis.text,
      note.sender || "You",
      ...(note.attachments ?? []).map((file) => file.filename),
    ].map(normalize),
  };
}

export function matchesSearch(
  document: ReturnType<typeof buildSearchDocument>,
  query: SearchQuery,
): boolean {
  return (
    !query.error &&
    query.terms.every((term) =>
      document.fields.some((field) => field.includes(term)),
    )
  );
}

/** One workspace owns this disposable cache; edits refresh bodies and remove old IDs. */
export function createSearchDocumentBuilder() {
  const cache = new Map<
    string,
    { body: string; analysis: ReturnType<typeof analyzeMarkdown> }
  >();
  return (notes: Note[]) => {
    const ids = new Set(notes.map((note) => note.id));
    for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
    return new Map(
      notes.map((note) => {
        let entry = cache.get(note.id);
        if (!entry || entry.body !== note.body) {
          entry = { body: note.body, analysis: analyzeMarkdown(note.body) };
          cache.set(note.id, entry);
        }
        return [note.id, buildSearchDocument(note, entry.analysis)];
      }),
    );
  };
}
