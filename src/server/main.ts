import { assertSupportedRuntime } from "./runtime-support.js";

assertSupportedRuntime();

const { startLocalServer } = await import("./local-server.js");
await startLocalServer();
