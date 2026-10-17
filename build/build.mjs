/* Builds the static site into dist/.
   Reads data/*.json and assets/, writes pre-rendered HTML, resized covers, fonts, css and js.
   Run with: npm run build */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import * as esbuild from "esbuild";
import { fullTitle, coverName, seriesKey, slug } from "../src/shared.mjs";
import { page, homePage, comicPage, notFoundPage, seriesPage, seriesIndexPage, seriesUrl, DEFAULT_DESC } from "./templates.mjs";
import { adminPage } from "./admin-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const rd = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const wr = (p, data) => { const f = path.join(DIST, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const cp = (from, to) => { const f = path.join(DIST, to); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(path.join(ROOT, from), f); };

/* ---------- data ---------- */
const cfg = JSON.parse(rd("data/config.json"));
const products = JSON.parse(process.env.PRODUCTS_FILE ? fs.readFileSync(process.env.PRODUCTS_FILE, "utf8") : rd("data/products.json")); // PRODUCTS_FILE: lets the QA suite build with a different stock list
const featuredRaw = JSON.parse(rd("data/featured.json"));
if (process.env.ORDERS_LIVE) cfg.testMode = false; // local testing of the live order path
if (process.env.ORDER_API) cfg.orderApi = process.env.ORDER_API;
if (process.env.ADMIN_API) cfg.adminApi = process.env.ADMIN_API; // lets you point a local build at a local or test staff API
const cats = cfg.categories;

function validate() {
  const errs = [], ids = new Set();
  const keys = new Set(cats.map(c => c.key));
  products.forEach((p, i) => {
    const where = `products[${i}] (${p.id || "no id"})`;
    if (!p.id || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) errs.push(`${where}: id must be lowercase letters, numbers and dashes`);
    if (ids.has(p.id)) errs.push(`${where}: duplicate id`);
    ids.add(p.id);
    if (!keys.has(p.cat)) errs.push(`${where}: unknown category "${p.cat}"`);
    if (!p.title) errs.push(`${where}: missing title`);
    if (!Number.isFinite(p.price) || p.price < 0) errs.push(`${where}: bad price`);
    if (!Number.isInteger(p.stock) || p.stock < 0) errs.push(`${where}: bad stock`);
    if (p.image && !fs.existsSync(path.join(ROOT, p.image))) errs.push(`${where}: image not found: ${p.image}`);
  });
  featuredRaw.forEach(id => { if (!ids.has(id)) errs.push(`featured.json: unknown id "${id}"`); });
  if (!cfg.siteUrl) errs.push("config.json: siteUrl is required");
  if (errs.length) { console.error("Data problems:\n - " + errs.join("\n - ")); process.exit(1); }
}
validate();

const siteUrl = cfg.siteUrl.replace(/\/+$/, "");
const realCats = cats.filter(c => c.key !== "all");
const usedCats = realCats.filter(c => products.some(p => p.cat === c.key));
const groupBy = usedCats.length > 1 ? "cat" : "publisher";
const groupKey = p => groupBy === "cat" ? p.cat : (p.publisher || "Other");
const counts = new Map();
products.forEach(p => counts.set(groupKey(p), (counts.get(groupKey(p)) || 0) + 1));
const groups = [...counts.entries()]
  .map(([key, count]) => ({ key, count, label: groupBy === "cat" ? (cats.find(c => c.key === key) || {}).label || key : key }))
  .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

/* ---------- start clean ---------- */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

/* ---------- fonts (self-hosted, latin subset) ----------
   Archivo is one variable font file covering every weight; the display faces have a single weight each. */
const FONTS = [
  { family: "Anton", pkg: "@fontsource/anton", file: "anton-latin-400-normal.woff2", weight: "400" },
  { family: "Archivo", pkg: "@fontsource-variable/archivo", file: "archivo-latin-wght-normal.woff2", weight: "100 900" },
  { family: "Bangers", pkg: "@fontsource/bangers", file: "bangers-latin-400-normal.woff2", weight: "400" },
  { family: "Permanent Marker", pkg: "@fontsource/permanent-marker", file: "permanent-marker-latin-400-normal.woff2", weight: "400" }
];
let fontCss = "";
for (const { family, pkg, file, weight } of FONTS) {
  const src = path.join(ROOT, "node_modules", pkg, "files", file);
  if (!fs.existsSync(src)) { console.error(`Missing font file ${file}. Run npm install.`); process.exit(1); }
  wr(`fonts/${file}`, fs.readFileSync(src));
  fontCss += `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(__ROOT__fonts/${file}) format("woff2")}`;
}
const fontPreload = ["fonts/anton-latin-400-normal.woff2", "fonts/archivo-latin-wght-normal.woff2"];

/* ---------- css, js, static assets ---------- */
for (const name of ["styles", "admin"]) {
  const out = await esbuild.transform(fs.readFileSync(path.join(ROOT, `src/css/${name}.css`), "utf8"), { loader: "css", minify: true });
  wr(`css/${name}.css`, out.code);
}
const JS = { bundle: true, minify: true, format: "esm", target: "es2022", legalComments: "none", logLevel: "warning", outdir: DIST };
await esbuild.build({ ...JS, entryPoints: { "js/site": path.join(ROOT, "src/js/site.js") } });
// the staff area splits into chunks that load as each tab is first opened; the shop stays one file
await esbuild.build({ ...JS, entryPoints: { "admin/admin": path.join(ROOT, "src/admin/admin.js") }, splitting: true, chunkNames: "admin/[name]-[hash]" });
for (const f of ["flickers-logo.png", "favicon.png", "apple-touch-icon.png"]) cp(`assets/${f}`, `assets/${f}`);
wr(".nojekyll", "");

/* ---------- covers: AVIF and WebP at three sizes ----------
   Encoding is the slow part of a build, so each result is kept in .cache/ (keyed by the picture's contents and the settings)
   and only pictures that are new or changed get encoded. Bump ENCODING when the settings below change. */
const ENCODING = "1";
const SIZES = [[300, 68, 46], [450, 70, 48], [600, 72, 50]]; // width, WebP quality, AVIF quality
const CACHE = path.join(ROOT, ".cache", "covers");
fs.mkdirSync(CACHE, { recursive: true });
const images = [...new Set(products.map(p => p.image).filter(Boolean))], inUse = new Set();
await Promise.all(images.map(async img => {
  const name = coverName(img), bytes = fs.readFileSync(path.join(ROOT, img));
  const digest = crypto.createHash("sha1").update(bytes).update(ENCODING).digest("hex").slice(0, 16);
  for (const [w, webpQ, avifQ] of SIZES) {
    for (const [ext, quality] of [["webp", webpQ], ["avif", avifQ]]) {
      const kept = path.join(CACHE, `${digest}-${w}.${ext}`);
      inUse.add(path.basename(kept));
      if (!fs.existsSync(kept)) {
        const pic = sharp(bytes).rotate().resize({ width: w, withoutEnlargement: false });
        await (ext === "webp" ? pic.webp({ quality, effort: 5 }) : pic.avif({ quality, effort: 4 })).toFile(kept + ".tmp");
        fs.renameSync(kept + ".tmp", kept);
      }
      const out = path.join(DIST, "img", "covers", `${name}-${w}.${ext}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(kept, out);
    }
  }
}));
for (const old of fs.readdirSync(CACHE)) if (!inUse.has(old)) fs.rmSync(path.join(CACHE, old), { force: true }); // pictures that were replaced or removed

/* ---------- social share image ---------- */
{
  const logo = await sharp(path.join(ROOT, "assets/flickers-logo.png")).resize({ width: 640 }).toBuffer();
  const fan = featuredRaw.map(id => products.find(p => p.id === id)).filter(p => p && p.image).slice(0, 3);
  const covers = await Promise.all(fan.map(p => sharp(path.join(ROOT, p.image)).resize({ width: 220, height: 330, fit: "cover" }).toBuffer()));
  const layers = [{ input: logo, left: 64, top: 240 }];
  covers.forEach((b, i) => layers.push({ input: b, left: 760 + i * 130, top: 150 + (i === 1 ? -30 : 20) }));
  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#0E1211"/><rect y="0" width="1200" height="24" fill="#FFE912"/><rect y="606" width="1200" height="24" fill="#FFE912"/></svg>`);
  await sharp(base).composite(layers).png({ palette: true, quality: 90, effort: 7 }).toFile(path.join(DIST, "assets", "og.png"));
}

/* ---------- series: titles with more than one issue get a page listing them all ---------- */
const issueNo = p => { const m = String(p.num || p.vol || "").match(/\d+(\.\d+)?/); return m ? Number(m[0]) : Infinity; };
const seriesMap = new Map();
products.forEach(p => { const k = seriesKey(p); (seriesMap.get(k) || seriesMap.set(k, []).get(k)).push(p); });
const seriesList = [];
const slugsTaken = new Set();
for (const [key, items] of seriesMap) {
  if (items.length < 2) continue;
  items.sort((a, b) => issueNo(a) - issueNo(b) || fullTitle(a).localeCompare(fullTitle(b)));
  let sl = slug(items[0].title + (items[0].vol ? " " + items[0].vol : "")), n = 2; const base = sl;
  while (slugsTaken.has(sl)) sl = `${base}-${n++}`;
  slugsTaken.add(sl);
  seriesList.push({ key, slug: sl, title: items[0].title + (items[0].vol ? " " + items[0].vol : ""), items });
}
seriesList.sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title));
const seriesOf = {};
seriesList.forEach(sr => sr.items.forEach(p => { seriesOf[p.id] = sr; }));

/* ---------- pages ---------- */
const ctxFor = root => ({ root, cfg, cats, products, featured: featuredRaw, groups, groupBy, groupKey, seriesOf, hasSeries: seriesList.length > 0, seriesCount: seriesList.length });
const ogDefault = `${siteUrl}/assets/og.png`;
const shell = (opts) => page({ cfg, fontPreload, fontCss, ...opts });

// home
wr("index.html", shell({
  title: "Flickers Comics: independent comic shop",
  desc: DEFAULT_DESC,
  canonical: `${siteUrl}/`,
  ogImage: ogDefault,
  jsonld: { "@context": "https://schema.org", "@type": "Store", name: "Flickers Comics", url: `${siteUrl}/`, image: ogDefault, description: DEFAULT_DESC },
  body: homePage(ctxFor(""))
}));

// one page per comic
for (const p of products) {
  const root = "../../";
  const ctx = ctxFor(root);
  // the same series first, then the same publisher on the same shelf, then the same publisher, then the same shelf; in stock only
  const rank = r => (seriesOf[r.id] && seriesOf[r.id] === seriesOf[p.id] ? 8 : 0) + (r.publisher && r.publisher === p.publisher ? 3 : 0) + (r.cat === p.cat ? 2 : 0) + (r.badges && r.badges.includes("new") ? 1 : 0);
  const related = products.filter(r => r.id !== p.id && r.stock > 0 && rank(r) >= 2).sort((a, b) => rank(b) - rank(a)).slice(0, 4);
  ctx.relatedHeading = () => (related.length && related.every(r => seriesOf[r.id] && seriesOf[r.id] === seriesOf[p.id]) ? `More of ${seriesOf[p.id].title}` : "More like this");
  const t = fullTitle(p);
  const img = p.image ? `${siteUrl}/img/covers/${coverName(p.image)}-600.webp` : ogDefault;
  const desc = String(p.blurb || DEFAULT_DESC).replace(/\s+/g, " ").slice(0, 200);
  wr(`comic/${p.id}/index.html`, shell({
    title: `${t} | Flickers Comics`,
    desc,
    root,
    canonical: `${siteUrl}/comic/${p.id}/`,
    ogImage: img,
    ogType: "product",
    jsonld: {
      "@context": "https://schema.org", "@type": "Product", name: t, description: p.blurb || undefined, image: img, sku: p.id,
      brand: p.publisher ? { "@type": "Brand", name: p.publisher } : undefined,
      offers: { "@type": "Offer", url: `${siteUrl}/comic/${p.id}/`, price: p.price, availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" }
    },
    body: comicPage(p, ctx, related)
  }));
}

// series pages, and the list of them
if (seriesList.length) {
  for (const sr of seriesList) {
    const root = "../../";
    const img = (sr.items.find(p => p.image) || {}).image;
    wr(`series/${sr.slug}/index.html`, shell({
      title: `${sr.title}: all issues | Flickers Comics`,
      desc: `Every issue of ${sr.title} in stock at Flickers Comics: ${sr.items.map(p => p.num || p.vol).filter(Boolean).slice(0, 8).join(", ")}.`.slice(0, 200),
      root, canonical: `${siteUrl}/series/${sr.slug}/`, ogImage: img ? `${siteUrl}/img/covers/${coverName(img)}-600.webp` : ogDefault,
      jsonld: { "@context": "https://schema.org", "@type": "CollectionPage", name: sr.title, url: `${siteUrl}/series/${sr.slug}/`, hasPart: sr.items.map(p => ({ "@type": "Product", name: fullTitle(p), url: `${siteUrl}/comic/${p.id}/` })) },
      body: seriesPage(sr, ctxFor(root))
    }));
  }
  wr("series/index.html", shell({
    title: "Series | Flickers Comics", desc: "Titles with more than one issue on the shelves at Flickers Comics, all in one place.",
    root: "../", canonical: `${siteUrl}/series/`, ogImage: ogDefault, body: seriesIndexPage(seriesList, ctxFor("../"))
  }));
}

// 404 (GitHub Pages serves this for unknown URLs, from the site root, so it must not use relative links)
{
  const root = new URL(siteUrl + "/").pathname;
  wr("404.html", shell({
    title: "Page not found | Flickers Comics", desc: DEFAULT_DESC, root, noindex: true,
    body: notFoundPage(ctxFor(root))
  }));
}

// staff manager
wr("admin/index.html", adminPage({ cfg, fontCss }));

/* ---------- data for the browser, sitemap, robots ---------- */
wr("data/shop.json", JSON.stringify({
  config: { postage: cfg.postage, openHour: cfg.openHour, closeHour: cfg.closeHour, timeZone: cfg.timeZone, collectDaysAhead: cfg.collectDaysAhead, testMode: cfg.testMode, orderApi: cfg.orderApi || "", payOnline: !!cfg.payOnline, deal: cfg.deal || null },
  categories: cats, featured: featuredRaw, groupBy, products
}));
const today = new Date().toISOString().slice(0, 10);
wr("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + [`${siteUrl}/`, ...(seriesList.length ? [`${siteUrl}/series/`, ...seriesList.map(sr => seriesUrl(siteUrl + "/", sr))] : []), ...products.map(p => `${siteUrl}/comic/${p.id}/`)].map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join("\n") + `\n</urlset>\n`);
wr("robots.txt", `User-agent: *\nAllow: /\nDisallow: ${new URL(siteUrl + "/").pathname}admin/\n\nSitemap: ${siteUrl}/sitemap.xml\n`);

console.log(`Built ${products.length} comics, ${images.length} covers, ${groups.length} shelves (by ${groupBy}), ${seriesList.length} series into dist/`);
