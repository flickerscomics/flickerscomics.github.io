import { launch } from "./lib.mjs";
const out = process.argv[2];
const browser = await launch();
for (const [name, w, h, mobile] of [["d", 1280, 900, false], ["m", 390, 844, true]]) {
  const page = await browser.newPage(); await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
  await page.goto("http://localhost:8080", { waitUntil: "networkidle0" });
  await page.evaluate(() => document.querySelector(".types")?.scrollIntoView()); await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: `${out}/${name}-tiles.png` });
  await page.evaluate(() => document.querySelector("#how")?.scrollIntoView()); await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: `${out}/${name}-how2.png` });
}
await browser.close();
