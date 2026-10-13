// Bulk "Set labels" in the Stock tab: select several comics, then add or remove New / Variant / Exclusive / New this week.
import { launch } from "./lib.mjs";
const BASE = "http://localhost:8080";
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(BASE + "/admin/", { waitUntil: "networkidle0" });
await page.type("#u", "owner"); await page.type("#pw", "owner-password-1");
await page.click("#loginBtn"); await page.waitForSelector("#panel .arow", { timeout: 8000 });

const pills = sel => page.$$eval(sel, els => els.map(e => e.textContent.trim()));
const weekCount = () => page.$$eval("#aList .pill-week", e => e.length);
const bulk = async (picks) => {
  await page.click('[data-bulk="labels"]');
  await page.waitForSelector("#bulkForm");
  for (const [k, v] of Object.entries(picks)) await page.select("#b-l-" + k, v);
  await page.click('#bulkForm button[type="submit"]');
  await new Promise(r => setTimeout(r, 200));
};

// pick the first 5 rows
const boxes = await page.$$("#aList .arow-sel");
for (const b of boxes.slice(0, 5)) await b.click();
check("bulk bar shows a Set labels button", !!(await page.$('[data-bulk="labels"]')) && !(await page.$eval("#bulkBar", e => e.hidden)));

await page.click('[data-bulk="labels"]'); await page.waitForSelector("#bulkForm");
await page.click('#bulkForm button[type="submit"]');
check("choosing nothing gives a message and keeps the dialog open", (await page.$eval("#bulkError", e => e.textContent)).length > 0 && !!(await page.$("#bulkForm")));
await page.keyboard.press("Escape");

await bulk({ exclusive: "add", variant: "add" });
let ex = (await pills("#aList .arow")).filter(t => /Exclusive/.test(t) && /Variant/.test(t)).length;
check("five comics now carry Exclusive and Variant", ex === 5, String(ex));

await bulk({ variant: "remove" });
ex = (await pills("#aList .arow")).filter(t => /Variant/.test(t)).length;
check("removing Variant from the selection clears it", ex === 0, String(ex));

const before = await weekCount();
await bulk({ week: "add" });
const firstFive = await page.$$eval("#aList .arow", rows => rows.slice(0, 5).map(r => /New this week/.test(r.textContent)));
check("adding five to New this week: the first three of them show it, as the shop only shows three", (await weekCount()) === 3 && firstFive.slice(0, 3).every(Boolean), `${before} -> ${await weekCount()} ${firstFive}`);
const msg = await page.$eval("#panel [role=status], .say, #adminMsg", e => e.textContent).catch(() => "");
check("it explains that only three show", /only the first three show/.test(await page.evaluate(() => document.body.innerText)), msg.slice(0, 80));

await bulk({ week: "remove", exclusive: "remove" });
check("removing takes them off New this week and removes Exclusive", (await weekCount()) === before && !firstFive.slice(0, 5).every(Boolean) && !(await pills("#aList .arow")).some(t => /Exclusive/.test(t)));

const publishLabel = await page.evaluate(() => document.body.innerText.includes("Publish changes"));
check("changes wait for Publish (nothing saved yet)", publishLabel);
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
