import { assertSupportedRuntime } from "./runtime-support.js";
import { describeRuntime } from "./runtime/build-info.js";

assertSupportedRuntime();

if (process.argv.slice(2).includes("--describe-runtime")) {
  console.log(JSON.stringify(describeRuntime()));
} else {
  const { startLocalServer } = await import("./local-server.js");
  const { parseManagedLaunch } = await import("./runtime/managed-server.js");
  const raw = process.env.ON_TRACK_MANAGED_LAUNCH;
  delete process.env.ON_TRACK_MANAGED_LAUNCH;
  await startLocalServer({
    managed: raw ? parseManagedLaunch(raw) : undefined,
  });
}
