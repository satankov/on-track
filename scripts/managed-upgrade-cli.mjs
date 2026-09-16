import { pathToFileURL } from "node:url";

// Invoke the unchanged published CLI entry point without its presentation-only
// error handler, so fixture failures retain their original stack and filesystem
// operation. process.argv[1] remains this wrapper, preventing a second invocation.
const entry = process.argv[2];
const { main } = await import(pathToFileURL(entry).href);
await main(process.argv.slice(3));
