import { formatMessageExport } from "./message-export.js";
import type { ExportOptions, ExportSource } from "./message-export-source.js";

self.onmessage = ({
  data,
}: MessageEvent<{ source: ExportSource; options: ExportOptions }>) => {
  self.postMessage(formatMessageExport(data.source, data.options));
};
