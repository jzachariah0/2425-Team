#!/usr/bin/env node
/**
 * Transparent caching reverse proxy for palantir.com.
 * Bytes from origin are cached as-is (no HTML/JS rewriting) so Next.js hydration works.
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "mirror");
const ORIGIN_HOST = "www.palantir.com";
const ORIGIN = `https://${ORIGIN_HOST}`;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

fs.mkdirSync(ROOT, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".vtt": "text/vtt; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".map": "application/json",
};

function cacheFileFor(pathname) {
  let p = decodeURIComponent(pathname.split("?")[0].split("#")[0] || "/");
  if (p === "/") p = "/index.html";
  else if (p.endsWith("/")) p += "index.html";
  else if (!path.extname(p)) p = p.replace(/\/?$/, "/") + "index.html";
  const full = path.normalize(path.join(ROOT, p.replace(/^\/+/, "")));
  if (!full.startsWith(ROOT)) return null;
  return full;
}

function fetchOrigin(reqPath, req) {
  return new Promise((resolve, reject) => {
    const headers = {
      host: ORIGIN_HOST,
      "user-agent":
        req.headers["user-agent"] ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      accept: req.headers["accept"] || "*/*",
      "accept-language": req.headers["accept-language"] || "en-US,en;q=0.9",
      "accept-encoding": "identity",
      referer: ORIGIN + "/",
    };
    if (req.headers.range) headers.range = req.headers.range;
    if (req.headers.cookie) headers.cookie = req.headers.cookie;

    const r = https.request(
      {
        hostname: ORIGIN_HOST,
        path: reqPath,
        method: req.method || "GET",
        headers,
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode || 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    r.on("error", reject);
    r.on("timeout", () => r.destroy(new Error("origin timeout")));
    r.end();
  });
}

function send(res, status, headers, body, method) {
  const out = { ...headers };
  // Drop hop-by-hop / framing headers that confuse local serving
  for (const h of [
    "content-encoding",
    "transfer-encoding",
    "content-length",
    "connection",
    "keep-alive",
    "strict-transport-security",
    "content-security-policy",
    "content-security-policy-report-only",
  ]) {
    delete out[h];
  }
  // Allow local embedding / mixed tooling
  out["content-length"] = Buffer.byteLength(body);
  out["x-mirror-proxy"] = "palantir";
  res.writeHead(status, out);
  if (method === "HEAD") res.end();
  else res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", `http://${HOST}:${PORT}`);

    if (u.pathname === "/__mirror/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, origin: ORIGIN, root: ROOT }));
      return;
    }

    // Proxy third-party CDN through local path so offline crawl can store them,
    // but browser will usually hit ctfassets directly (absolute URLs unchanged).
    if (u.pathname.startsWith("/__cdn/")) {
      const abs = "https://" + u.pathname.slice("/__cdn/".length) + u.search;
      const file = path.join(ROOT, u.pathname.slice(1).split("?")[0]);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const body = fs.readFileSync(file);
        send(res, 200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" }, body, req.method);
        return;
      }
      const remote = await new Promise((resolve, reject) => {
        https
          .get(abs, { headers: { "user-agent": "Mozilla/5.0", "accept-encoding": "identity" } }, (r) => {
            const chunks = [];
            r.on("data", (c) => chunks.push(c));
            r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
          })
          .on("error", reject);
      });
      if (remote.status < 400) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, remote.body);
      }
      send(res, remote.status, remote.headers, remote.body, req.method);
      return;
    }

    if (!["GET", "HEAD"].includes(req.method || "GET")) {
      // Forward non-GET (forms etc.) straight to origin without caching
      const remote = await fetchOrigin(u.pathname + u.search, req);
      send(res, remote.status, remote.headers, remote.body, req.method);
      return;
    }

    const file = cacheFileFor(u.pathname);
    const canCache = Boolean(file) && !u.pathname.startsWith("/_next/data/") && req.method === "GET";

    if (canCache && fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 0) {
      const body = fs.readFileSync(file);
      const ct = MIME[path.extname(file)] || "application/octet-stream";
      send(
        res,
        200,
        {
          "content-type": ct,
          "cache-control": u.pathname.startsWith("/_next/static/")
            ? "public, max-age=0, must-revalidate"
            : "public, max-age=60",
          "x-mirror": "HIT",
        },
        body,
        req.method
      );
      return;
    }

    const remote = await fetchOrigin(u.pathname + u.search, req);

    // Cache successful GETs
    if (canCache && remote.status >= 200 && remote.status < 300 && remote.body.length) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, remote.body);
    }

    const headers = { ...remote.headers, "x-mirror": "MISS" };
    if (!headers["content-type"] && file) {
      headers["content-type"] = MIME[path.extname(file)] || "application/octet-stream";
    }
    send(res, remote.status, headers, remote.body, req.method);
  } catch (err) {
    console.error(err);
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(String(err?.message || err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Palantir mirror → http://${HOST}:${PORT}`);
  console.log(`Cache: ${ROOT}`);
  console.log(`Origin: ${ORIGIN} (transparent, no rewrites)`);
});
