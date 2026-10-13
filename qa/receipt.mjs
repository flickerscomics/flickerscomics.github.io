// The printed slip looks like a till receipt: 80 mm roll, monospaced type, one receipt per page. Also saves a PDF to look at.
import { launch, BASE, API, OUT } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };
const json = async (route, body, token, ip) => { const r = await fetch(API + route, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Origin: BASE, "CF-Connecting-IP": ip || "9.9.9.9", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };

const shop = await (await fetch(BASE + "/data/shop.json")).json();
const stocked = shop.products.filter(p => p.stock > 4);
const day = new Date().toISOString().slice(0, 10);
await json("/orders", { name: "Jamie Reyes", phone: "555 0142", method: "collect", collectDate: day, notes: "Please put the variant cover on top", items: [{ id: stocked[0].id, qty: 2 }, { id: stocked[1].id, qty: 1 }, { id: stocked[2].id, qty: 1 }] }, null, "4.4.4.1");
await json("/orders", { name: "Penny Post", phone: "555 0303", method: "post", address: "12 Vinewood Blvd, Downtown, Los Santos", items: [{ id: stocked[3].id, qty: 1 }] }, null, "4.4.4.2");
const owner = (await json("/login", { username: "owner", password: "owner-password-1" })).token;

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 1000 });
const errors = []; page.on("pageerror", e => errors.push(e.message));
await page.goto(BASE + "/admin/", { waitUntil: "networkidle0" });
await page.type("#u", "owner"); await page.type("#pw", "owner-password-1"); await page.click("#loginBtn");
await page.waitForSelector("#panel .arow");
await page.evaluate(() => { window.print = () => { window.__printing = true; }; });
await page.evaluate(() => [...document.querySelectorAll(".adm-tab, [data-tab]")].find(b => /orders/i.test(b.textContent))?.click());
await page.waitForSelector("details.order", { timeout: 8000 });
await page.click("#printBtn"); await sleep(300); // every order in the list: two receipts
const count = await page.$$eval(".slip", s => s.length);
check("one receipt per order", count >= 2, String(count));

await page.emulateMediaType("print");
const look = await page.evaluate(() => {
  const s = document.querySelector(".slip"), cs = getComputedStyle(s);
  const mm = px => Math.round(px / 96 * 25.4 * 10) / 10;
  const rule = [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch (e) { return []; } }).some(r => r.constructor.name === "CSSPageRule" && /size/.test(r.cssText) && /80mm/.test(r.cssText));
  return { widthMm: mm(s.getBoundingClientRect().width), font: cs.fontFamily, color: cs.color, bg: cs.backgroundColor, rollRule: rule, text: s.innerText };
});
check("it is 72 mm wide, the printable part of an 80 mm till roll", look.widthMm >= 71 && look.widthMm <= 73, look.widthMm + " mm");
check("the page size is an 80 mm roll", look.rollRule);
check("set in a monospaced till font", /courier|consolas|lucida console|monospace/i.test(look.font), look.font);
check("black on white", look.color === "rgb(0, 0, 0)" && /255, 255, 255|rgba\(0, 0, 0, 0\)/.test(look.bg));
check("it reads like a receipt: shop, order, items, total, thank you", /FLICKERS COMICS/.test(look.text) && /ORDER/.test(look.text) && /TOTAL/.test(look.text) && /THANK YOU/.test(look.text) && /PAID|NOT PAID/.test(look.text), look.text.slice(0, 80).replace(/\n/g, " | "));
check("prices line up on the right", await page.$$eval(".slip .rc-items li", lis => lis.every(li => { const r = li.querySelector(".rc-r").getBoundingClientRect(), box = li.getBoundingClientRect(); return Math.abs(box.right - r.right) < 2; })));
check("long text wraps inside the roll instead of running off it", await page.$$eval(".slip", ss => ss.every(s => s.scrollWidth <= s.clientWidth + 1)));

fs.mkdirSync(OUT, { recursive: true });
const pdfPath = path.join(OUT, "receipt.pdf");
await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
check("a PDF of the receipts was written", fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 1000, pdfPath);
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
