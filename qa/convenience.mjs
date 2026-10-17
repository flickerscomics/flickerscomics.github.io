// Shopper conveniences: search suggestions, "Newest arrivals", the pinned cart bar on phones, remembered details, copy order details, "More like this".
import { launch, BASE } from "./lib.mjs";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };

const shop = await (await fetch(BASE + "/data/shop.json")).json();
const stocked = shop.products.filter(p => p.stock > 2);
const A = stocked[0];
const word = (A.title.split(/\s+/).find(w => w.length >= 4) || A.title).slice(0, 4).toLowerCase();

const browser = await launch();
const errors = [];
const mk = async (w, h) => { const p = await browser.newPage(); await p.setViewport({ width: w, height: h }); p.on("pageerror", e => errors.push(e.message)); return p; };

/* ---- desktop: suggestions and sorting ---- */
const d = await mk(1280, 900);
await d.goto(BASE + "/", { waitUntil: "networkidle0" });
await d.evaluate(() => localStorage.clear());
await d.reload({ waitUntil: "networkidle0" });
await d.type("#q", word); await sleep(300);
const sug = await d.$$eval("#qSuggest li", l => l.map(x => x.textContent));
check("typing a few letters suggests matching comics", sug.length > 0 && sug.length <= 6, `${sug.length} for "${word}"`);
check("the list is announced as a combobox", await d.$eval("#q", q => q.getAttribute("aria-expanded") === "true" && q.getAttribute("role") === "combobox"));
await d.keyboard.press("ArrowDown"); await d.keyboard.press("ArrowDown");
check("arrow keys move through it", await d.$eval("#q", q => q.getAttribute("aria-activedescendant") === "sug-1") || sug.length === 1);
await d.keyboard.press("Escape"); await sleep(100);
check("Escape closes it", await d.$eval("#qSuggest", u => u.hidden));
await d.$eval("#q", q => { q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); });
await d.type("#q", word); await sleep(300);
await d.keyboard.press("ArrowDown"); await d.keyboard.press("Enter"); await sleep(300);
const typed = await d.$eval("#q", q => q.value);
check("choosing one fills the search with its full title and shows it", typed.length > word.length && (await d.$$eval(".card:not([hidden])", c => c.length)) >= 1, typed);
check("the list closes after choosing", await d.$eval("#qSuggest", u => u.hidden));
await d.$eval("#q", q => { q.value = "zzzzqx"; q.dispatchEvent(new Event("input", { bubbles: true })); }); await sleep(200);
check("no suggestions for nonsense", await d.$eval("#qSuggest", u => u.hidden));
await d.$eval("#clearSearch", b => b.click());
const opts = await d.$$eval("#sort option", o => o.map(x => x.value));
check("the sort menu has Newest arrivals", opts.includes("newest"), opts.join(","));
await d.select("#sort", "newest"); await sleep(300);
check("sorting by newest works and goes in the address", d.url().includes("sort=newest") && (await d.$$eval(".card:not([hidden])", c => c.length)) === shop.products.length);

/* ---- comic page: more like this ---- */
await d.goto(BASE + `/comic/${A.id}/`, { waitUntil: "networkidle0" });
const more = await d.$$eval(".more .card", c => c.length);
const peers = shop.products.filter(p => p.id !== A.id && p.stock > 0 && (p.cat === A.cat || (p.publisher && p.publisher === A.publisher))).length;
check("a comic page suggests other comics", more === Math.min(4, peers) && (peers === 0 || more > 0), `${more} of ${peers} possible`);
check("and never suggests the comic itself", !(await d.$$eval(".more .card", (c, id) => c.some(x => x.dataset.id === id), A.id)));

/* ---- phone: pinned cart bar, remembered details, copy order details ---- */
const m = await mk(390, 844);
await m.goto(BASE + "/", { waitUntil: "networkidle0" });
await m.evaluate(() => localStorage.clear());
await m.reload({ waitUntil: "networkidle0" });
check("no cart bar while the cart is empty", await m.$eval("#cartBar", b => b.hidden));
await m.$eval(`[data-add="${A.id}"]`, b => b.click()); await sleep(300);
check("adding a comic shows the cart bar at the bottom of the screen", await m.$eval("#cartBar", b => { const r = b.getBoundingClientRect(); return !b.hidden && getComputedStyle(b).display !== "none" && Math.abs(r.bottom - innerHeight) < 2; }));
check("it shows the count and total", /1 item/.test(await m.$eval("#cartBarText", e => e.textContent)), await m.$eval("#cartBarText", e => e.textContent));
check("it doesn't cover the back-to-top button", await m.evaluate(() => { const t = document.getElementById("toTop"), b = document.getElementById("cartBar").getBoundingClientRect(); return t.hidden || t.getBoundingClientRect().bottom <= b.top + 20; }));
await m.$eval("#cartBarBtn", b => b.click()); await sleep(400);
check("pressing it opens the cart", await m.$eval("#drawer", d => d.open));
await m.$eval("#checkoutBtn", b => b.click()); await sleep(300);
await m.type("#f-name", "Remember Me"); await m.type("#f-phone", "555 0199");
await m.$eval("#f-date", el => { el.value = el.min; el.dispatchEvent(new Event("input", { bubbles: true })); });
await m.$eval("#payBtn", b => b.click());
await m.waitForSelector(".ticket strong", { timeout: 15000 });
const copies = await m.$$eval(".ticket [data-copy]", b => b.map(x => x.dataset.copy));
check("the confirmation can copy the number and the order details", copies.length === 2 && /^FC-/.test(copies[0]) && copies[1].includes(copies[0]) && /Total \$/.test(copies[1]) && /Collect/.test(copies[1]), copies[1] && copies[1].replace(/\n/g, " | "));
await m.$eval("#coDoneView [data-close]", b => b.click()); await sleep(300);
await m.reload({ waitUntil: "networkidle0" });
await m.$eval(`[data-add="${A.id}"]`, b => b.click()); await sleep(300);
await m.$eval("#cartBarBtn", b => b.click()); await sleep(300);
await m.$eval("#checkoutBtn", b => b.click()); await sleep(300);
check("next time the name and phone are already filled in", (await m.$eval("#f-name", e => e.value)) === "Remember Me" && (await m.$eval("#f-phone", e => e.value)) === "555 0199");
check("the 'remember me' box is ticked", await m.$eval("#f-remember", e => e.checked));
await m.$eval("#f-remember", e => e.click());
await m.$eval("#f-date", el => { el.value = el.min; el.dispatchEvent(new Event("input", { bubbles: true })); });
await m.$eval("#payBtn", b => b.click());
await m.waitForSelector(".ticket strong", { timeout: 15000 });
check("unticking it forgets them", await m.evaluate(() => localStorage.getItem("flickers-customer") === null));

/* ---- desktop: the cart bar stays out of the way ---- */
await d.goto(BASE + "/", { waitUntil: "networkidle0" });
await d.$eval(`[data-add="${A.id}"]`, b => b.click()); await sleep(300);
check("on a computer the cart bar isn't shown", await d.$eval("#cartBar", b => getComputedStyle(b).display === "none"));

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
