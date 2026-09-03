import type { BigIntStats } from "node:fs";

export interface FileIdentity {
  device: bigint;
  inode: bigint;
}

export function fileIdentity(
  stats: Pick<BigIntStats, "dev" | "ino">,
  platform: NodeJS.Platform = process.platform,
): FileIdentity {
  // libuv before 1.51 can expose inconsistent upper bits for the same Windows
  // volume through path stat and descriptor fstat. The volume serial is 32-bit.
  return {
    device: platform === "win32" ? BigInt.asUintN(32, stats.dev) : stats.dev,
    inode: stats.ino,
  };
}

export function isSameFileIdentity(
  left: FileIdentity,
  right: FileIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}
