import { homedir } from "node:os";
import { isAbsolute, posix, resolve, win32 } from "node:path";

export function resolveDataDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory: string = homedir(),
): string {
  const override = environment.ON_TRACK_DATA_DIR;
  if (override) return isAbsolute(override) ? override : resolve(override);

  const targetPath = platform === "win32" ? win32 : posix;

  if (platform === "darwin")
    return targetPath.join(
      homeDirectory,
      "Library",
      "Application Support",
      "On Track",
    );
  if (platform === "win32") {
    return targetPath.join(
      environment.APPDATA ||
        targetPath.join(homeDirectory, "AppData", "Roaming"),
      "On Track",
    );
  }
  return targetPath.join(
    environment.XDG_DATA_HOME ||
      targetPath.join(homeDirectory, ".local", "share"),
    "on-track",
  );
}
