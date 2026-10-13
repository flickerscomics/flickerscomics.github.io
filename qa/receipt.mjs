// The receipt is a picture, drawn like a till printout: saves the PNG so it can be looked at.
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
const a = await json("/orders", { name: "Jamie Reyes", phone: "555 0142", method: "collect", collectDate: day, notes: "Please put the variant cover on top, and a very long extra line of instructions so that it has to wrap", items: [{ id: stocked[0].id, qty: 2 }, { id: stocked[1].id, qty: 1 }, { id: stocked[2].id, qty: 1 }] }, null, "4.4.4.1");
const b = await json("/orders", { name: "Penny Post", phone: "555 0303", method: "post", address: "12 Vinewood Blvd, Downtown, Los Santos", items: [{ id: stocked[3].id, qty: 1 }] }, null, "4.4.4.2");

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 1000 });
const errors = []; page.on("pageerror", e => errors.push(e.message));
await page.goto(BASE + "/admin/", { waitUntil: "networkidle0" });
await page.type("#u", "owner"); await page.type("#pw", "owner-password-1"); await page.click("#loginBtn");
await page.waitForSelector("#panel .arow");
await page.evaluate(() => { window.__pics = []; const mk = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { if (blob && blob.type === "image/png") window.__pics.push(blob); return mk(blob); }; window.print = () => { window.__printed = true; }; });
await page.evaluate(() => [...document.querySelectorAll("[data-tab]")].find(x => /orders/i.test(x.textContent))?.click());
await page.waitForSelector("details.order", { timeout: 8000 });
await page.click("#printBtn"); await sleep(900);
const info = await page.evaluate(async () => {
  const blob = window.__pics.at(-1); if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; const x = c.getContext("2d"); x.drawImage(bmp, 0, 0);
  const px = x.getImageData(0, 0, c.width, c.height).data; let ink = 0, off = 0;
  for (let i = 0; i < px.length; i += 4) { if (px[i] < 128) ink++; if (px[i] !== px[i + 1] || px[i + 1] !== px[i + 2]) off++; }
  const rightEdge = x.getImageData(c.width - 6, 0, 6, c.height).data; let edgeInk = 0; for (let i = 0; i < rightEdge.length; i += 4) if (rightEdge[i] < 128) edgeInk++;
  const reader = new FileReader(); const b64 = await new Promise(r => { reader.onload = () => r(reader.result.split(",")[1]); reader.readAsDataURL(blob); });
  return { type: blob.type, w: bmp.width, h: bmp.height, inkShare: ink / (px.length / 4), grey: off, edgeInk, b64 };
});
check("saving makes a PNG picture", info && info.type === "image/png");
check("576 px wide (80 mm paper at 203 dpi) drawn at 2x", info && info.w === 1152, info && String(info.w));
check("tall like a roll of receipts (every order stacked)", info && info.h > info.w * 1.4, info && `${info.w}x${info.h}`);
check("black text on white, with something drawn (not blank)", info && info.inkShare > 0.01 && info.inkShare < 0.25, info && info.inkShare.toFixed(3));
check("it didn't open the print dialog", !(await page.evaluate(() => window.__printed)));
fs.mkdirSync(OUT, { recursive: true });
if (info) fs.writeFileSync(path.join(OUT, "receipts.png"), Buffer.from(info.b64, "base64"));
check("the picture was written for a look", fs.existsSync(path.join(OUT, "receipts.png")), path.join(OUT, "receipts.png"));
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
