export interface RuntimeEnvironment {
  nodeVersion: string;
  platform: NodeJS.Platform;
}

const nodeVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
const supportedPlatforms = new Set<NodeJS.Platform>([
  "darwin",
  "linux",
  "win32",
]);

export function runtimeSupportError({
  nodeVersion,
  platform,
}: RuntimeEnvironment): string | undefined {
  const match = nodeVersionPattern.exec(nodeVersion);
  if (!match) {
    return `Unsupported Node.js version: ${nodeVersion}.`;
  }

  if (!supportedPlatforms.has(platform)) {
    return `Unsupported operating system: ${platform}. threadstr supports Windows, macOS, and Linux.`;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);

  if (platform === "win32") {
    return major === 24
      ? undefined
      : `threadstr requires Node.js 24 on Windows; found Node.js ${nodeVersion}.`;
  }

  if (major === 24 || (major === 22 && minor >= 16)) {
    return undefined;
  }

  return `threadstr requires Node.js 22.16 or Node.js 24; found Node.js ${nodeVersion}.`;
}

export function assertSupportedRuntime(
  environment: RuntimeEnvironment = {
    nodeVersion: process.versions.node,
    platform: process.platform,
  },
): void {
  const error = runtimeSupportError(environment);
  if (error) throw new Error(error);
}
