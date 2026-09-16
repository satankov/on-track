export interface CliArguments {
  command: string;
  version?: string;
  options: Record<string, string | boolean>;
}
export function parseArguments(args: string[]): CliArguments {
  const command = args[0] ?? "help";
  if (
    ![
      "run",
      "stop",
      "status",
      "logs",
      "update",
      "install",
      "maintenance-recover-import",
      "help",
      "--help",
      "--version",
      "--describe-runtime",
    ].includes(command)
  )
    throw new Error("Unknown command. Run thr --help.");
  const options: Record<string, string | boolean> = {};
  let version: string | undefined;
  const values = new Set([
    "root",
    ...(command === "install"
      ? [
          "release-dir",
          "runtime-dir",
          "manifest",
          "data-dir",
          "port",
          "adopt-from",
        ]
      : []),
  ]);
  const flags = new Set([
    ...(command === "run" || command === "install" || command === "update"
      ? ["no-open"]
      : []),
    ...(command === "install" ? ["no-profile"] : []),
    ...(command === "update" ? ["yes"] : []),
  ]);
  for (let i = 1; i < args.length; i++) {
    const argument = args[i];
    if (argument.startsWith("--")) {
      const name = argument.slice(2);
      if (name in options) throw new Error(`Duplicate option: --${name}`);
      if (flags.has(name)) options[name] = true;
      else if (values.has(name)) {
        const value = args[++i];
        if (!value || value.startsWith("--"))
          throw new Error(`Missing value for --${name}`);
        if (
          name === "port" &&
          (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
        )
          throw new Error("Port must be between 1 and 65535.");
        options[name] = value;
      } else throw new Error(`Unsupported option: ${argument}`);
    } else if (
      command === "update" &&
      !version &&
      /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(argument)
    )
      version = argument;
    else throw new Error("Expected a published version in vX.Y.Z form.");
  }
  return { command, ...(version ? { version } : {}), options };
}
