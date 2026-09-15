#!/usr/bin/env node
/**
 * Pre-warm the local mirror by crawling the sitemap + discovering page assets.
 */
import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "mirror");
const ORIGIN = "https://www.palantir.com";
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const HOME_ONLY = process.argv.includes("--home");

fs.mkdirSync(ROOT, { recursive: true });

function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      u,
      {
        method: "GET",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          accept: "*/*",
          "accept-encoding": "identity",
          referer: ORIGIN + "/",
        },
        timeout: 120000,
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirects > 8) return reject(new Error("too many redirects"));
          const next = new URL(res.headers.location, u).href;
          res.resume();
          return resolve(fetchBuffer(next, redirects + 1));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode || 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
            finalUrl: u.href,
          })
        );
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout " + url)));
    req.end();
  });
}

function rewrite(text, contentType) {
  // Keep origin bytes intact — rewriting breaks Next.js and absolute asset URLs.
  return text;
}

function cachePathFor(pathname) {
  let p = pathname.split("?")[0];
  if (!p.startsWith("/")) p = "/" + p;
  if (p.endsWith("/")) p += "index.html";
  else if (!path.extname(p) && !p.includes(".")) p += "/index.html";
  // sanitize query-less path
  const full = path.join(ROOT, p.replace(/^\/+/, ""));
  if (!full.startsWith(ROOT)) throw new Error("bad path " + pathname);
  return full;
}

function cdnCachePath(absoluteUrl) {
  const u = new URL(absoluteUrl);
  const full = path.join(ROOT, "__cdn", u.host, u.pathname.replace(/^\/+/, ""));
  if (!full.startsWith(path.join(ROOT, "__cdn"))) throw new Error("bad cdn");
  return full;
}

async function savePage(pathname) {
  const url = ORIGIN + pathname;
  const file = cachePathFor(pathname.endsWith("/") || pathname === "/" ? (pathname === "/" ? "/" : pathname) : pathname.endsWith(".json") || path.extname(pathname) ? pathname : pathname + "/");
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    return { file, skipped: true, body: fs.readFileSync(file) };
  }
  const remote = await fetchBuffer(url);
  if (remote.status >= 400) {
    console.warn("FAIL", remote.status, pathname);
    return { file, skipped: false, error: remote.status };
  }
  const ct = remote.headers["content-type"] || "text/html";
  let body = remote.body;
  if (/text|json|javascript|css|xml|svg/i.test(ct)) {
    body = Buffer.from(rewrite(body.toString("utf8"), ct), "utf8");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  console.log("OK", pathname, "→", path.relative(ROOT, file), `(${body.length})`);
  return { file, skipped: false, body, contentType: ct };
}

async function saveAsset(urlOrPath) {
  let absolute;
  let file;
  if (urlOrPath.startsWith("/__cdn/")) {
    absolute = "https://" + urlOrPath.slice("/__cdn/".length);
    file = path.join(ROOT, urlOrPath.slice(1).split("?")[0]);
  } else if (urlOrPath.startsWith("http")) {
    absolute = urlOrPath;
    const u = new URL(absolute);
    if (u.hostname === "www.palantir.com") {
      file = cachePathFor(u.pathname);
    } else if (u.hostname.endsWith("ctfassets.net")) {
      file = cdnCachePath(absolute);
    } else {
      return null;
    }
  } else if (urlOrPath.startsWith("/")) {
    absolute = ORIGIN + urlOrPath.split("?")[0];
    file = cachePathFor(urlOrPath);
  } else return null;

  if (fs.existsSync(file) && fs.statSync(file).size > 0) return { file, skipped: true };
  try {
    const remote = await fetchBuffer(absolute);
    if (remote.status >= 400) {
      console.warn("ASSET FAIL", remote.status, absolute);
      return null;
    }
    let body = remote.body;
    const ct = remote.headers["content-type"] || "";
    if (/text|json|javascript|css|xml|svg/i.test(ct)) {
      body = Buffer.from(rewrite(body.toString("utf8"), ct), "utf8");
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    console.log("ASSET", absolute.slice(0, 100), body.length);
    return { file, skipped: false };
  } catch (e) {
    console.warn("ASSET ERR", absolute, e.message);
    return null;
  }
}

function extractRefs(text) {
  const refs = new Set();
  const patterns = [
    /(?:href|src|poster)=["']([^"']+)["']/gi,
    /url\((['"]?)([^'")]+)\1\)/gi,
    /"(\/_next\/[^"]+)"/g,
    /"(\/assets\/[^"]+)"/g,
    /"(\/fonts\/[^"]+)"/g,
    /["'](\/__cdn\/[^"']+)["']/g,
    /https:\/\/images\.ctfassets\.net\/[^"'\s)]+/g,
    /https:\/\/videos\.ctfassets\.net\/[^"'\s)]+/g,
    /https:\/\/www\.palantir\.com(\/[^"'\s)]+)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const raw = m[2] || m[1];
      if (!raw || raw.startsWith("data:") || raw.startsWith("mailto:") || raw.startsWith("javascript:")) continue;
      refs.add(raw);
    }
  }
  return [...refs];
}

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

async function main() {
  console.log("Crawling into", ROOT);

  // Always ensure homepage
  const home = await savePage("/");
  const seedAssets = new Set();

  // Critical homepage static deps from saved HTML if present
  const indexHtml = path.join(ROOT, "index.html");
  if (fs.existsSync(indexHtml)) {
    for (const r of extractRefs(fs.readFileSync(indexHtml, "utf8"))) seedAssets.add(r);
  }
  if (home?.body) {
    for (const r of extractRefs(home.body.toString("utf8"))) seedAssets.add(r);
  }

  // Known hero media from live site
  const heroMedia = [
    "/assets/xrfr7uokpv1b/n6ice73sfdWoNOQiDq6NA/d60f7448d43d38400eec368c062c0348/PAL_HERO_REEL_v1.9.mp4",
    "/assets/xrfr7uokpv1b/XmNgFr3RG44TRnXn3NjQK/64e27271f756a727824b8de7c692eef0/PAL_HERO_REEL_StaticFrame_v1.2.jpg",
    "/assets/xrfr7uokpv1b/2fTZfDLbPWGrek0OioBeKS/4926f2023d83ad6fb1e8c2e91610c636/PAL_HERO_REEL_v1.9.vtt",
    "/assets/xrfr7uokpv1b/1ZAGlJWcYtVmMckdqFKUNW/7ff05eda0bd3471eba68c522caa32872/homepage_-_AIP.mov",
    "/assets/xrfr7uokpv1b/6pvakzOU4AhfZjrgbrRXr9/ed5bb90509c20aa199058c74b3d7efd0/homepage_-_Gotham.mov",
    "/assets/xrfr7uokpv1b/2yuGstJPCnqZBe7DOcOVNx/85275c8cb70fef128d8eda7af4900690/homepage_-_Foundry.mov",
    "/assets/xrfr7uokpv1b/727o8CbUwqHs2hTt02hIiO/cf08155d0843b07849af7d85c8e1aac0/Ontology.mov",
    "/assets/xrfr7uokpv1b/4hKQ7uw6vsjxrlntoFav6k/d9ea76812927c7b04539acc5463d3300/homepage_-_Apollo.mov",
    "/fonts/Alliance/AllianceNo1-Regular.woff2",
    "/fonts/Alliance/AllianceNo2-Regular.woff2",
    "/favicon.ico",
  ];
  for (const m of heroMedia) seedAssets.add(m);

  console.log("Seeding", seedAssets.size, "asset refs from homepage…");
  await pool([...seedAssets], CONCURRENCY, async (ref) => {
    if (ref.startsWith("/") || ref.startsWith("http") || ref.startsWith("/__cdn/")) {
      // skip internal page links without extension during asset pass if they look like pages
      if (ref.startsWith("/") && !ref.startsWith("/_next") && !ref.startsWith("/assets") && !ref.startsWith("/fonts") && !ref.startsWith("/__cdn") && !ref.startsWith("/favicon") && !/\.[a-z0-9]{2,5}(\?|$)/i.test(ref)) {
        return;
      }
      await saveAsset(ref);
    }
  });

  // Second pass: parse downloaded CSS/JS for more refs
  const more = new Set();
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(css|js|html)$/i.test(name) && st.size < 8_000_000) {
        try {
          for (const r of extractRefs(fs.readFileSync(p, "utf8"))) more.add(r);
        } catch {}
      }
    }
  }
  walk(ROOT);
  console.log("Discovered", more.size, "refs from cached files…");
  await pool([...more], CONCURRENCY, async (ref) => {
    if (
      ref.startsWith("/_next/") ||
      ref.startsWith("/assets/") ||
      ref.startsWith("/fonts/") ||
      ref.startsWith("/__cdn/") ||
      ref.includes("ctfassets.net") ||
      (ref.startsWith("https://www.palantir.com/") && /\.[a-z0-9]{2,5}(\?|$)/i.test(ref))
    ) {
      await saveAsset(ref);
    }
  });

  if (HOME_ONLY) {
    console.log("Home-only crawl complete.");
    return;
  }

  // Full sitemap pages
  const sm = await fetchBuffer(ORIGIN + "/sitemap.xml");
  const locs = [...sm.body.toString("utf8").matchAll(/<loc>(https:\/\/www\.palantir\.com[^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log("Sitemap pages:", locs.length);
  const pages = locs.map((l) => new URL(l).pathname).filter((p) => p !== "/");
  await pool(pages, CONCURRENCY, async (pathname) => {
    try {
      const saved = await savePage(pathname);
      if (saved?.body) {
        const refs = extractRefs(saved.body.toString("utf8"));
        for (const r of refs) {
          if (r.startsWith("/_next/") || r.startsWith("/assets/") || r.startsWith("/fonts/") || r.startsWith("/__cdn/") || r.includes("ctfassets.net")) {
            await saveAsset(r);
          }
        }
      }
    } catch (e) {
      console.warn("PAGE ERR", pathname, e.message);
    }
  });

  console.log("Crawl complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
