import {
  existsSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { describeRuntime } from "../runtime/build-info.js";
import { acquireInstanceOwner } from "../runtime/instance-owner.js";
import { recoverManagedRestoreBeforeDatabaseOpen } from "../database-transfer/restore-journal.js";
import { UpdateJournalStore } from "../runtime/update-journal.js";
import { parseArguments } from "./arguments.js";
import { runManagedWith, stopManagedWith } from "./lifecycle.js";
import { managedStatus, startManaged, stopManaged } from "./process.js";
import {
  privateDirectory,
  readInstallState,
  assertRegularFile,
  readActiveRelease,
} from "./state.js";
import { recoverManagedUpdate } from "./update.js";
import { defaultInstallRoot, openLocalBrowser } from "./platform.js";
import { installManaged } from "./install.js";
import { updateFromRelease } from "./distribution.js";

const HELP = `On Track — private project notes in your browser

  ontrack run [--no-open]         Start in the background and open the browser
  ontrack stop                    Gracefully stop the managed server
  ontrack status                  Show the server version and local address
  ontrack logs                    Show recent diagnostics
  ontrack update [vX.Y.Z] [--yes] Install a published release and restart
  ontrack --help                  Show this help

Manual source installations still use npm run quickstart and npm start.
Background operation survives terminal closure, not a reboot or logout.
`;
function printable(message: string): string {
  return message
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .slice(0, 64 * 1024);
}
async function confirmUpdate(): Promise<boolean> {
  if (!process.stdin.isTTY)
    throw new Error(
      "Noninteractive updates require --yes. Save any browser drafts before updating.",
    );
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return /^y(es)?$/i.test(
      (
        await prompt.question(
          "Save browser drafts first. Update and restart On Track? [y/N] ",
        )
      ).trim(),
    );
  } finally {
    prompt.close();
  }
}
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv);
  if (args.command === "help" || args.command === "--help") {
    console.log(HELP);
    return;
  }
  if (args.command === "--describe-runtime") {
    console.log(JSON.stringify(describeRuntime()));
    return;
  }
  const root = resolve(
    String(
      args.options.root ??
        process.env.ON_TRACK_INSTALL_ROOT ??
        defaultInstallRoot(),
    ),
  );
  if (args.command === "install") {
    await installManaged(root, args.options);
    return;
  }
  if (!existsSync(join(root, "install.json")))
    throw new Error(
      "On Track managed setup is not installed. Use an installation guide or npm run quickstart for manual setup.",
    );
  const canonicalRoot = realpathSync(root);
  const state = readInstallState(canonicalRoot);
  if (
    (process.env.ON_TRACK_DATA_DIR &&
      resolve(process.env.ON_TRACK_DATA_DIR) !== state.dataDirectory) ||
    (process.env.ON_TRACK_PORT &&
      Number(process.env.ON_TRACK_PORT) !== state.port)
  )
    throw new Error(
      "Managed commands use saved data and port settings. Remove conflicting ON_TRACK_DATA_DIR or ON_TRACK_PORT overrides.",
    );
  if (args.command === "maintenance-recover-import") {
    const owner = acquireInstanceOwner(state.dataDirectory);
    try {
      if (new UpdateJournalStore(state.dataDirectory).read())
        throw new Error(
          "Finish the pending software update before import recovery.",
        );
      recoverManagedRestoreBeforeDatabaseOpen({
        dataDirectory: state.dataDirectory,
        databasePath: join(state.dataDirectory, "on-track.sqlite"),
      });
    } finally {
      owner.release();
    }
    return;
  }
  if (args.command === "logs") {
    const files = ["server.log", "preparation.log"]
      .map((name) => join(canonicalRoot, "logs", name))
      .filter(existsSync);
    if (files.length === 0) {
      console.log("No server diagnostics yet.");
      return;
    }
    for (const file of files) {
      assertRegularFile(file);
      const fd = openSync(file, "r");
      try {
        const size = fstatSync(fd).size;
        const buffer = Buffer.alloc(Math.min(size, 64 * 1024));
        readSync(
          fd,
          buffer,
          0,
          buffer.length,
          Math.max(0, size - buffer.length),
        );
        console.log(printable(buffer.toString("utf8")));
      } finally {
        closeSync(fd);
      }
    }
    return;
  }
  if (args.command === "status" || args.command === "--version") {
    const status = await managedStatus(canonicalRoot);
    console.log(
      status
        ? `On Track ${status.version}: ${status.state}\n${status.url}`
        : `On Track ${readActiveRelease(canonicalRoot).releaseId.slice(1)} (managed): stopped. Run ontrack run to start it.`,
    );
    return;
  }
  const owner = acquireInstanceOwner(privateDirectory(canonicalRoot), {
    filename: ".on-track-install-owner.sqlite",
  });
  try {
    if (args.command === "update") {
      await updateFromRelease(canonicalRoot, args.version, {
        confirm: args.options.yes ? async () => true : confirmUpdate,
        progress: (message) => console.log(printable(message)),
      });
      const status = await managedStatus(canonicalRoot);
      console.log(
        `On Track updated.${status ? `\n${status.url}` : ""}\nRefresh existing browser tabs to load this version.`,
      );
      if (status && !args.options["no-open"]) {
        try {
          await openLocalBrowser(status.url);
        } catch {
          /* The local URL remains available. */
        }
      }
      return;
    }
    await recoverManagedUpdate(canonicalRoot);
    const adapter = {
      status: () => managedStatus(canonicalRoot),
      start: () => startManaged(canonicalRoot),
      stop: () => stopManaged(canonicalRoot),
      open: openLocalBrowser,
    };
    if (args.command === "stop") {
      console.log(
        (await stopManagedWith(adapter))
          ? "On Track stopped. Your projects remain saved."
          : "On Track is already stopped.",
      );
      return;
    }
    const status = await runManagedWith(adapter, !args.options["no-open"]);
    console.log(
      `On Track ${status.version} is running. You can close this terminal.\n${status.url}`,
    );
  } finally {
    owner.release();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      printable(
        error instanceof Error
          ? error.message
          : "On Track could not complete this command.",
      ),
    );
    process.exitCode = 1;
  });
}
