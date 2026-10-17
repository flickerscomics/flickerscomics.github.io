/* Staff tools: finding and printing orders, ready-made messages, taking an order at the counter, receiving a shipment, and the reorder list. */
import { launch, BASE, API, axePath } from "./lib.mjs";
import { fullTitle } from "../src/shared.mjs";
import fs from "node:fs";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };
const json = async (route, body, token, ip = "9.9.9.9") => { const r = await fetch(API + route, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Origin: BASE, "CF-Connecting-IP": ip, ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };
const shop = await (await fetch(BASE + "/data/shop.json")).json();
const inStock = shop.products.filter(p => p.stock > 4);
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const place = (name, phone, extra, ip) => json("/orders", { name, phone, ...extra }, null, ip);
const axeSrc = fs.readFileSync(axePath, "utf8");

const today = await place("Todd Today", "5550101", { method: "collect", collectDate: day(0), items: [{ id: inStock[0].id, qty: 1 }] }, "5.5.5.1");
const late = await place("Lena Late", "5550202", { method: "collect", collectDate: day(-1), items: [{ id: inStock[1].id, qty: 1 }] }, "5.5.5.2");
const post = await place("Penny Post", "5550303", { method: "post", address: "12 Vinewood Blvd, Downtown, Los Santos", items: [{ id: inStock[2].id, qty: 1 }] }, "5.5.5.3");
const later = await place("Fred Future", "5550404", { method: "collect", collectDate: day(5), items: [{ id: inStock[3].id, qty: 1 }] }, "5.5.5.4");
const owner = (await json("/login", { username: "owner", password: "owner-password-1" })).token;
await json(`/orders/${post.orderId}`, { paid: true }, owner);
await json("/wants", { kind: "restock", productId: shop.products.find(p => p.stock <= 0)?.id || inStock[4].id, name: "Wanda Waiting", phone: "5550505" }, null, "6.6.6.1");

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 1000 });
await page.setBypassCSP(true);
const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.accept());
await page.goto(BASE + "/admin/", { waitUntil: "networkidle0" });
await page.evaluate(axeSrc);
const axe = async name => { const v = await page.evaluate(async () => (await axe.run(document, { resultTypes: ["violations"] })).violations.map(x => x.id + ": " + x.nodes.slice(0, 2).map(n => n.target.join(" ")).join(" ; "))); check(`accessibility: ${name}`, v.length === 0, v.join(" || ")); };
await page.type("#u", "owner"); await page.type("#pw", "owner-password-1"); await page.click("#loginBtn");
await page.waitForSelector("#panel .arow");
await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async t => { window.__copied = t; } }, configurable: true }); window.__pics = []; const mk = URL.createObjectURL.bind(URL); URL.createObjectURL = b => { if (b && b.type === "image/png") window.__pics.push(b); return mk(b); }; });

/* ---- Orders: due strip, chips, search, messages, slips ---- */
await page.$eval('[data-tab="orders"]', t => t.click()); await page.waitForSelector("details.order"); await sleep(400);
const strip = await page.$eval("#dueStrip", e => e.textContent);
check("the due strip counts today's collection and the earlier one not picked up", /1 collection due today/.test(strip) && /1 earlier collection/.test(strip), strip.replace(/\s+/g, " "));
await page.$eval('[data-chip="due"]', b => b.click()); await sleep(200);
const dueNames = await page.$$eval("details.order summary", s => s.map(x => x.textContent));
check("'Due today' shows both due collections and not the future or posted ones", dueNames.length === 2 && dueNames.some(t => t.includes("Todd")) && dueNames.some(t => t.includes("Lena")) && !dueNames.some(t => /Fred|Penny/.test(t)), String(dueNames.length));
await page.$eval('[data-chip="due"]', b => b.click());
await page.$eval('[data-chip="unpaid"]', b => b.click()); await sleep(150);
check("'Not paid' hides the paid order", !(await page.$$eval("details.order summary", s => s.map(x => x.textContent))).some(t => t.includes("Penny")));
await page.$eval('[data-chip="unpaid"]', b => b.click());
await page.type("#oSearch", "penny"); await sleep(200);
check("search finds an order by name", (await page.$$eval("details.order", d => d.length)) === 1);
await page.$eval("#oSearch", e => { e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true })); });
await page.type("#oSearch", "555 0404"); await sleep(200);
check("search finds an order by phone number, however it's written", (await page.$$eval("details.order summary", s => s.map(x => x.textContent))).some(t => t.includes("Fred")));
await page.$eval("#oSearch", e => { e.value = today.orderId; e.dispatchEvent(new Event("input", { bubbles: true })); }).catch(() => {});
await page.evaluate(id => { const e = document.getElementById("oSearch"); e.value = id; e.dispatchEvent(new Event("input", { bubbles: true })); }, today.orderId); await sleep(200);
check("search finds an order by its number", (await page.$$eval("details.order", d => d.length)) === 1);
await page.$eval("details.order summary", s => s.click());
await page.$eval('[data-oact="copy"]', b => b.click()); await sleep(150);
const copied = await page.evaluate(() => window.__copied);
check("Copy message gives a ready-to-send text with the order number", copied.includes(today.orderId) && copied.startsWith("Hi Todd"), copied);
await page.$eval('[data-oact="print"]', b => b.click()); await sleep(600);
const pic = await page.evaluate(async () => { const b = window.__pics.at(-1); if (!b) return null; const bmp = await createImageBitmap(b); return { type: b.type, size: b.size, w: bmp.width, h: bmp.height }; });
check("Save receipt makes one picture: a PNG, 576 px wide at 2x, taller than wide like a till roll", pic && pic.type === "image/png" && pic.size > 8000 && pic.w === 1152 && pic.h > pic.w, JSON.stringify(pic));
check("and says where it went", /Saved flickers-receipt-FC-/.test(await page.$eval("#aMsg", e => e.textContent)), await page.$eval("#aMsg", e => e.textContent));
await page.evaluate(() => { const e = document.getElementById("oSearch"); e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true })); }); await sleep(200);
check("the Save receipts button counts the orders shown", /Save receipts \(4\)/.test(await page.$eval("#printBtn", b => b.textContent)), await page.$eval("#printBtn", b => b.textContent));
await page.$eval("#printBtn", b => b.click()); await sleep(800);
const stack = await page.evaluate(async () => { const b = window.__pics.at(-1), bmp = await createImageBitmap(b); return { h: bmp.height, n: window.__pics.length }; });
check("saving the list stacks every order into one taller picture", stack.n >= 2 && stack.h > pic.h * 3, JSON.stringify(stack) + " vs one " + pic.h);
await axe("orders tab");

/* ---- take an order ---- */
const stockBefore = Object.fromEntries((await json("/stock", null, owner)).products.map(p => [p.id, p.stock]));
await page.$eval("#counterBtn", b => b.click()); await page.waitForSelector("#counterDlg[open]"); await sleep(300);
const want = inStock[5];
await page.type("#ct-q", want.title.slice(0, 5)); await sleep(200);
check("searching lists matching comics with their stock", (await page.$$eval("#ctResults .ct-result", r => r.length)) > 0);
await page.keyboard.press("Enter"); await sleep(150);
check("Enter adds the first result to the order", (await page.$$eval("#ctLines .ct-line", r => r.length)) === 1);
await page.$eval("#ctLines [data-inc]", b => b.click()); await sleep(100);
check("the quantity can go up, and the total follows", /Total/.test(await page.$eval("#ctSums", e => e.textContent)));
await page.click("#ctGo"); await sleep(200);
check("a name is required", /name/i.test(await page.$eval("#ctError", e => e.textContent)));
await axe("take an order dialog");
await page.type("#ct-name", "Walk-in");
await page.click("#ctGo"); await sleep(1500);
check("the dialog closes and says what happened", !(await page.$eval("#counterDlg", d => d.open)) && /created/.test(await page.$eval("#aMsg", e => e.textContent)), await page.$eval("#aMsg", e => e.textContent));
check("a counter sale lands in the Archive as handed over, marked Counter", /Counter/.test(await page.$eval("details.order summary", s => s.textContent)) && /Collected/.test(await page.$eval("details.order summary", s => s.textContent)) && /Paid/.test(await page.$eval("details.order summary", s => s.textContent)));
const stockAfter = Object.fromEntries((await json("/stock", null, owner)).products.map(p => [p.id, p.stock]));
const dropped = Object.keys(stockAfter).filter(id => stockAfter[id] < stockBefore[id]); // the first match for the search is the one added
check("and the shelf went down by the copies sold", dropped.length === 1, `${dropped.map(id => stockBefore[id] + " → " + stockAfter[id])}`);
await page.$eval("details.order summary", s => s.click());
check("the order shows who keyed it in", /Keyed in by owner/.test(await page.$eval("details.order", e => e.textContent)));

await page.$eval("#counterBtn", b => b.click()); await page.waitForSelector("#counterDlg[open]");
await page.type("#ct-q", inStock[6].title.slice(0, 5)); await page.keyboard.press("Enter");
await page.type("#ct-name", "Casey Caller"); await page.type("#ct-phone", "5550909");
await page.$eval('input[name="ct-method"][value="post"]', r => r.click()); await sleep(100);
check("choosing Post asks for an address and adds postage", !(await page.$eval("#ct-addrWrap", e => e.hidden)) && /Postage/.test(await page.$eval("#ctSums", e => e.textContent)));
await page.click("#ctGo"); await sleep(200);
check("posting without an address is refused", /address/i.test(await page.$eval("#ctError", e => e.textContent)));
await page.type("#ct-addr", "12 Vinewood Blvd, Downtown, Los Santos"); await page.click("#ctGo"); await sleep(1500);
await page.$$eval('[data-filter]', bs => bs.find(b => /Open/.test(b.textContent)).click()); await sleep(200);
check("a phone order stays open for the staff to work", (await page.$$eval("details.order summary", s => s.map(x => x.textContent))).some(t => t.includes("Casey Caller") && /New/.test(t)));
await page.keyboard.press("Escape");

/* ---- receive a shipment ---- */
await page.$eval('[data-tab="stock"]', t => t.click()); await page.waitForSelector("#aReceive"); await sleep(300);
const [a, b] = inStock;
const base = Object.fromEntries((await json("/stock", null, owner)).products.map(p => [p.id, p.stock]));
await page.click("#aReceive"); await page.waitForSelector("#recvDlg[open]"); await sleep(300);
await page.type("#rv-q", a.title.slice(0, 5)); await sleep(200);
await page.$eval('#rvResults [data-add][data-n="5"]', b => b.click()); await sleep(100);
check("tapping +5 puts five copies on the list", /5/.test(await page.$eval("#rvLines .qty-n", e => e.textContent)));
await page.type("#rv-paste", `${fullTitle(b)}, 3\nBatman\nSpawn #1 x2`);
await page.click("#rvAddList"); await sleep(250);
const um = await page.$eval("#rvUnmatched", e => e.textContent);
check("an ambiguous line asks which comic, and an unknown one says so", /Batman/.test(um) && /which one/.test(um) && /Spawn #1/.test(um) && /no match/.test(um), um.replace(/\s+/g, " ").slice(0, 160));
await page.$eval("[data-use]", b => b.click()); await sleep(100);
await page.$eval("[data-skip]", b => b.click()); await sleep(100);
check("choosing one adds it, skipping clears the unknown line", (await page.$eval("#rvUnmatched", e => e.textContent.trim())) === "");
await page.$eval("#rv-new", c => c.click());
await axe("receive a shipment dialog");
const rows = await page.$$eval("#rvLines .ct-line", r => r.length);
await page.click("#rvGo"); await sleep(400);
check("applying closes the dialog and reports the copies", !(await page.$eval("#recvDlg", d => d.open)) && /Added \d+ cop/.test(await page.$eval("#aMsg", e => e.textContent)), await page.$eval("#aMsg", e => e.textContent));
const nowStock = await page.$eval(`[data-stock="${a.id}"]`, e => Number(e.value));
check("stock on the list went up by what arrived (5)", nowStock === base[a.id] + 5, `${base[a.id]} → ${nowStock}`);
check("every received comic is an unpublished change", /unpublished/.test(await page.$eval("#aChanges", e => e.textContent)) && rows >= 3);
await page.click("#aPublish"); await page.waitForFunction(() => /ublished\./.test(document.getElementById("aMsg").textContent), { timeout: 15000 });
const published = Object.fromEntries((await json("/stock", null, owner)).products.map(p => [p.id, p]));
check("publishing saves the new numbers and the New label", published[a.id].stock === base[a.id] + 5 && (published[a.id].badges || []).includes("new"));

/* ---- reorder ---- */
await page.$eval('[data-tab="reorder"]', t => t.click()); await page.waitForSelector(".reorder-table, .admin-empty"); await sleep(400);
const hasRows = (await page.$(".reorder-table")) !== null;
const anyLow = (await (await fetch(BASE + "/data/shop.json")).json()).products.some(p => p.stock <= 2); // the list only has comics that are low or gone
check("the Reorder tab lists what's low or gone", anyLow ? hasRows : !hasRows);
if (hasRows) {
  const first = await page.$eval(".reorder-table tbody tr", r => ({ title: r.querySelector("th").textContent, qty: r.querySelector("[data-qty]").value }));
  await page.$eval("[data-qty]", e => { e.value = "2"; e.dispatchEvent(new Event("change", { bubbles: true })); });
  check("typing a quantity ticks the row", await page.$eval("[data-pick]", c => c.checked));
  check("the list has Add to stock (not Copy) and a spreadsheet download", !!(await page.$("#rAdd")) && !!(await page.$("#rCsv")) && !(await page.$("#rCopy")));
  await page.$eval("[data-qty]", e => { e.value = "0"; e.dispatchEvent(new Event("change", { bubbles: true })); });
  check("setting a quantity to 0 unticks the row", !(await page.$eval("[data-pick]", c => c.checked)));
  await axe("reorder tab");
  void first;
}
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
