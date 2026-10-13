// The Publisher menu: filters the shelves by publisher, works with the kind tabs, the address bar and "Clear filters".
import { launch } from "./lib.mjs";
const BASE = "http://localhost:8080";
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };

const shop = await (await fetch(BASE + "/data/shop.json")).json();
const pubOf = p => p.publisher || "Other";
const counts = shop.products.reduce((m, p) => m.set(pubOf(p), (m.get(pubOf(p)) || 0) + 1), new Map());
const [PUB, PUB_COUNT] = [...counts].sort((a, b) => b[1] - a[1])[0];

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(BASE + "/", { waitUntil: "networkidle0" });
const shown = () => page.$$eval(".card:not([hidden])", c => c.length);

if (shop.groupBy === "cat" && counts.size > 1) {
  const opts = await page.$$eval("#pubFilter option", o => o.map(x => x.value));
  check("the menu lists every publisher in the shop", opts.length === counts.size + 1 && [...counts.keys()].every(k => opts.includes(k)), `${opts.length - 1} of ${counts.size}`);
  await page.select("#pubFilter", PUB); await new Promise(r => setTimeout(r, 200));
  check("choosing a publisher shows only its comics", (await shown()) === PUB_COUNT, `${await shown()} of ${PUB_COUNT}`);
  check("and it goes in the address bar", page.url().includes("pub="), page.url());
  check("the results line says so", (await page.$eval("#results", e => e.textContent)).includes("from " + PUB));
  // together with a kind tab
  const cat = shop.products.find(p => pubOf(p) === PUB).cat;
  const both = shop.products.filter(p => pubOf(p) === PUB && p.cat === cat).length;
  await page.click(`.divider[data-group="${cat}"]`); await new Promise(r => setTimeout(r, 200));
  check("it combines with the kind tabs", (await shown()) === both, `${await shown()} of ${both}`);
  await page.click('.divider[data-group="all"]');
  await page.click("#clearFilters"); await new Promise(r => setTimeout(r, 200));
  check("Clear filters resets it", (await shown()) === shop.products.length && !page.url().includes("pub=") && (await page.$eval("#pubFilter", s => s.value)) === "", `${await shown()}`);
  // a shared link
  await page.goto(BASE + "/?pub=" + encodeURIComponent(PUB), { waitUntil: "networkidle0" });
  check("a shared link opens on that publisher", (await shown()) === PUB_COUNT && (await page.$eval("#pubFilter", s => s.value)) === PUB, `${await shown()}`);
  await page.goto(BASE + "/?pub=Nonexistent%20Press", { waitUntil: "networkidle0" });
  check("an unknown publisher in a link is ignored", (await shown()) === shop.products.length);
} else {
  check("with only one kind of comic the publishers are the tabs themselves", !(await page.$("#pubFilter")) && (await page.$$(".divider")).length > 1);
}
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
