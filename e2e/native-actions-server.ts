import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { resolveDataDirectory } from "../dist/server/server/data-directory.js";
import { startLocalServer } from "../dist/server/server/local-server.js";

const dataDirectory = resolveDataDirectory();
const receiptPath = join(dataDirectory, ".native-action-receipts.jsonl");

const nativeFileActions = {
  supported: true,
  platform: process.platform,
  async open(path: string): Promise<void> {
    record({ action: "open", path });
  },
  async reveal(path: string, containingDirectory: string): Promise<void> {
    record({ action: "reveal", path, containingDirectory });
  },
};

function record(receipt: {
  action: "open" | "reveal";
  path: string;
  containingDirectory?: string;
}): void {
  appendFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, {
    encoding: "utf8",
    flag: "a",
    mode: 0o600,
  });
}

await startLocalServer({ nativeFileActions });
