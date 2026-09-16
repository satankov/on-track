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
