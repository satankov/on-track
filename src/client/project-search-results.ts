import type { ChatDetail, Note } from "../domain/types.js";
import { analyzeMarkdown } from "./markdown-analysis.js";
import {
  buildSearchDocument,
  matchesSearch,
  type SearchQuery,
} from "./project-search.js";

export interface ProjectSearchResult {
  conversation: ChatDetail;
  note: Note;
  excerpt: string;
}

export function findProjectSearchResults(
  conversations: ChatDetail[],
  query: SearchQuery,
): ProjectSearchResult[] {
  if (!query.key || query.error) return [];
  return conversations.flatMap((conversation) =>
    conversation.notes.flatMap((note) => {
      const analysis = analyzeMarkdown(note.body);
      if (!matchesSearch(buildSearchDocument(note, analysis), query)) return [];
      const text = analysis.text.normalize("NFC");
      const lower = text.toLowerCase();
      const firstMatch = Math.min(
        ...query.terms
          .map((term) => lower.indexOf(term))
          .filter((index) => index >= 0),
      );
      const start = Number.isFinite(firstMatch)
        ? Math.max(0, firstMatch - 80)
        : 0;
      const end = Math.min(text.length, start + 360);
      return [
        {
          conversation,
          note,
          excerpt: `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`,
        },
      ];
    }),
  );
}
