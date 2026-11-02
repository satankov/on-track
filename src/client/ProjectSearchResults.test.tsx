// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ChatDetail } from "../domain/types.js";
import { ProjectSearchResults } from "./ProjectSearchResults.js";
import { findProjectSearchResults } from "./project-search-results.js";
import { parseSearchQuery } from "./project-search.js";

const conversation = (id: string, title: string, body: string): ChatDetail => ({
  id,
  title,
  accent: "ocean",
  enabledLabels: ["todo"],
  collapseLongMessages: true,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  pinnedAt: null,
  latestAttentionAt: null,
  nextAttentionAt: null,
  notes: [
    {
      id: `${id}-note`,
      chatId: id,
      body,
      sender: null,
      createdAt: 1,
      labels: [],
    },
  ],
});

it("finds messages across the supplied project including archived conversations", () => {
  const main = conversation(
    "main",
    "Website redesign",
    "**Entry plan** due Friday",
  );
  const child = conversation(
    "pricing",
    "Pricing experiment",
    "Entry plan test",
  );
  const archived = {
    ...conversation("feedback", "Feedback", "entry PLAN accepted"),
    archivedAt: 2,
  };
  const other = conversation("navigation", "Navigation", "Menu review");
  const results = findProjectSearchResults(
    [main, child, archived, other],
    parseSearchQuery("ENTRY plan"),
  );
  expect(
    results.map(({ conversation: owner, note }) => [owner.id, note.id]),
  ).toEqual([
    ["main", "main-note"],
    ["pricing", "pricing-note"],
    ["feedback", "feedback-note"],
  ]);
  expect(results[0].excerpt).toBe("Entry plan due Friday");
  expect(
    findProjectSearchResults([main], parseSearchQuery("x".repeat(257))),
  ).toEqual([]);
  expect(findProjectSearchResults([main], parseSearchQuery("  "))).toEqual([]);
});

it("matches filenames and people with the existing literal search rules", () => {
  const chat = conversation("pricing", "Pricing experiment", "**Accepted**");
  chat.notes[0].sender = "Maya";
  chat.notes[0].attachments = [
    {
      id: "file",
      noteId: "pricing-note",
      filename: "entry-plan.pdf",
      mediaType: "application/pdf",
      byteSize: 10,
      modifiedAt: 1,
      createdAt: 1,
      status: "missing",
    },
  ];
  expect(
    findProjectSearchResults([chat], parseSearchQuery("maya entry-plan.pdf")),
  ).toHaveLength(1);
  expect(
    findProjectSearchResults([chat], parseSearchQuery("mayaentry")),
  ).toEqual([]);
});

it("identifies archived owners and opens the exact result without offering mutation actions", () => {
  const chat = {
    ...conversation("feedback", "Client feedback", "Entry plan accepted"),
    archivedAt: 2,
  };
  const open = vi.fn();
  const query = parseSearchQuery("entry");
  render(
    <ProjectSearchResults
      results={findProjectSearchResults([chat], query)}
      query={query}
      onOpen={open}
    />,
  );
  expect(screen.getByText("Client feedback")).toBeVisible();
  expect(screen.getByText("Archived")).toBeVisible();
  expect(screen.getByText("Entry").tagName).toBe("MARK");
  const result = screen.getByRole("article");
  expect(within(result).getAllByRole("button")).toHaveLength(1);
  fireEvent.click(
    within(result).getByRole("button", { name: "Open message in history" }),
  );
  expect(open).toHaveBeenCalledWith("feedback", chat.notes[0]);
});

it("keeps a late matching term visible in a bounded plain-text excerpt", () => {
  const chat = conversation(
    "long",
    "Long topic",
    `${"Background ".repeat(100)}needle ${"tail ".repeat(100)}`,
  );
  const result = findProjectSearchResults(
    [chat],
    parseSearchQuery("needle"),
  )[0];
  expect(result.excerpt).toContain("needle");
  expect(result.excerpt.length).toBeLessThanOrEqual(364);
  expect(result.excerpt.startsWith("…")).toBe(true);
});
