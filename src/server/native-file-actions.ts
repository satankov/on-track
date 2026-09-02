import { spawn } from "node:child_process";
import { win32 } from "node:path";

const ACTION_TIMEOUT_MS = 10_000;
const WINDOWS_OPEN_SCRIPT =
  "$ErrorActionPreference='Stop'; Start-Process -FilePath $Env:ON_TRACK_NATIVE_FILE";

export interface NativeCommand {
  executable: string;
  args: string[];
  shell: false;
  environment?: Record<string, string>;
  unsupportedExitCodes?: number[];
}

export type NativeCommandRunner = (command: NativeCommand) => Promise<void>;

export interface NativeFileActions {
  readonly supported: boolean;
  readonly platform: NodeJS.Platform;
  open(path: string): Promise<void>;
  reveal(path: string, containingDirectory: string): Promise<void>;
}

export class NativeFileActionUnsupportedError extends Error {
  constructor() {
    super("Native file actions are not supported on this system.");
    this.name = "NativeFileActionUnsupportedError";
  }
}

export class NativeFileActionFailedError extends Error {
  constructor() {
    super("The operating system could not complete the file action.");
    this.name = "NativeFileActionFailedError";
  }
}

export function runNativeCommand(command: NativeCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command.executable, command.args, {
      env: command.environment
        ? { ...process.env, ...command.environment }
        : process.env,
      shell: command.shell,
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new NativeFileActionFailedError());
    }, ACTION_TIMEOUT_MS);
    timer.unref();
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        error.code === "ENOENT"
          ? new NativeFileActionUnsupportedError()
          : new NativeFileActionFailedError(),
      );
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else if (code !== null && command.unsupportedExitCodes?.includes(code)) {
        reject(new NativeFileActionUnsupportedError());
      } else reject(new NativeFileActionFailedError());
    });
  });
}

function encodedPowerShellScript(): string {
  return Buffer.from(WINDOWS_OPEN_SCRIPT, "utf16le").toString("base64");
}

export class SystemNativeFileActions implements NativeFileActions {
  readonly platform: NodeJS.Platform;
  private readonly run: NativeCommandRunner;
  private readonly windowsDirectory: string;

  constructor(
    options: {
      platform?: NodeJS.Platform;
      run?: NativeCommandRunner;
      windowsDirectory?: string;
    } = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.run = options.run ?? runNativeCommand;
    this.windowsDirectory =
      options.windowsDirectory ?? process.env.SystemRoot ?? "C:\\Windows";
  }

  get supported(): boolean {
    return ["darwin", "win32", "linux"].includes(this.platform);
  }

  async open(path: string): Promise<void> {
    await this.runSafely(this.openCommand(path));
  }

  async reveal(path: string, containingDirectory: string): Promise<void> {
    await this.runSafely(this.revealCommand(path, containingDirectory));
  }

  private openCommand(path: string): NativeCommand {
    if (this.platform === "darwin") {
      return command("/usr/bin/open", [path]);
    }
    if (this.platform === "linux") {
      return {
        ...command("/usr/bin/xdg-open", [path]),
        unsupportedExitCodes: [3, 4],
      };
    }
    if (this.platform === "win32") {
      return {
        ...command(
          win32.join(
            this.windowsDirectory,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          ),
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            encodedPowerShellScript(),
          ],
        ),
        environment: { ON_TRACK_NATIVE_FILE: path },
      };
    }
    throw new NativeFileActionUnsupportedError();
  }

  private revealCommand(
    path: string,
    containingDirectory: string,
  ): NativeCommand {
    if (this.platform === "darwin") {
      return command(
        "/usr/bin/open",
        path === containingDirectory ? [containingDirectory] : ["-R", path],
      );
    }
    if (this.platform === "linux") {
      return {
        ...command("/usr/bin/xdg-open", [containingDirectory]),
        unsupportedExitCodes: [3, 4],
      };
    }
    if (this.platform === "win32") {
      return command(
        win32.join(this.windowsDirectory, "explorer.exe"),
        path === containingDirectory
          ? [containingDirectory]
          : [`/select,${path}`],
      );
    }
    throw new NativeFileActionUnsupportedError();
  }

  private async runSafely(commandValue: NativeCommand): Promise<void> {
    try {
      await this.run(commandValue);
    } catch (error) {
      if (
        error instanceof NativeFileActionUnsupportedError ||
        error instanceof NativeFileActionFailedError
      ) {
        throw error;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new NativeFileActionUnsupportedError();
      }
      throw new NativeFileActionFailedError();
    }
  }
}

function command(executable: string, args: string[]): NativeCommand {
  return { executable, args, shell: false };
}
