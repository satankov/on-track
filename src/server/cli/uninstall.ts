import { randomUUID } from "node:crypto";
import { rmSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { acquireInstanceOwner } from "../runtime/instance-owner.js";
import { stopManaged } from "./process.js";
import { readJsonFile, writeJsonFile } from "./state.js";
import {
  assertRemovalIdentity,
  assertUninstallIdle,
  readUninstallState,
  planUninstall,
  retainedPaths,
  safeDirectory,
  statIfPresent,
  UNINSTALL_MARKER,
  type Removal,
} from "./uninstall-plan.js";
import { removeProfileBlocks } from "./uninstall-profile.js";
import { scheduleWindowsCleanup } from "./uninstall-windows.js";

function remove(item: Removal): void {
  if (assertRemovalIdentity(item))
    rmSync(item.path, {
      recursive: item.directory,
      maxRetries: 3,
      retryDelay: 100,
    });
}
export async function uninstallManaged(
  root: string,
  options: {
    deleteData?: boolean;
    confirm: (summary: string) => Promise<boolean>;
    progress?: (message: string) => void;
    home?: string;
  },
): Promise<void> {
  const resume = statIfPresent(join(root, UNINSTALL_MARKER))
    ? readUninstallState(root)
    : undefined;
  if (resume?.phase === "runtime-pending")
    throw new Error(
      `Windows cleanup pending. Inspect ${resume.receipt} and use its adjacent cleanup.ps1/job.json to retry if needed.`,
    );
  if (resume && resume.deleteData !== Boolean(options.deleteData))
    throw new Error(
      "Retry uninstall with the same --delete-data choice as the original command.",
    );
  const initial =
    resume?.plan ?? planUninstall(root, Boolean(options.deleteData));
  const progress = options.progress ?? (() => {});
  const summary = `Remove threadstr managed app, private Node/npm and dependencies from:\n${initial.root}\n${options.deleteData ? "DELETE projects, messages and managed attachments in:" : "Keep projects, messages and attachments in:"}\n${initial.data}\n${options.deleteData ? "Export a backup in Settings before continuing. Deletion cannot be undone.\n" : ""}Unrecognized files and external backups are retained.`;
  progress(summary);
  if (!(await options.confirm(summary))) {
    progress("Uninstall cancelled. Nothing changed.");
    return;
  }
  const installOwner = acquireInstanceOwner(root, {
    filename: ".on-track-install-owner.sqlite",
  });
  let dataOwner: ReturnType<typeof acquireInstanceOwner> | undefined;
  let complete = false,
    scheduled = false;
  try {
    if (resume) {
      if (readUninstallState(root).token !== resume.token)
        throw new Error("Uninstall changed; review again.");
    } else {
      assertUninstallIdle(root);
      const beforeStop = planUninstall(root, Boolean(options.deleteData));
      if (
        beforeStop.data !== initial.data ||
        JSON.stringify(beforeStop.app) !== JSON.stringify(initial.app)
      )
        throw new Error("Installation changed; review uninstall again.");
    }
    if (statIfPresent(join(root, "install.json"))) await stopManaged(root);
    dataOwner = acquireInstanceOwner(initial.data);
    // Refresh WAL/log inventory after graceful shutdown; confirmation still binds
    // to the same canonical installation and data roots.
    const lockedResume = resume ? readUninstallState(root) : undefined;
    if (lockedResume && lockedResume.token !== resume?.token)
      throw new Error("Uninstall changed; review again.");
    const plan =
      lockedResume?.plan ?? planUninstall(root, Boolean(options.deleteData));
    const token = lockedResume?.token ?? randomUUID();
    const marker = join(root, UNINSTALL_MARKER);
    const state = {
      protocol: 1,
      token,
      phase: "deleting",
      deleteData: Boolean(options.deleteData),
      plan,
    };
    if (Buffer.byteLength(JSON.stringify(state)) > 250 * 1024)
      throw new Error("Uninstall inventory is too large; no files removed.");
    writeJsonFile(marker, state);
    for (const item of [...plan.dataFiles, ...plan.checkpoints]) remove(item);
    if (process.platform === "win32") {
      const shim = readJsonFile(join(root, "shim-runtime.json")) as {
        runtimeExecutable: string;
      };
      const receipt = await scheduleWindowsCleanup(
        plan,
        token,
        shim.runtimeExecutable,
      );
      writeJsonFile(marker, { ...state, phase: "runtime-pending", receipt });
      scheduled = true;
      progress(
        `Uninstall cleanup is pending launcher exit. Completion or failure will be written to:\n${receipt}\nKeep this path until cleanup is confirmed.`,
      );
    } else {
      const profiles = removeProfileBlocks(
        options.home ?? homedir(),
        join(root, "bin"),
      );
      for (const profile of profiles)
        progress(
          `Profile retained; remove its threadstr PATH entry manually if present: ${profile}`,
        );
      for (const item of plan.app) remove(item);
      // Keep ownership inodes stable: even closing an unlinked SQLite handle
      // can remove a replacement owner's journal by its original pathname.
      rmSync(marker);
      complete = true;
    }
  } catch (error) {
    progress(
      `Uninstall incomplete. Retained installation: ${root}. ${options.deleteData ? "Some selected data may already have been removed. " : "Projects are retained. "}Retry using the same uninstall options; if the launcher was removed, use node dist/server/server/cli/main.js from a built source checkout with --root and this runtime path. Do not delete unknown files. Inspect ${join(root, UNINSTALL_MARKER)} if present before retrying.`,
    );
    throw error;
  } finally {
    dataOwner?.release();
    installOwner.release();
  }
  if (scheduled) {
    progress(
      "Small ownership lock files are retained to avoid racing another local process; they contain no project content.",
    );
    return;
  }
  if (complete) {
    for (const path of initial.directories) {
      if (!statIfPresent(path)) continue;
      safeDirectory(path);
      try {
        rmdirSync(path);
      } catch (error) {
        if (
          !["ENOTEMPTY", "EEXIST"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    }
    progress(
      `threadstr uninstalled. ${options.deleteData ? "Selected project data removed." : "Your projects remain saved."}\nSmall ownership lock files remain for safe coordination; they contain no project content.\nRetained files:\n${retainedPaths(initial).join("\n") || "None"}\nOpen a new terminal to refresh PATH.`,
    );
  }
}
