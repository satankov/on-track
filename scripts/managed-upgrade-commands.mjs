// Only literal shell text reaches cmd.exe. Filesystem paths belong in cwd,
// never in a command string; the real .cmd launchers are still exercised.
const commands = new Map([
  ["ontrack --help", ".\\ontrack.cmd --help"],
  ["ontrack stop", ".\\ontrack.cmd stop"],
  ["ontrack status", ".\\ontrack.cmd status"],
  ["ontrack run --no-open", ".\\ontrack.cmd run --no-open"],
  [
    "ontrack update v99.0.0 --yes --no-open",
    ".\\ontrack.cmd update v99.0.0 --yes --no-open",
  ],
  ["ontrack update --yes --no-open", ".\\ontrack.cmd update --yes --no-open"],
  ["thr --help", ".\\thr.cmd --help"],
  ["thr stop", ".\\thr.cmd stop"],
  ["thr status", ".\\thr.cmd status"],
  ["thr run --no-open", ".\\thr.cmd run --no-open"],
]);

export function windowsFixtureCommand(name, argv) {
  const command = commands.get([name, ...argv].join(" "));
  if (!command) throw new Error("Unsupported fixture command");
  return command;
}

// Keep the shell sink separate from the harness's executable/argument runner.
// The only shell text is selected from the literal map above. Paths and
// environment values are passed through process options, never through /c.
export async function runWindowsFixtureCommand(name, argv, { cwd, env }) {
  return executeWindowsCommand(
    "cmd.exe",
    ["/d", "/s", "/c", windowsFixtureCommand(name, argv)],
    {
      cwd,
      env,
      shell: false,
      windowsVerbatimArguments: true,
      windowsHide: true,
      timeout: 900_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeWindowsCommand = promisify(execFile);
