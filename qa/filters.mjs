import { launch } from "./lib.mjs";
const BASE = process.argv[2] || "http://localhost:8080";
const TOTAL = (await (await fetch(BASE + "/data/shop.json")).json()).products.length;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push(!!ok); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = []; page.on("pageerror", e => errors.push(e.message));
await page.goto(BASE + "/", { waitUntil: "networkidle0" });
const shown = () => page.$$eval(".card:not([hidden])", c => c.length);
const results_ = () => page.$eval("#results", e => e.textContent);
const type = async s => { await page.$eval("#q", (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, s); await sleep(150); };

const numbered = (await (await fetch(BASE + "/data/shop.json")).json()).products.find(p => p.num && /\d/.test(p.num) && /^[a-z]{3}/i.test(p.title));
const nq = numbered.title.slice(0, 3).toLowerCase() + " " + String(numbered.num).replace(/\D/g, "");
await type(nq);
check(`'${nq}' finds ${numbered.title} ${numbered.num}`, (await page.$$eval(".card:not([hidden])", c => c.map(x => x.dataset.id))).includes(numbered.id));
await type("batmn");
check("a typo finds Batman and says they're close matches", (await shown()) >= 1 && (await results_()).includes("close matches"), await results_());
await type("zzzzqq");
check("nonsense shows the empty message", (await shown()) === 0 && !(await page.$eval("#empty", e => e.hidden)));
await page.$eval("#clearSearch", b => b.click()); await sleep(150);
check("'clear the search and filters' resets everything", (await shown()) === TOTAL && (await page.$eval("#q", e => e.value)) === "");

// chips
const total = await shown();
await page.$eval('[data-chip="instock"]', b => b.click()); await sleep(100);
const inStock = await shown();
const SHOP = await (await fetch(BASE + "/data/shop.json")).json(), P = Object.fromEntries(SHOP.products.map(p => [p.id, p]));
const shownIds = () => page.$$eval(".card:not([hidden])", c => c.map(x => x.dataset.id));
check("In stock hides sold out comics", inStock <= total && (await shownIds()).every(id => P[id].stock > 0));
await page.$eval('[data-chip="last"]', b => b.click()); await sleep(100);
const lastN = await shown();
const anyLast = SHOP.products.some(p => p.stock >= 1 && p.stock <= 2); // nothing to show if no comic is down to its last copies
check("Last copies shows only 1 or 2 left", (!anyLast ? lastN === 0 : lastN > 0 && lastN < total) && (await shownIds()).every(id => P[id].stock >= 1 && P[id].stock <= 2), `${lastN}`);
check("clear filters button appears", !(await page.$eval("#clearFilters", e => e.hidden)));
check("address bar records the filters", page.url().includes("instock=1") && page.url().includes("last=1"), page.url());
await page.$eval("#clearFilters", b => b.click()); await sleep(100);
check("clear filters restores all", (await shown()) === total && (await page.$eval("#clearFilters", e => e.hidden)));
await page.$eval('[data-chip="novar"]', b => b.click()); await sleep(100);
check("Hide variants removes variants", (await shownIds()).every(id => !P[id].variant && !(P[id].badges || []).includes("variant")) && (await shown()) < total, `${await shown()}`);
await page.$eval('[data-chip="novar"]', b => b.click());
const opts = await page.$$eval("#maxPrice option", o => o.map(x => +x.value));
await page.select("#maxPrice", String(opts[1])); await sleep(100);
check("price cap works", (await shownIds()).every(id => P[id].price <= opts[1]), `<= ${opts[1]} → ${await shown()} shown (steps ${opts.join(",")})`);
// shared link restores the filters
await page.goto(`${BASE}/?instock=1&max=${opts[1]}&q=a`, { waitUntil: "networkidle0" }); await sleep(300);
check("a link restores chips, price cap and search", (await page.$eval('[data-chip="instock"]', b => b.getAttribute("aria-pressed")) === "true") && (await page.$eval("#maxPrice", e => +e.value)) === opts[1] && (await page.$eval("#q", e => e.value)) === "a");
check("no script errors", errors.length === 0, errors.join(" | "));
await browser.close();
const bad = results.filter(x => !x).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
