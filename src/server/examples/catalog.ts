import type { ExampleDetail, ExampleSummary } from "../../domain/examples.js";
import { createNoteInputSchema, labelSchema } from "../../domain/validation.js";

// Preserve the catalog identity so existing selections survive story revisions.
const id = "example:weekend-trip";
const day = Date.UTC(2026, 8, 10, 9);
const hour = 3600000;
const files = new Map([
  [
    `${id}:file`,
    `AMSTERDAM — PACKING LIST

[x] Comfortable walking shoes
[ ] Rain jacket
[ ] Warm layers and gloves
[ ] Phone charger
[ ] Power bank
[ ] Refillable water bottle
[ ] Travel documents
[ ] Saved booking details

Before leaving:
[ ] Check the forecast
[ ] Water the plants
`,
  ],
  [
    `${id}:booking-file`,
    `AMSTERDAM — BOOKING NOTES
Fictional sample. Not a ticket or confirmation.

Travellers: You and Maya
Trip: 16–18 December 2026
Stay: Canal House Example (invented)
Reference: DEMO-AMS-042
Status: Reserved in the sample itinerary

Still to check:
- Arrival instructions
- Bag storage
- Return journey details
`,
  ],
  [
    `${id}:wishlist-file`,
    `MAYA'S AMSTERDAM WISHLIST

One museum visit without rushing.
A long breakfast.
A canal walk with no destination.
A bookshop if we pass one.
Time to sit down and do absolutely nothing.
`,
  ],
]);

function attachment(
  key: string,
  noteKey: string,
  filename: string,
  createdAt: number,
) {
  return {
    id: `${id}:${key}`,
    noteId: `${id}:${noteKey}`,
    filename,
    mediaType: "text/plain",
    byteSize: exampleFileContent(`${id}:${key}`).byteLength,
    createdAt,
    modifiedAt: createdAt,
    status: "available" as const,
    actions: { open: "unavailable" as const, reveal: "unavailable" as const },
  };
}

/**
 * Release-maintained feature coverage (natural story; no reader exercises):
 * intro/budget: Pin, headings, emphasis, GFM table, project accent/title.
 * plan/weather: Todo, Risk, Attention, multiple labels, Markdown checklist.
 * reply/reply-breakfast/wishlist: named sender, grouping, attachment-only note.
 * research: blockquote, Markdown links and Links filter.
 * packing/wishlist: multiple text attachments, Files filter, inline code;
 * packing's prose describes editing the same managed file in its usual editor.
 * itinerary: long-message expansion/collapse (default enabled), ordered lists.
 * departure-check/travel-day/return-trip: future divider and dated plans.
 * All messages: chronology/day separators, text copy, label filters.
 * Native file actions and mutations still require the standard editable copy.
 * Deliberately omitted: Decision, Open question, Milestone; onboarding exercises,
 * settings/backups/archive explanations. These are not demonstrated by this story.
 * Dates are fixed relative to the 2026-09-16 authoring date: departure +3 months,
 * repeat-trip note +3 years. Review dates with future releases; never slide saved
 * user copies or silently move story timestamps on each catalog read.
 */
const story: ExampleDetail = {
  kind: "example",
  slug: "weekend-trip",
  revision: 3,
  id,
  title: "🇳🇱 Trip to Amsterdam",
  description: "Canals, art, long breakfasts, and a winter escape with Maya.",
  accent: "ocean",
  enabledLabels: ["todo", "risk"],
  collapseLongMessages: true,
  notes: [
    {
      id: `${id}:intro`,
      chatId: id,
      sender: null,
      createdAt: day,
      labels: ["pin"],
      body: "## Amsterdam, at our own pace\n**16–18 December 2026 · You + Maya**\n\nThree days of canals, art, good coffee, and enough room to get pleasantly lost.\n\nOne rule: *one main plan each day*. Everything else is optional.",
    },
    {
      id: `${id}:plan`,
      chatId: id,
      sender: null,
      createdAt: day + hour,
      labels: ["todo"],
      body: "**Before we go**\n\n- [x] Choose Amsterdam\n- [x] Agree on three days\n- [x] Reserve somewhere quiet\n- [ ] Choose a museum time\n- [ ] Save the arrival instructions\n- [ ] Leave one afternoon unplanned\n\nThree months should be plenty of time to arrange a weekend without turning it into a second job.",
    },
    {
      id: `${id}:reply`,
      chatId: id,
      sender: "Maya",
      createdAt: day + 3 * hour,
      labels: [],
      body: "I vote for somewhere quiet. Happy to walk a little farther if it means we can get a good night's sleep.\n\nMy only must-do is the Rijksmuseum. Everything else can be a happy accident.",
    },
    {
      id: `${id}:reply-breakfast`,
      chatId: id,
      sender: "Maya",
      createdAt: day + 3 * hour + 120000,
      labels: [],
      body: "And please leave time for a very long breakfast. This is the important part.",
    },
    {
      id: `${id}:research`,
      chatId: id,
      sender: null,
      createdAt: day + 33 * hour,
      labels: [],
      body: "Saving Maya's brief from our conversation:\n\n> Leave time for a very long breakfast.\n\nQuiet base, one museum, plenty of wandering. The [Amsterdam city guide](https://www.iamsterdam.com/en) is a good starting point; check the [Rijksmuseum website](https://www.rijksmuseum.nl/en) before choosing tickets.\n\nNo second museum unless we both feel like it.",
    },
    {
      id: `${id}:budget`,
      chatId: id,
      sender: null,
      createdAt: day + 33 * hour + 900000,
      labels: ["pin"],
      body: "### Budget for two\n\n| Category | Set aside |\n| --- | ---: |\n| Stay | €360 |\n| Travel | €180 |\n| Food and coffee | €180 |\n| Museums and local transport | €100 |\n| Spare | €80 |\n| **Total** | **€900** |\n\nWorking estimates, not quotes. Keep the spare money spare—we don't need to fill every hour or spend every euro.",
    },
    {
      id: `${id}:packing`,
      chatId: id,
      sender: null,
      createdAt: day + 58 * hour,
      labels: ["todo"],
      body: "The practical bits are in `packing-list.txt` and `booking-notes.txt`.\n\nFor any changes, **edit this file, don't create a copy**. Open the attachment from this chat in the usual editor and save it in place, so the same file stays with our plan. No more packing-list-final-final.\n\nWarm layers are already on the list. The power bank is still somewhere in the drawer.",
      attachments: [
        attachment("file", "packing", "packing-list.txt", day + 58 * hour),
        attachment(
          "booking-file",
          "packing",
          "booking-notes.txt",
          day + 58 * hour,
        ),
      ],
    },
    {
      id: `${id}:wishlist`,
      chatId: id,
      sender: "Maya",
      createdAt: day + 58 * hour + 120000,
      labels: [],
      body: "",
      attachments: [
        attachment(
          "wishlist-file",
          "wishlist",
          "maya-wishlist.txt",
          day + 58 * hour + 120000,
        ),
      ],
    },
    {
      id: `${id}:weather`,
      chatId: id,
      sender: null,
      createdAt: day + 95 * hour,
      labels: ["attention", "risk"],
      body: "**Keep the outdoor plans flexible.**\n\nA December canal walk sounds lovely; a whole afternoon outside in cold rain sounds less lovely. Keep a café or bookshop as the fallback.\n\nCheck the forecast close to departure. If we swap the days around, the trip still works.",
    },
    {
      id: `${id}:itinerary`,
      chatId: id,
      sender: null,
      createdAt: day + 129 * hour,
      labels: [],
      body: "## Three days, with breathing room\n\n### Wednesday, 16 December — arrive\n\n1. Arrive and drop our bags.\n2. Find something warm to eat.\n3. Take a short canal walk if we have the energy.\n\nNo ambitious first-night itinerary. Getting there is enough. Save the arrival instructions before leaving home so we're not hunting through messages at the door.\n\n### Thursday, 17 December — art\n\n1. Have the long breakfast.\n2. Visit the Rijksmuseum at our chosen booking time.\n3. Leave the afternoon free.\n\nChoose any extra stop over lunch. A bookshop, a café, or a nap are all perfectly acceptable outcomes. Keep the evening open rather than booking something just because there is a gap.\n\n### Friday, 18 December — one last wander\n\n1. Pack before breakfast.\n2. Check our return journey and bag arrangements.\n3. Take a final walk if there is time.\n\nLeave a comfortable margin for getting home. The last coffee should be a pleasure, not something we drink while running.\n\n### If plans change\n\nRain: move the walk. Tired feet: sit down. Something closed: choose something else.\n\n**Success means coming home glad we went—not completing every item.**",
    },
    {
      id: `${id}:departure-check`,
      chatId: id,
      sender: null,
      createdAt: Date.UTC(2026, 11, 14, 18),
      labels: ["todo", "attention"],
      body: "**Two days to go — final checks**\n\n- [ ] Check the weather and adjust the packing list\n- [ ] Confirm arrival instructions and museum time\n- [ ] Save travel details for offline use\n- [ ] Charge the power bank\n- [ ] Water the plants\n\nEverything important should fit in one bag. Leave room for a book on the way home.",
    },
    {
      id: `${id}:travel-day`,
      chatId: id,
      sender: null,
      createdAt: Date.UTC(2026, 11, 16, 7),
      labels: ["todo"],
      body: "**Amsterdam today.**\n\nOne last check: travel documents, phone, charger, keys, and the return journey. Message Maya before leaving.\n\nThe rest can wait until after breakfast.",
    },
    {
      id: `${id}:return-trip`,
      chatId: id,
      sender: null,
      createdAt: Date.UTC(2029, 8, 16, 9),
      labels: [],
      body: "**Amsterdam again?**\n\nAsk Maya whether she'd like to repeat this trip. Same rule: one main plan a day, plenty of wandering, and a very long breakfast.\n\nMaybe spring this time. Keep the old packing list, revisit the budget, and leave room for a different favourite place.",
    },
  ],
};

// Validate the ordinary write contract, including attachment-only messages.
for (const note of story.notes) {
  const input = {
    body: note.body,
    sender: note.sender,
    createdAt: note.createdAt,
  };
  if (note.body === "" && note.attachments?.length) {
    createNoteInputSchema.omit({ body: true }).parse(input);
  } else {
    createNoteInputSchema.parse(input);
  }
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
  const content = files.get(attachmentId);
  if (content === undefined) throw new Error("Unknown example file.");
  return Buffer.from(content, "utf8");
}
