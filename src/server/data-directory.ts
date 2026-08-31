import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function resolveDataDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = environment.ON_TRACK_DATA_DIR;
  if (override) return isAbsolute(override) ? override : resolve(override);

  if (platform === "darwin")
    return join(homedir(), "Library", "Application Support", "On Track");
  if (platform === "win32") {
    return join(
      environment.APPDATA || join(homedir(), "AppData", "Roaming"),
      "On Track",
    );
  }
  return join(
    environment.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    "on-track",
  );
}
