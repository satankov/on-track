import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";

// Test-only publisher transport; production URLs, parsers, checksums and update
// code stay unchanged. No request can pass through to an external destination.
export function publisherFixture(manifest, source) {
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const base = `https://github.com/satankov/on-track/releases/download/v${manifest.version}`;
  const asset = (name, bytes) => ({
    name,
    browser_download_url: `${base}/${name}`,
    size: bytes.length,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  });
  const metadata = {
    tag_name: `v${manifest.version}`,
    draft: false,
    prerelease: false,
    immutable: true,
    assets: [
      asset("managed-release.json", manifestBytes),
      asset(manifest.source.name, source),
    ],
  };
  const routes = new Map([
    [`${base}/managed-release.json`, manifestBytes],
    [manifest.source.url, source],
    [
      `https://api.github.com/repos/satankov/on-track/releases/tags/v${manifest.version}`,
      Buffer.from(JSON.stringify(metadata)),
    ],
    [
      "https://api.github.com/repos/satankov/on-track/releases?per_page=100&page=1",
      Buffer.from(JSON.stringify([metadata])),
    ],
  ]);
  return (url) => routes.get(url);
}

export async function startPublisherProxy({ key, cert, lookup }) {
  const sockets = new Set();
  const requests = [];
  const tls = httpsServer({ key, cert }, (request, response) => {
    const url = `https://${request.headers.host}${request.url}`;
    requests.push(url);
    const bytes = request.method === "GET" ? lookup(url) : undefined;
    if (!bytes) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-length": bytes.length,
      "content-type": "application/octet-stream",
    });
    response.end(bytes);
  });
  const proxy = httpServer((_request, response) => {
    response.writeHead(403);
    response.end();
  });
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  });
  proxy.on("connect", (request, socket, head) => {
    if (!["api.github.com:443", "github.com:443"].includes(request.url)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) socket.unshift(head);
    tls.emit("connection", socket);
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${proxy.address().port}`,
    requests,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => proxy.close(resolve));
      tls.close();
    },
  };
}
