import {
  existsSync,
  mkdirSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  writeInstallState,
  selectActiveRelease,
  writeJsonFile,
} from "./state.js";
import { dispatcherSource, launcherSource } from "./launchers.js";
import { updateProfile } from "./platform.js";
import { uninstallManaged } from "./uninstall.js";
import { stopManaged } from "./process.js";
import { acquireInstanceOwner } from "../runtime/instance-owner.js";
import {
  planUninstall,
  readUninstallState,
  UNINSTALL_MARKER,
} from "./uninstall-plan.js";
import { randomUUID } from "node:crypto";
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, rmSync: vi.fn(actual.rmSync) };
});
vi.mock("./process.js", () => ({
  stopManaged: vi.fn().mockResolvedValue(undefined),
}));
const roots: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "threadstr-uninstall-")));
  roots.push(top);
  const root = join(top, "runtime"),
    data = join(top, "data"),
    home = join(top, "home");
  for (const dir of [root, data, home, join(root, "bin")]) mkdirSync(dir);
  const selection = {
    protocol: 1 as const,
    releaseId: "v0.0.9",
    runtimeId: `node-v24.16.0-${process.platform === "win32" ? "win" : process.platform}-${process.arch}`,
  };
  const release = join(root, "releases", selection.releaseId),
    runtime = join(root, "runtimes", selection.runtimeId);
  mkdirSync(release, { recursive: true });
  mkdirSync(join(runtime, "bin"), { recursive: true });
  writeFileSync(join(release, "package.json"), "{}");
  const nodeRelative = process.platform === "win32" ? "node.exe" : "bin/node";
  writeFileSync(join(runtime, nodeRelative), "private node");
  writeInstallState(root, { protocol: 1, dataDirectory: data, port: 4173 });
  selectActiveRelease(root, selection);
  const interpreter = join(runtime, nodeRelative),
    dispatcher = join(root, "bin/command.mjs");
  writeJsonFile(join(root, "shim-runtime.json"), {
    protocol: 1,
    runtimeExecutable: interpreter,
  });
  writeFileSync(dispatcher, dispatcherSource(root));
  for (const name of ["thr", "ontrack"])
    writeFileSync(
      join(root, "bin", process.platform === "win32" ? name + ".cmd" : name),
      launcherSource(interpreter, dispatcher),
    );
  writeFileSync(join(data, "on-track.sqlite"), "private projects");
  mkdirSync(join(data, "attachments/v1"), { recursive: true });
  writeFileSync(join(data, "attachments/v1", "file.txt"), "attachment");
  writeFileSync(
    join(home, ".zshrc"),
    updateProfile("# keep me\n", join(root, "bin")),
  );
  return { root, data, home, top, release, runtime };
}
it("cancels before stopping or changing files", async () => {
  const f = fixture();
  const before = readFileSync(join(f.home, ".zshrc"), "utf8");
  await uninstallManaged(f.root, {
    home: f.home,
    confirm: async (summary) => {
      expect(summary).toContain(f.data);
      return false;
    },
  });
  expect(stopManaged).not.toHaveBeenCalled();
  expect(existsSync(join(f.root, "install.json"))).toBe(true);
  expect(readFileSync(join(f.home, ".zshrc"), "utf8")).toBe(before);
  expect(existsSync(join(f.root, ".on-track-install-owner.sqlite"))).toBe(
    false,
  );
});
it.skipIf(process.platform === "win32")(
  "removes owned app files and PATH block while preserving data and unknown root files",
  async () => {
    const f = fixture();
    writeFileSync(join(f.root, "keep.txt"), "mine");
    await uninstallManaged(f.root, { home: f.home, confirm: async () => true });
    expect(stopManaged).toHaveBeenCalledWith(f.root);
    expect(existsSync(f.release)).toBe(false);
    expect(existsSync(f.runtime)).toBe(false);
    expect(existsSync(join(f.root, "bin/thr"))).toBe(false);
    expect(readFileSync(join(f.root, "keep.txt"), "utf8")).toBe("mine");
    expect(readFileSync(join(f.data, "on-track.sqlite"), "utf8")).toBe(
      "private projects",
    );
    expect(readFileSync(join(f.home, ".zshrc"), "utf8")).toBe("# keep me\n");
  },
);
it.skipIf(process.platform === "win32")(
  "purges only the explicit data namespace and preserves external exports",
  async () => {
    const f = fixture();
    writeFileSync(join(f.data, "export.on-track-backup"), "backup");
    await uninstallManaged(f.root, {
      home: f.home,
      deleteData: true,
      confirm: async (summary) => {
        expect(summary).toContain("DELETE");
        return true;
      },
    });
    expect(existsSync(join(f.data, "on-track.sqlite"))).toBe(false);
    expect(existsSync(join(f.data, "attachments/v1"))).toBe(false);
    expect(readFileSync(join(f.data, "export.on-track-backup"), "utf8")).toBe(
      "backup",
    );
  },
);
it.skipIf(process.platform === "win32")(
  "resumes interrupted removal from its bounded original inventory",
  async () => {
    const f = fixture();
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    let fail = true;
    vi.mocked(rmSync).mockImplementation((path, options) => {
      if (path === f.runtime && fail) {
        fail = false;
        throw new Error("fixture interruption");
      }
      actual.rmSync(path, options);
    });
    await expect(
      uninstallManaged(f.root, {
        home: f.home,
        deleteData: true,
        confirm: async () => true,
      }),
    ).rejects.toThrow("fixture interruption");
    expect(existsSync(f.release)).toBe(false);
    expect(readUninstallState(f.root).deleteData).toBe(true);
    await expect(
      uninstallManaged(f.root, { home: f.home, confirm: async () => true }),
    ).rejects.toThrow(/same --delete-data/);
    await uninstallManaged(f.root, {
      home: f.home,
      deleteData: true,
      confirm: async () => true,
    });
    expect(existsSync(join(f.root, "install.json"))).toBe(false);
    expect(existsSync(join(f.data, "on-track.sqlite"))).toBe(false);
    vi.mocked(rmSync).mockImplementation(actual.rmSync);
  },
);
it("refuses changes made while confirmation is open", async () => {
  const f = fixture();
  const other = join(f.top, "other");
  mkdirSync(other);
  await expect(
    uninstallManaged(f.root, {
      confirm: async () => {
        writeInstallState(f.root, {
          protocol: 1,
          dataDirectory: other,
          port: 4173,
        });
        return true;
      },
    }),
  ).rejects.toThrow(/changed/);
  expect(stopManaged).not.toHaveBeenCalled();
  expect(existsSync(f.release)).toBe(true);
});
it("rejects a forged retry target outside the managed artifact allowlist", () => {
  const f = fixture();
  const plan = planUninstall(f.root, false);
  plan.app[0].path = join(f.top, "private.txt");
  writeJsonFile(join(f.root, UNINSTALL_MARKER), {
    protocol: 1,
    token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    phase: "deleting",
    deleteData: false,
    plan,
  });
  expect(() => readUninstallState(f.root)).toThrow(/inventory/);
});
it("refuses pending recovery on an interrupted uninstall retry", () => {
  const f = fixture();
  const plan = planUninstall(f.root, true);
  writeJsonFile(join(f.root, UNINSTALL_MARKER), {
    protocol: 1,
    token: randomUUID(),
    phase: "deleting",
    deleteData: true,
    plan,
  });
  writeFileSync(join(f.data, ".on-track-restore-journal.json"), "{}");
  expect(() => readUninstallState(f.root)).toThrow(/pending/);
});
it("rechecks pending recovery after shutdown and data ownership on retry", async () => {
  const f = fixture();
  const plan = planUninstall(f.root, true);
  writeJsonFile(join(f.root, UNINSTALL_MARKER), {
    protocol: 1,
    token: randomUUID(),
    phase: "deleting",
    deleteData: true,
    plan,
  });
  vi.mocked(stopManaged).mockImplementationOnce(async () => {
    writeFileSync(join(f.data, ".on-track-restore-journal.json"), "{}");
  });
  await expect(
    uninstallManaged(f.root, {
      home: f.home,
      deleteData: true,
      confirm: async () => true,
    }),
  ).rejects.toThrow(/pending/);
  expect(existsSync(join(f.data, "on-track.sqlite"))).toBe(true);
  expect(existsSync(f.release)).toBe(true);
});
it("rejects lookalike filenames inside a retry inventory", () => {
  const f = fixture();
  const plan = planUninstall(f.root, false);
  const target = plan.app.find((item) => item.path.endsWith("install.json"))!;
  target.path = join(f.root, "installXjson");
  writeJsonFile(join(f.root, UNINSTALL_MARKER), {
    protocol: 1,
    token: randomUUID(),
    phase: "deleting",
    deleteData: false,
    plan,
  });
  expect(() => readUninstallState(f.root)).toThrow(/inventory/);
});
it.skipIf(process.platform === "win32")(
  "retains unmarked stages and never follows links inside owned trees",
  async () => {
    const f = fixture();
    const external = join(f.top, "external");
    mkdirSync(external);
    writeFileSync(join(external, "keep"), "safe");
    symlinkSync(external, join(f.release, "node_modules"), "junction");
    mkdirSync(join(f.root, "staging/prepare-unknown"), { recursive: true });
    writeFileSync(
      join(f.root, "staging/prepare-unknown/archive.zip"),
      "unknown",
    );
    const progress = vi.fn();
    await uninstallManaged(f.root, {
      home: f.home,
      confirm: async () => true,
      progress,
    });
    expect(readFileSync(join(external, "keep"), "utf8")).toBe("safe");
    expect(
      existsSync(join(f.root, "staging/prepare-unknown/archive.zip")),
    ).toBe(true);
    expect(progress.mock.calls.flat().join(" ")).toContain(
      join(f.root, "staging"),
    );
  },
);
it("refuses pending recovery, modified launchers and linked roots before stopping", async () => {
  const f = fixture();
  writeFileSync(join(f.data, ".on-track-restore-journal.json"), "{}");
  await expect(
    uninstallManaged(f.root, { confirm: async () => true }),
  ).rejects.toThrow(/pending/i);
  rmSync(join(f.data, ".on-track-restore-journal.json"));
  writeFileSync(
    join(f.root, "bin", process.platform === "win32" ? "thr.cmd" : "thr"),
    "unrelated",
  );
  await expect(
    uninstallManaged(f.root, { confirm: async () => true }),
  ).rejects.toThrow(/launcher/i);
  const link = join(f.top, "link");
  symlinkSync(f.root, link, "junction");
  await expect(
    uninstallManaged(link, { confirm: async () => true }),
  ).rejects.toThrow(/unsafe/i);
  expect(stopManaged).not.toHaveBeenCalled();
});
it("refuses another data owner without deleting any data", async () => {
  const f = fixture();
  const lock = acquireInstanceOwner(f.data);
  try {
    await expect(
      uninstallManaged(f.root, {
        home: f.home,
        deleteData: true,
        confirm: async () => true,
      }),
    ).rejects.toThrow(/already in use/);
    expect(existsSync(f.release)).toBe(true);
  } finally {
    lock.release();
  }
});
it.skipIf(process.platform === "win32")(
  "keeps ownership inodes stable throughout purge and later acquisition",
  async () => {
    const f = fixture();
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    let inode: number | undefined;
    vi.mocked(rmSync).mockImplementation((path, options) => {
      if (path === join(f.data, "on-track.sqlite")) {
        inode = lstatSync(join(f.data, ".on-track-owner.sqlite")).ino;
        expect(() => acquireInstanceOwner(f.data)).toThrow(/already in use/);
      }
      actual.rmSync(path, options);
    });
    try {
      await uninstallManaged(f.root, {
        home: f.home,
        deleteData: true,
        confirm: async () => true,
      });
      expect(lstatSync(join(f.data, ".on-track-owner.sqlite")).ino).toBe(inode);
      const next = acquireInstanceOwner(f.data);
      next.release();
      expect(lstatSync(join(f.data, ".on-track-owner.sqlite")).ino).toBe(inode);
      expect(existsSync(join(f.data, "on-track.sqlite"))).toBe(false);
    } finally {
      vi.mocked(rmSync).mockImplementation(actual.rmSync);
    }
  },
);
it("recognizes recorded older releases/checkpoints but rejects mismatched or busy records", () => {
  const f = fixture();
  const transactionId = randomUUID();
  const active = JSON.parse(readFileSync(join(f.root, "active.json"), "utf8"));
  const candidate = {
    ...active,
    buildId: "a".repeat(64),
    schemaVersion: 7,
    migrationMarker: 100,
  };
  delete candidate.protocol;
  const previous = { ...candidate, releaseId: "v0.0.8" };
  const old = join(f.root, "releases/v0.0.8");
  mkdirSync(old);
  const checkpoint = join(f.data, `.on-track-update-${transactionId}.sqlite`);
  writeFileSync(checkpoint, "checkpoint");
  writeJsonFile(join(f.root, "retention.json"), {
    protocol: 1,
    releases: [previous.releaseId],
    runtimes: [previous.runtimeId],
    checkpoints: [transactionId],
  });
  const last = {
    protocol: 1,
    transactionId,
    previous,
    candidate,
    checkpoint: {
      transactionId,
      sha256: "a".repeat(64),
      size: 10,
      schemaVersion: 7,
      migrationMarker: 100,
    },
  };
  writeJsonFile(join(f.root, "last-update.json"), last);
  const plan = planUninstall(f.root, false);
  expect(plan.app.some((item) => item.path === old)).toBe(true);
  expect(plan.checkpoints.map((item) => item.path)).toEqual([checkpoint]);
  writeFileSync(checkpoint + "-wal", "busy");
  expect(() => planUninstall(f.root, false)).toThrow(/still in use/);
  rmSync(checkpoint + "-wal");
  writeJsonFile(join(f.root, "last-update.json"), {
    ...last,
    candidate: previous,
  });
  expect(() => planUninstall(f.root, false)).toThrow(/does not match/);
});
