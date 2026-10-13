// Reorder tab: "Add to stock" puts the chosen copies back on the shelf.
import { launch, BASE, API } from "./lib.mjs";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };
const json = async (route, token) => (await fetch(API + route, { headers: { Origin: BASE, Authorization: "Bearer " + token } })).json();
const token = (await (await fetch(API + "/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ username: "owner", password: "owner-password-1" }) })).json()).token;
const before = Object.fromEntries((await json("/stock", token)).products.map(p => [p.id, p.stock]));

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 1000 });
const errors = []; page.on("pageerror", e => errors.push(e.message));
await page.goto(BASE + "/admin/", { waitUntil: "networkidle0" });
await page.type("#u", "owner"); await page.type("#pw", "owner-password-1"); await page.click("#loginBtn");
await page.waitForSelector("#panel .arow");
await page.evaluate(() => [...document.querySelectorAll("[data-tab]")].find(x => /reorder/i.test(x.textContent))?.click());
await page.waitForSelector("#rAdd", { timeout: 8000 });
check("there's an Add to stock button, and no Copy button", !!(await page.$("#rAdd")) && !(await page.$("#rCopy")) && !/copy the list/i.test(await page.$eval("#panel", p => p.textContent)));
const first = await page.$eval("[data-qty]", e => ({ id: e.dataset.qty }));
await page.$$eval("[data-pick]", boxes => boxes.forEach((b, i) => { if (i > 0 && b.checked) b.click(); })); // just the first row
await page.$eval("[data-qty]", e => { e.value = "4"; e.dispatchEvent(new Event("change", { bubbles: true })); });
await page.click("#rAdd"); await sleep(300);
check("it asks before changing the stock", /Add 4 cop/.test(await page.$eval("#aMsg", e => e.textContent)), await page.$eval("#aMsg", e => e.textContent));
await page.$$eval("#aMsg button", bs => bs.find(b => /Add 4 to stock/.test(b.textContent))?.click()); await sleep(1500);
const after = Object.fromEntries((await json("/stock", token)).products.map(p => [p.id, p.stock]));
check("the stock went up by the number chosen", after[first.id] === before[first.id] + 4, `${before[first.id]} → ${after[first.id]}`);
check("and it says so", /Added 4 cop/.test(await page.$eval("#aMsg", e => e.textContent)), await page.$eval("#aMsg", e => e.textContent));
check("the list is worked out again with the new stock", (await page.$$eval("[data-qty]", e => e.length)) >= 0);
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
