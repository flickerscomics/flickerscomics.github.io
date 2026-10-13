// Phone-sized screenshots of the main screens, for a visual check: node mobile.mjs <outdir> [width] [scheme]
import { launch } from "./lib.mjs";
import fs from "node:fs";
const out = process.argv[2] || "shots", W = Number(process.argv[3]) || 390, scheme = process.argv[4] || "dark";
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: W, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
await page.goto("http://localhost:8080", { waitUntil: "networkidle0" });
const shot = async name => { await sleep(350); await page.screenshot({ path: `${out}/m-${name}.png` }); };
const to = async sel => { await page.evaluate(s => { const e = document.querySelector(s); if (e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 80); }, sel); };
await shot("1-top");
await page.evaluate(() => window.scrollTo(0, 700)); await shot("2-hero-end");
await to(".types"); await shot("3-tiles");
await to("#shop"); await shot("4-shop-head");
await page.evaluate(() => window.scrollBy(0, 560)); await shot("5-filters-cards");
await to("#how"); await shot("6-how");
await to("#hours"); await shot("7-hours");
await to(".site-footer"); await shot("8-footer");
// a select open state can't be screenshotted, so check its colours instead
const colours = await page.evaluate(() => { const s = document.querySelector("#pubFilter"), o = s && s.querySelector("option"); const cs = el => el && getComputedStyle(el); return s ? { select: [cs(s).color, cs(s).backgroundColor], option: [cs(o).color, cs(o).backgroundColor], scheme: cs(s).colorScheme } : null; });
console.log(JSON.stringify(colours));
// cart drawer and quick view
await page.evaluate(() => window.scrollTo(0, 0));
await to("#shop"); await sleep(200);
await page.evaluate(() => document.querySelector("[data-add]")?.click()); await sleep(300);
await page.evaluate(() => document.querySelector(".cart-btn")?.click()); await sleep(500); await shot("9-cart");
await page.evaluate(() => document.querySelector("#drawer, .drawer")?.close?.()); await sleep(300);
await page.evaluate(() => document.querySelector("[data-open]")?.click()); await sleep(600); await shot("10-quickview");
await browser.close();
