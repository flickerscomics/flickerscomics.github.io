import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fullTitle, esc, placeholderCover, seriesKey } from "../src/shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const products = JSON.parse(fs.readFileSync(path.join(ROOT, "data/products.json"), "utf8"));
/* titles with two or more issues get a series page */
const series = [...products.reduce((m, p) => m.set(seriesKey(p), [...(m.get(seriesKey(p)) || []), p]), new Map()).values()].filter(l => l.length > 1);

test("the site builds", () => {
  execFileSync(process.execPath, ["build/build.mjs"], { cwd: ROOT, stdio: "pipe", env: { ...process.env, ADMIN_API: "" } });
  assert.ok(fs.existsSync(path.join(DIST, "index.html")));
});

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? htmlFiles(path.join(dir, e.name)) : e.name.endsWith(".html") ? [path.join(dir, e.name)] : []);
}

test("every page has a title, description and working local links", () => {
  const pages = htmlFiles(DIST).filter(f => !f.endsWith("404.html"));
  assert.equal(pages.length, products.length + 2 + (series.length ? series.length + 1 : 0), "home + admin + one page per comic + the series pages and their list");
  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    assert.match(html, /<title>[^<]+<\/title>/, file);
    assert.match(html, /<meta name="description" content="[^"]+"/, file);
    const dir = path.dirname(file);
    for (const m of html.matchAll(/(?:href|src|srcset)="([^"]+)"/g)) {
      for (const ref of m[1].split(",").map(s => s.trim().split(/\s+/)[0])) {
        if (!ref || /^(https?:|data:|#|mailto:)/.test(ref)) continue;
        const clean = ref.split("#")[0].split("?")[0];
        let target = path.resolve(dir, clean);
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
        assert.ok(fs.existsSync(target), `${path.relative(DIST, file)} links to missing ${ref}`);
      }
    }
  }
});

test("the shelf is in the HTML, not built by script", () => {
  const home = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  assert.equal((home.match(/<article class="card"/g) || []).length, products.length);
  assert.ok(home.includes(esc(fullTitle(products[0]))));
});

test("comic pages carry product data for search engines and link previews", () => {
  const p = products.find(x => x.image) || products[0];
  const html = fs.readFileSync(path.join(DIST, "comic", p.id, "index.html"), "utf8");
  assert.match(html, /"@type":"Product"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/[^"]+\/comic\//);
  assert.match(html, /<meta property="og:image" content="https:\/\//);
  assert.match(html, /<h1 class="qv-title">/);
});

test("sitemap lists every comic, robots keeps staff pages out", () => {
  const sm = fs.readFileSync(path.join(DIST, "sitemap.xml"), "utf8");
  assert.equal((sm.match(/<loc>/g) || []).length, products.length + 1 + (series.length ? series.length + 1 : 0));
  assert.match(fs.readFileSync(path.join(DIST, "robots.txt"), "utf8"), /Disallow: .*\/admin\//);
});

test("no secrets or tokens end up in the published site", () => {
  const files = fs.readdirSync(DIST, { recursive: true }).map(f => path.join(DIST, f)).filter(f => fs.statSync(f).isFile() && /\.(html|js|json|css|txt|xml)$/.test(f));
  for (const f of files) assert.ok(!/ghp_[A-Za-z0-9]{20,}|github_pat_|SESSION_SECRET|SETUP_KEY/.test(fs.readFileSync(f, "utf8")), `secret-looking text in ${f}`);
});

test("every page is valid HTML", async () => {
  const { HtmlValidate } = await import("html-validate");
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, ".htmlvalidate.json"), "utf8"));
  const validator = new HtmlValidate(config);
  const problems = [];
  for (const file of htmlFiles(DIST)) {
    const report = await validator.validateString(fs.readFileSync(file, "utf8"), path.relative(DIST, file));
    for (const r of report.results) for (const m of r.messages) problems.push(`${r.filePath}:${m.line}:${m.column} ${m.ruleId} ${m.message}`);
  }
  assert.deepEqual(problems.slice(0, 10), [], `${problems.length} HTML problem(s)`);
});

test("pages ask for no external resources the security policy would block", () => {
  for (const file of [path.join(DIST, "index.html"), path.join(DIST, "admin/index.html")]) {
    const html = fs.readFileSync(file, "utf8");
    const csp = ((html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "").replaceAll("&#39;", "'");
    assert.match(csp, /script-src 'self'/, file);
    assert.ok(!/unsafe-inline/.test(csp.match(/script-src[^;]*/)[0]), "no inline scripts allowed");
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>(?!\s*<\/script>)/.test(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "")), `inline script in ${file}`);
  }
});

test("placeholder covers escape their text", () => {
  assert.ok(!placeholderCover({ id: "x", title: "<img onerror=1>", publisher: "A&B", stock: 1 }).includes("<img"));
});

test("series pages list every issue, and each issue links back to its series", () => {
  if (!series.length) return; // the live stock may have no multi-issue titles
  const index = fs.readFileSync(path.join(DIST, "series/index.html"), "utf8");
  for (const list of series) {
    const slug = fs.readdirSync(path.join(DIST, "series")).find(d => d !== "index.html" && fs.readFileSync(path.join(DIST, "series", d, "index.html"), "utf8").includes(`data-id="${list[0].id}"`));
    assert.ok(slug, `a series page exists for ${list[0].title}`);
    const html = fs.readFileSync(path.join(DIST, "series", slug, "index.html"), "utf8");
    for (const p of list) {
      assert.ok(html.includes(`data-id="${p.id}"`), `${fullTitle(p)} is on its series page`);
      assert.ok(fs.readFileSync(path.join(DIST, "comic", p.id, "index.html"), "utf8").includes(`href="../../series/${slug}/"`), `${fullTitle(p)} links to its series`);
    }
    assert.ok(index.includes(`href="../series/${slug}/"`), "the list links to it");
  }
  const single = products.find(p => !series.some(l => l.includes(p)));
  assert.ok(!fs.readFileSync(path.join(DIST, "comic", single.id, "index.html"), "utf8").includes("See the whole series"), "a one-issue title has no series link");
  assert.match(fs.readFileSync(path.join(DIST, "index.html"), "utf8"), /<a href="series\/">Series<\/a>/, "the menu links to the list");
});
