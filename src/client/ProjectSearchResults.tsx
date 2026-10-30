import { useId } from "react";
import type { Note } from "../domain/types.js";
import { HighlightText } from "./HighlightText.js";
import type { SearchQuery } from "./project-search.js";
import type { ProjectSearchResult } from "./project-search-results.js";

export function ProjectSearchResults({
  results,
  query,
  onOpen,
}: {
  results: ProjectSearchResult[];
  query: SearchQuery;
  onOpen: (chatId: string, note: Note) => void;
}) {
  const headingId = useId();
  const groups = new Map<string, ProjectSearchResult[]>();
  for (const result of results) {
    const group = groups.get(result.conversation.id) ?? [];
    group.push(result);
    groups.set(result.conversation.id, group);
  }
  return (
    <div className="project-search-results">
      {[...groups.values()].map((group, index) => {
        const conversation = group[0].conversation;
        const contextId = `${headingId}-${index}`;
        return (
          <section key={conversation.id} aria-labelledby={contextId}>
            <div
              id={contextId}
              className="message-date-separator project-search-result-context"
            >
              <span>{conversation.title}</span>
              {conversation.archivedAt != null && <span>Archived</span>}
            </div>
            {group.map(({ note, excerpt }) => (
              <article
                key={note.id}
                className="message-bubble project-search-result"
                data-note-id={note.id}
                data-chat-id={conversation.id}
              >
                {excerpt && (
                  <p className="note-body project-search-result-body">
                    <HighlightText text={excerpt} terms={query.terms} />
                  </p>
                )}
                {(note.attachments ?? []).map((file) => (
                  <p key={file.id} className="project-search-result-file">
                    <HighlightText text={file.filename} terms={query.terms} />
                  </p>
                ))}
                <footer className="project-search-result-footer">
                  <span>
                    <HighlightText
                      text={note.sender || "You"}
                      terms={query.terms}
                    />
                  </span>
                  <time
                    className="message-time"
                    dateTime={new Date(note.createdAt).toISOString()}
                  >
                    {new Date(note.createdAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                  <button
                    type="button"
                    className="message-history-button"
                    aria-label="Open message in history"
                    aria-describedby={contextId}
                    title={`Open in ${conversation.title}`}
                    onClick={() => onOpen(conversation.id, note)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="m9 10-5 5 5 5M4 15h10a6 6 0 0 0 0-12h-2" />
                    </svg>
                  </button>
                </footer>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
