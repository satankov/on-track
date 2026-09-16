import { spawn } from "node:child_process";
import { prepareCommands } from "./launchers.js";
import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, posix, win32 } from "node:path";
import { privateDirectory } from "./state.js";

export function defaultInstallRoot(
  platform: string = process.platform,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "darwin")
    return posix.join(home, "Library/Application Support/On Track Runtime");
  if (platform === "linux")
    return posix.join(
      env.XDG_DATA_HOME || posix.join(home, ".local/share"),
      "on-track-runtime",
    );
  if (platform === "win32")
    return win32.join(
      env.LOCALAPPDATA || win32.join(home, "AppData/Local"),
      "On Track Runtime",
    );
  throw new Error(
    "Managed installation is not supported on this platform. Use manual installation.",
  );
}
export function validateLocalBrowserUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid local application URL.");
  return url.href;
}
function execute(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Could not open the browser.")),
    );
  });
}
export async function openLocalBrowser(value: string): Promise<void> {
  const url = validateLocalBrowserUrl(value);
  if (process.platform === "darwin") return execute("/usr/bin/open", [url]);
  if (process.platform === "linux") return execute("xdg-open", [url]);
  if (process.platform === "win32")
    return execute("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
  throw new Error("Browser opening is not supported.");
}
function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
const START = "# >>> On Track command >>>";
const END = "# <<< On Track command <<<";
export function updateProfile(text: string, bin: string): string {
  if (/[\r\n\0]/.test(bin)) throw new Error("Invalid command directory.");
  const start = text.indexOf(START),
    end = text.indexOf(END);
  if (start < 0 !== end < 0 || (start >= 0 && end < start))
    throw new Error("Incomplete threadstr compatibility profile block.");
  const clean =
    start >= 0
      ? text.slice(0, start) +
        text.slice(end + END.length).replace(/^\r?\n/, "")
      : text;
  return (
    clean.replace(/\n*$/, "\n") +
    START +
    "\nexport PATH=" +
    quote(bin) +
    ':"$PATH"\n' +
    END +
    "\n"
  );
}
export function writeProfileAtomically(profile: string, bin: string): void {
  const stat = existsSync(profile) ? lstatSync(profile) : undefined;
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1))
    throw Error("Unsafe profile file.");
  const temporary = profile + ".ontrack-" + randomUUID();
  try {
    writeFileSync(
      temporary,
      updateProfile(stat ? readFileSync(profile, "utf8") : "", bin),
      { flag: "wx", mode: stat ? stat.mode & 0o777 : 0o600 },
    );
    renameSync(temporary, profile);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
export async function installCommand(
  root: string,
  options: { noProfile?: boolean; runtimeExecutable?: string } = {},
): Promise<string> {
  root = privateDirectory(root);
  const command = prepareCommands(root, options.runtimeExecutable);
  const bin = join(root, "bin");
  if (options.noProfile) return command;
  if (process.platform === "win32") {
    const script =
      "$p=[string][Environment]::GetEnvironmentVariable('Path','User');$b=" +
      "'" +
      bin.replaceAll("'", "''") +
      "';if(($p -split ';') -notcontains $b){[Environment]::SetEnvironmentVariable('Path',($p.TrimEnd(';')+';'+$b),'User')}";
    await execute("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
  } else {
    const shell = basename(process.env.SHELL || "");
    const profile =
      shell === "zsh"
        ? join(homedir(), ".zshrc")
        : shell === "bash"
          ? join(
              homedir(),
              process.platform === "darwin" ? ".bash_profile" : ".bashrc",
            )
          : undefined;
    if (!profile) {
      console.log("Add this command directory to your shell PATH: " + bin);
      return command;
    }
    if (
      existsSync(profile) &&
      (!lstatSync(profile).isFile() || lstatSync(profile).isSymbolicLink())
    )
      throw new Error("Profile is not a regular file. Use --no-profile.");
    writeProfileAtomically(profile, bin);
  }
  return command;
}
