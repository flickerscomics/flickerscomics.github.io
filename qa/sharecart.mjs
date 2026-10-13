import { launch } from "./lib.mjs";
const BASE = process.argv[2] || "http://localhost:8080";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push(!!ok); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };
const shop = await (await fetch(BASE + "/data/shop.json")).json();
const [A, B] = shop.products.filter(p => p.stock >= 3);
const browser = await launch();
const errors = [];
async function fresh(width = 390, height = 844) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  page.on("pageerror", e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => { window.__copied = null; Object.defineProperty(navigator, "clipboard", { value: { writeText: async t => { window.__copied = t; } }, configurable: true }); });
  return page;
}
const cartCount = p => p.$eval("#cartCount", e => +e.textContent);
const toastText = p => p.$eval("#toast", e => (e.hidden ? "" : e.textContent));

// 1. build a cart and copy its link
const a = await fresh();
await a.goto(BASE + "/", { waitUntil: "networkidle0" });
await a.$eval(`[data-add="${A.id}"]`, b => { b.click(); b.click(); });
await a.$eval(`[data-add="${B.id}"]`, b => b.click()); await sleep(300);
await a.$eval("#cartBtn", b => b.click()); await sleep(300);
check("drawer offers a share link", !!(await a.$("[data-share-cart]")));
await a.$eval("[data-share-cart]", b => b.click()); await sleep(200);
const link = await a.evaluate(() => window.__copied);
check("link copied with ids and quantities", link && link.includes(`cart=${A.id}:2,${B.id}:1`), link);
check("toast confirms the copy", (await toastText(a)).includes("Cart link copied"));

// 2. a friend opens it
const b = await fresh();
await b.goto(link, { waitUntil: "networkidle0" }); await sleep(400);
check("friend's cart has the 3 comics", (await cartCount(b)) === 3, `${await cartCount(b)}`);
check("toast says where they came from", (await toastText(b)).includes("shared cart"));
check("the cart parameter is removed from the address", !b.url().includes("cart="), b.url());
await b.reload({ waitUntil: "networkidle0" }); await sleep(300);
check("reloading doesn't add them again", (await cartCount(b)) === 3);

// 3. merging with an existing cart, and keeping other parameters
const c = await fresh();
await c.goto(BASE + "/", { waitUntil: "networkidle0" });
await c.$eval(`[data-add="${A.id}"]`, x => x.click()); await sleep(200);
await c.goto(`${BASE}/?shelf=${encodeURIComponent(shop.groupBy === "cat" ? A.cat : (A.publisher || "Other"))}&cart=${A.id}:1`, { waitUntil: "networkidle0" }); await sleep(400);
check("shared comics are added to what they already had", (await cartCount(c)) === 2, `${await cartCount(c)}`);
check("other address parameters survive", c.url().includes("shelf="), c.url());

// 4. hostile and broken links
const d = await fresh();
await d.goto(`${BASE}/?cart=constructor:5,__proto__:1,toString:2,nope:3,${A.id}:99999,${B.id}:abc,,:::`, { waitUntil: "networkidle0" }); await sleep(400);
check("junk entries are ignored and quantity is capped to stock", (await cartCount(d)) === A.stock, `${await cartCount(d)} vs ${A.stock}`);
check("no script errors from a hostile link", errors.length === 0, errors.join(" | "));
const e = await fresh();
await e.goto(`${BASE}/?cart=nope:3,alsonope:1`, { waitUntil: "networkidle0" }); await sleep(400);
check("a link with nothing available explains why", (await cartCount(e)) === 0 && (await toastText(e)).includes("sold out or no longer"));

// 5. works from a comic page link too
const f = await fresh();
await f.goto(`${BASE}/comic/batman-14/?cart=${A.id}:1`, { waitUntil: "networkidle0" }); await sleep(400);
check("works on a comic page", (await cartCount(f)) === 1);

check("no script errors", errors.length === 0, errors.join(" | "));
await browser.close();
const bad = results.filter(x => !x).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
