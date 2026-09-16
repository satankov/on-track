import type { ExampleDetail, ExampleSummary } from "../../domain/examples.js";
import {
  CONFIGURABLE_LABELS,
  createNoteInputSchema,
  labelSchema,
} from "../../domain/validation.js";

const day = Date.UTC(2026, 5, 1, 12);
const id = "example:weekend-trip";
const packing =
  "Weekend packing list\n\nTickets\nWater bottle\nComfortable shoes\nRain jacket\n";
const story: ExampleDetail = {
  kind: "example",
  slug: "weekend-trip",
  revision: 1,
  id,
  title: "Weekend trip",
  description: "A simple plan, a decision, and a packing list.",
  accent: "ocean",
  enabledLabels: [...CONFIGURABLE_LABELS],
  collapseLongMessages: true,
  notes: [
    {
      id: `${id}:intro`,
      chatId: id,
      sender: null,
      createdAt: day,
      labels: ["pin"],
      body: "## A weekend away\nThis fictional notebook shows how a small trip can come together in On Track. Read it, try the filters, or create an editable copy to make it your own.",
    },
    {
      id: `${id}:plan`,
      chatId: id,
      sender: null,
      createdAt: day + 3600000,
      labels: ["todo", "open-question"],
      body: "Two days by the coast. Keep it simple.\n\n- [x] Pick a destination\n- [ ] Book the train\n- [ ] Choose somewhere to stay\n\n**Question:** leave Friday evening or Saturday morning?",
    },
    {
      id: `${id}:reply`,
      chatId: id,
      sender: "Alex",
      createdAt: day + 7200000,
      labels: [],
      body: "> Saturday morning works for me. Let's stay near the station.\n\nA remark I saved from our conversation; this is a private notebook, not a live group chat.",
    },
    {
      id: `${id}:decision`,
      chatId: id,
      sender: null,
      createdAt: day + 86400000,
      labels: ["decision", "milestone"],
      body: "**Decided:** Saturday morning, back Sunday evening.\n\n| Item | Budget |\n| --- | ---: |\n| Train | 60 |\n| Room | 100 |\n| Food | 40 |\n\nCheck the [weather forecast](https://www.weather.gov/) before packing.",
    },
    {
      id: `${id}:packing`,
      chatId: id,
      sender: null,
      createdAt: day + 90000000,
      labels: ["risk", "attention"],
      body: "Rain is possible. Pack a jacket and keep an indoor backup plan. The attached list is ready to open and change after making a copy.",
      attachments: [
        {
          id: `${id}:file`,
          noteId: `${id}:packing`,
          filename: "packing-list.txt",
          mediaType: "text/plain",
          byteSize: Buffer.byteLength(packing),
          createdAt: day + 90000000,
          modifiedAt: day + 90000000,
          status: "available",
          actions: { open: "unavailable", reveal: "unavailable" },
        },
      ],
    },
    {
      id: `${id}:try`,
      chatId: id,
      sender: null,
      createdAt: day + 172800000,
      labels: ["todo"],
      body: "### Try it in your copy\nAdd a note, change a label, or open the packing list. Schedule a note for tomorrow to see the future-message divider.\n\nUse Edit to change the project, then try pinning or archiving it. Settings contains appearance and backup options. Your copy stays yours when this example is updated.",
    },
  ],
};

// Fail a build/test early if authored content violates the ordinary write contract.
for (const note of story.notes) {
  createNoteInputSchema.parse({
    body: note.body,
    sender: note.sender,
    createdAt: note.createdAt,
  });
  for (const label of note.labels) labelSchema.parse(label);
}

export function listExamples(): ExampleSummary[] {
  const { kind, slug, revision, title, description, accent } = story;
  return [{ kind, slug, revision, title, description, accent }];
}
export function getExample(slug: string): ExampleDetail | undefined {
  return slug === story.slug ? structuredClone(story) : undefined;
}
export function exampleFileContent(attachmentId: string): Buffer {
  if (attachmentId !== `${id}:file`) throw new Error("Unknown example file.");
  return Buffer.from(packing, "utf8");
}
