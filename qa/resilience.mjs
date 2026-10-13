/* What a visitor gets when things go wrong: the stock data won't load, JavaScript is off, the order service is down. */
import { launch, OUT } from "./lib.mjs";
const BASE = process.argv[2] || "http://localhost:8080";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };
const browser = await launch();
const out = n => `${OUT}/${n}.png`;

// 1. stock data fails to load
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", r => (r.url().includes("/data/shop.json") ? r.abort("failed") : r.continue()));
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle0" });
  await sleep(500);
  check("without stock data the shelves still show", (await page.$$eval(".card", c => c.length)) > 0);
  check("no script errors without stock data", errors.length === 0, errors.join(" | "));
  await page.$eval(".add", b => b.click()); await sleep(400);
  check("the cart stays empty", (await page.$eval("#cartCount", e => e.textContent)) === "0");
  const notices = await page.$$eval("[role=status], [role=alert], .notice, .toast", els => els.map(e => e.textContent.trim()).filter(Boolean));
  check("a notice explains ordering is paused and offers Try again", notices.some(t => /ordering is paused/.test(t) && /Try again/.test(t)), JSON.stringify(notices));
  await page.screenshot({ path: out("res-noshop") });
  await page.close();
}

// 2. JavaScript disabled
{
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "networkidle0" });
  check("with JavaScript off the shelves are there", (await page.$$eval(".card", c => c.length)) > 0);
  const visible = await page.evaluate(() => ({
    add: [...document.querySelectorAll(".add")].filter(e => getComputedStyle(e).display !== "none").length,
    cart: getComputedStyle(document.querySelector("#cartBtn")).display,
    note: [...document.querySelectorAll(".page-note")].some(e => getComputedStyle(e).display !== "none")
  }));
  check("Add buttons and the cart are hidden rather than dead", visible.add === 0 && visible.cart === "none", JSON.stringify(visible));
  check("a note says JavaScript is needed to order", visible.note);
  await page.screenshot({ path: out("res-nojs") });
  await page.goto(BASE + "/comic/batman-14/", { waitUntil: "networkidle0" });
  check("a comic page reads fine without JavaScript", (await page.$eval("h1", e => e.textContent)) === "Batman #14");
  await page.screenshot({ path: out("res-nojs-comic") });
  await page.close();
}

// 3. the order service is down at checkout time (this check needs the build that points at the real service address)
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.setRequestInterception(true);
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "POST" };
  page.on("request", r => {
    if (!r.url().includes("workers.dev/orders")) { r.continue(); return; }
    if (r.method() === "OPTIONS") r.respond({ status: 204, headers: cors });
    else r.respond({ status: 503, contentType: "application/json", headers: cors, body: JSON.stringify({ error: "Couldn't check the shop's stock just now. Try again in a moment." }) });
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: "networkidle0" });
  await page.$eval(".add", b => b.click()); await sleep(200);
  await page.$eval("#cartBtn", b => b.click()); await sleep(300);
  await page.$eval("#checkoutBtn", b => b.click()); await sleep(300);
  await page.type("#f-name", "QA Tester"); await page.type("#f-phone", "5550142");
  await page.$eval("#f-date", el => { el.value = el.min; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval("#payBtn", b => b.click()); await sleep(900);
  const err = await page.$$eval(".form-error", els => els.map(e => e.textContent.trim()).filter(Boolean));
  check("the service's message is shown at checkout", err.some(t => /Couldn't check the shop's stock/.test(t)), JSON.stringify(err));
  check("the cart is kept", (await page.$eval("#cartCount", e => e.textContent)) === "1");
  const btn = await page.$eval("#payBtn", b => ({ text: b.textContent, disabled: b.disabled }));
  check("the order button is usable again", /^(Place order|Pay .* with Fleeca)$/.test(btn.text) && !btn.disabled, JSON.stringify(btn));
  await page.screenshot({ path: out("res-503") });
  await page.close();
}
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
