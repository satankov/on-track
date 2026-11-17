import type { ExportOptions, ExportSource } from "./message-export-source.js";
import { exportBody } from "./message-export-markdown.js";

export type PartKind = "title" | "detail" | "day" | "byline" | "body";
export interface ExportDocument {
  text: string;
  filename: string;
  parts: { kind: PartKind; start: number; end: number }[];
}

function oneLine(value: string) {
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim();
}
function metadata(value: string, markdown: boolean) {
  const text = oneLine(value);
  return markdown ? text.replace(/[\\`*_{}[\]<>#!|~&]/g, "\\$&") : text;
}
function basename(titles: string[]) {
  const pieces = titles
    .map((title) =>
      title
        .normalize("NFC")
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, ""),
    )
    .filter(
      (piece) => piece && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(piece),
    );
  // Limit encoded bytes too: a Unicode filename can exceed the filesystem's
  // component limit well before it reaches 255 visible characters.
  const encoder = new TextEncoder();
  let name = "",
    size = 0;
  for (const char of pieces.join("_")) {
    size += encoder.encode(char).length;
    if (size > 160) break;
    name += char;
  }
  return name.replace(/[-_]+$/, "") || "messages";
}

function localClock(timeZone: string) {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const isoDay = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const zone = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    timeZoneName: "longOffset",
  });
  const offset = (at: number) =>
    zone
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")!
      .value.replace("GMT", "") || "+00:00";
  const minutes = (zone: string) =>
    (zone[0] === "-" ? -1 : 1) * (+zone.slice(1, 3) * 60 + +zone.slice(4, 6));
  return {
    day: (at: number) => day.format(at),
    iso: (at: number) => isoDay.format(at),
    time: (at: number) => {
      const time = clock.format(at),
        current = offset(at);
      for (const nearby of [at - 86400000, at + 86400000]) {
        const delta = minutes(current) - minutes(offset(nearby));
        if (
          delta &&
          clock.format(at + delta * 60000) === time &&
          day.format(at) === day.format(at + delta * 60000)
        )
          return time + " UTC" + current;
      }
      return time;
    },
  };
}

export function formatMessageExport(
  source: ExportSource,
  options: ExportOptions,
): ExportDocument {
  const { timeZone, format, includeLabels } = options;
  if (!source.messages.length) throw new Error("Select a message to export.");
  const md = format === "md";
  const dates = localClock(timeZone);
  const chunks: string[] = [];
  const parts: ExportDocument["parts"] = [];
  let position = 0;
  function add(kind: PartKind, value: string) {
    if (!value) return;
    if (chunks.length) {
      chunks.push("\n\n");
      position += 2;
    }
    chunks.push(value);
    parts.push({ kind, start: position, end: position + value.length });
    position += value.length;
  }
  add(
    "title",
    (md ? "# " : "") + source.titles.map((t) => metadata(t, md)).join(" / "),
  );
  const count = source.messages.length;
  add(
    "detail",
    count +
      " selected message" +
      (count === 1 ? "" : "s") +
      " · Times in " +
      timeZone,
  );
  let currentDay = "";
  source.messages.forEach((message, i) => {
    const day = dates.day(message.createdAt);
    if (day !== currentDay) {
      add("day", (md ? "## " : "") + day);
      currentDay = day;
    }
    const byline = [
      dates.time(message.createdAt),
      metadata(message.sender || "Notebook owner", md),
      ...(includeLabels
        ? message.labels.map((label) => metadata(label, md))
        : []),
    ].join(" · ");
    add("byline", md ? "**" + byline + "**" : byline);
    const body = exportBody(message.body, format, i + 1);
    add("body", body || (message.attachmentCount ? "" : "No visible text."));
    if (message.attachmentCount)
      add(
        "detail",
        message.attachmentCount +
          " attachment" +
          (message.attachmentCount === 1 ? "" : "s") +
          " omitted.",
      );
  });
  chunks.push("\n");
  return {
    text: chunks.join(""),
    parts,
    filename:
      basename(source.titles) +
      "_" +
      dates.iso(source.messages[0].createdAt) +
      "." +
      format,
  };
}
