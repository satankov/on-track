import { describe, expect, it, vi } from "vitest";

import {
  NativeFileActionFailedError,
  NativeFileActionUnsupportedError,
  SystemNativeFileActions,
  runNativeCommand,
  type NativeCommand,
} from "./native-file-actions.js";

describe("system native file actions", () => {
  const hostilePath = "/managed/quote' comma, $() ; % name\nnotes.pptx";

  it("uses fixed shell-free macOS commands", async () => {
    const commands: NativeCommand[] = [];
    const actions = new SystemNativeFileActions({
      platform: "darwin",
      run: vi.fn(async (command) => {
        commands.push(command);
      }),
    });

    await actions.open(hostilePath);
    await actions.reveal(hostilePath, "/managed");

    expect(commands).toEqual([
      expect.objectContaining({
        executable: "/usr/bin/open",
        args: [hostilePath],
        shell: false,
      }),
      expect.objectContaining({
        executable: "/usr/bin/open",
        args: ["-R", hostilePath],
        shell: false,
      }),
    ]);
  });

  it("keeps the Windows target out of fixed PowerShell source", async () => {
    const commands: NativeCommand[] = [];
    const actions = new SystemNativeFileActions({
      platform: "win32",
      windowsDirectory: "C:\\Windows",
      run: vi.fn(async (command) => {
        commands.push(command);
      }),
    });

    await actions.open(hostilePath);
    await actions.reveal(hostilePath, "/managed");

    expect(commands[0]).toMatchObject({
      executable:
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        expect.any(String),
      ],
      shell: false,
      environment: { ON_TRACK_NATIVE_FILE: hostilePath },
    });
    expect(commands[0].args.join(" ")).not.toContain(hostilePath);
    expect(commands[1]).toMatchObject({
      executable: "C:\\Windows\\explorer.exe",
      args: [`/select,${hostilePath}`],
      shell: false,
    });
  });

  it("opens files and containing directories with fixed Linux commands", async () => {
    const commands: NativeCommand[] = [];
    const actions = new SystemNativeFileActions({
      platform: "linux",
      run: vi.fn(async (command) => {
        commands.push(command);
      }),
    });

    await actions.open(hostilePath);
    await actions.reveal(hostilePath, "/managed/folder");

    expect(commands).toEqual([
      expect.objectContaining({
        executable: "/usr/bin/xdg-open",
        args: [hostilePath],
        unsupportedExitCodes: [3, 4],
      }),
      expect.objectContaining({
        executable: "/usr/bin/xdg-open",
        args: ["/managed/folder"],
      }),
    ]);
  });

  it("rejects unsupported platforms and normalizes launcher failures", async () => {
    const unsupported = new SystemNativeFileActions({
      platform: "aix",
      run: vi.fn(),
    });
    await expect(unsupported.open("/private/secret.txt")).rejects.toThrow(
      NativeFileActionUnsupportedError,
    );
    expect(unsupported.supported).toBe(false);

    const failed = new SystemNativeFileActions({
      platform: "darwin",
      run: vi.fn(async () => {
        throw Object.assign(new Error("spawn /private/secret.txt"), {
          code: "EACCES",
        });
      }),
    });
    const error = await failed
      .open("/private/secret.txt")
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(NativeFileActionFailedError);
    expect(String(error)).not.toContain("/private/secret.txt");
  });

  it("settles shell-free child processes on success, failure, and missing executables", async () => {
    await expect(
      runNativeCommand({
        executable: process.execPath,
        args: ["-e", "process.exit(0)"],
        shell: false,
      }),
    ).resolves.toBeUndefined();
    await expect(
      runNativeCommand({
        executable: process.execPath,
        args: ["-e", "process.exit(7)"],
        shell: false,
      }),
    ).rejects.toThrow(NativeFileActionFailedError);
    await expect(
      runNativeCommand({
        executable: "/definitely-missing-on-track-launcher",
        args: [],
        shell: false,
      }),
    ).rejects.toThrow(NativeFileActionUnsupportedError);
    await expect(
      runNativeCommand({
        executable: process.execPath,
        args: ["-e", "process.exit(3)"],
        shell: false,
        unsupportedExitCodes: [3, 4],
      }),
    ).rejects.toThrow(NativeFileActionUnsupportedError);
  });

  it.each([
    { platform: "darwin" as const, executable: "/usr/bin/open" },
    {
      platform: "win32" as const,
      executable: "C:\\Windows\\explorer.exe",
    },
  ])(
    "opens a safe containing folder for a broken target on $platform",
    async ({ platform, executable }) => {
      const commands: NativeCommand[] = [];
      const actions = new SystemNativeFileActions({
        platform,
        windowsDirectory: "C:\\Windows",
        run: vi.fn(async (command) => {
          commands.push(command);
        }),
      });

      await actions.reveal("/managed/folder", "/managed/folder");

      expect(commands[0]).toMatchObject({
        executable,
        args: ["/managed/folder"],
      });
    },
  );

  it("rejects reveal on unsupported platforms", async () => {
    const actions = new SystemNativeFileActions({
      platform: "freebsd",
      run: vi.fn(),
    });
    await expect(actions.reveal("/managed/file", "/managed")).rejects.toThrow(
      NativeFileActionUnsupportedError,
    );
  });

  it.each([
    new NativeFileActionUnsupportedError(),
    new NativeFileActionFailedError(),
  ])("preserves normalized runner error %s", async (normalizedError) => {
    const actions = new SystemNativeFileActions({
      platform: "darwin",
      run: vi.fn(async () => {
        throw normalizedError;
      }),
    });

    await expect(actions.open("/managed/file.txt")).rejects.toBe(
      normalizedError,
    );
  });
});
