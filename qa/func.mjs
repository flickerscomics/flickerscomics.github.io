// Functional checks of the storefront in a real browser. Network calls to the live order service are intercepted.
import { launch } from "./lib.mjs";
const BASE = process.argv[2] || "http://localhost:8080";
const TOTAL = (await (await fetch(BASE + "/data/shop.json")).json()).products.length; // however many comics are in the shop right now
const browser = await launch();
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newPage(width = 1280, height = 900) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.setRequestInterception(true);
  page.orderPosts = [];
  page.on("request", req => {
    if (req.url().includes("workers.dev/orders") && req.method() === "POST") {
      page.orderPosts.push(JSON.parse(req.postData()));
      req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ orderId: "FC-TEST12", subtotal: 900, postage: 0, total: 900, paid: false }) });
    } else if (req.url().includes("workers.dev") && req.method() === "OPTIONS") {
      req.respond({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "POST" } });
    } else req.continue();
  });
  page.errors = errors;
  return page;
}

/* ---- shelf: filters, URL state, keyboard ---- */
{
  const page = await newPage();
  // the shop groups its shelves by category (or by publisher when every comic is the same kind): take the largest one from the data
  const shopData = await (await fetch(BASE + "/data/shop.json")).json();
  const keyOf = p => shopData.groupBy === "cat" ? p.cat : (p.publisher || "Other");
  const counts = shopData.products.reduce((m, p) => m.set(keyOf(p), (m.get(keyOf(p)) || 0) + 1), new Map());
  const [SHELF, SHELF_COUNT] = [...counts].sort((a, b) => b[1] - a[1])[0];
  await page.goto(BASE + "/?shelf=" + encodeURIComponent(SHELF) + "&sort=price-asc", { waitUntil: "networkidle0" });
  const shown = () => page.$$eval(".card:not([hidden])", c => c.length);
  check("a shared link opens on that shelf", (await shown()) === SHELF_COUNT, "shown=" + await shown());
  check("tab for the shelf is pressed", await page.$eval(`.divider[data-group="${SHELF}"]`, b => b.getAttribute("aria-pressed") === "true"));
  const prices = await page.$$eval(".card:not([hidden]) .price-tag", els => els.map(e => +e.textContent.replace(/\D/g, "")));
  check("sorted low to high", prices.every((p, i) => i === 0 || p >= prices[i - 1]), prices.slice(0, 5).join(","));
  check("page did not jump on load", (await page.evaluate(() => scrollY)) < 50, "scrollY=" + await page.evaluate(() => scrollY));
  await page.click('.divider[data-group="all"]'); await sleep(200);
  check("Everything tab shows every comic", (await shown()) === TOTAL);
  check("address bar cleared of shelf", !(await page.url()).includes("shelf="), page.url());
  await page.type("#q", "batman"); await sleep(300);
  check("search narrows and goes in the address", (await shown()) >= 1 && (await shown()) < 10 && page.url().includes("q=batman"), `shown=${await shown()} url=${page.url()}`);
  await page.$eval("#q", el => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); }); await sleep(200);
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("/"); await sleep(200);
  check("pressing / focuses the search box", await page.evaluate(() => document.activeElement.id === "q"));
  // clicking card text does not change the filter (regression)
  await page.evaluate(() => document.activeElement.blur());
  await page.$eval(".card .price-tag", el => el.click()); await sleep(150);
  check("clicking a price tag does not filter the shelf", (await shown()) === TOTAL);
  check("no script errors on the home page", page.errors.length === 0, page.errors.join(" | "));
  await page.close();
}

/* ---- cart, quick view, checkout (live path, intercepted) ---- */
{
  const page = await newPage(390, 844);
  await page.goto(BASE + "/", { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await page.$$eval(".add", b => { b[0].click(); b[0].click(); b[3].click(); }); await sleep(300);
  check("cart counts 3 items", (await page.$eval("#cartCount", e => e.textContent)) === "3");
  await page.$eval("#cartBtn", b => b.click()); await sleep(300);
  check("cart drawer lists 2 lines", (await page.$$eval("#lines .line", l => l.length)) === 2);
  await page.$eval("#checkoutBtn", b => b.click()); await sleep(300);
  check("checkout opens without the test banner", await page.$eval("#testNote", e => e.hidden));
  check("button says what will happen", /^(Place order|Pay .* with Fleeca)$/.test(await page.$eval("#payBtn", b => b.textContent)));
  await page.$eval("#payBtn", b => b.click()); await sleep(200);
  check("empty form shows errors", (await page.$$eval(".error:not([hidden])", e => e.length)) >= 2);
  await page.type("#f-name", "QA Tester"); await page.type("#f-phone", "5550142");
  await page.$eval("#f-date", el => { el.value = el.min; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval("#payBtn", b => b.click()); await sleep(900);
  check("order sent with only ids and quantities", page.orderPosts.length === 1 && page.orderPosts[0].items.every(i => Object.keys(i).sort().join() === "id,qty"), JSON.stringify(page.orderPosts[0] && page.orderPosts[0].items));
  check("confirmation shows the server's order number", (await page.$eval(".ticket", e => e.textContent)).includes("FC-TEST12"));
  check("confirmation has a Copy button", !!(await page.$("[data-copy]")));
  check("cart is emptied after ordering", (await page.$eval("#cartCount", e => e.textContent)) === "0");
  check("no script errors in the ordering flow", page.errors.length === 0, page.errors.join(" | "));
  await page.close();
}

/* ---- comic page ---- */
{
  const page = await newPage(390, 844);
  await page.goto(BASE + "/comic/batman-14/", { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());
  const buy = await page.$('[data-qv="add"]');
  check("comic page has an Add to cart button", !!buy);
  await buy.click(); await sleep(300);
  check("adding from a comic page updates the cart", (await page.$eval("#cartCount", e => e.textContent)) === "1");
  const stuck = await page.$eval(".qv-buy", e => getComputedStyle(e).position);
  check("add-to-cart bar is pinned on phones", stuck === "sticky", stuck);
  check("no script errors on a comic page", page.errors.length === 0, page.errors.join(" | "));
  await page.close();
}

/* ---- 404 ---- */
{
  const page = await newPage();
  const res = await page.goto(BASE + "/nope/", { waitUntil: "networkidle0" });
  check("unknown address gives the 404 page", res.status() === 404 && (await page.$eval("h1", e => e.textContent)).includes("Not on the shelves"));
  await page.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
