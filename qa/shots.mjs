// Takes screenshots of the local site for a visual check: node shots.mjs <outdir> [path]
import { launch } from "./lib.mjs";
import fs from "node:fs";
const out = process.argv[2] || "shots", path = process.argv[3] || "/";
fs.mkdirSync(out, { recursive: true });
const browser = await launch();
for (const [name, w, h] of [["desktop", 1280, 900], ["phone", 390, 844]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto("http://localhost:8080" + path, { waitUntil: "networkidle0" });
  await page.screenshot({ path: `${out}/${name}-top.png` });
  await page.evaluate(() => document.querySelector("#shop")?.scrollIntoView());
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: `${out}/${name}-shop.png` });
  await page.evaluate(() => window.scrollBy(0, h => h, 0));
  await page.close();
}
await browser.close();
