/* Shared bits for the browser checks in this folder. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const axePath = path.join(ROOT, "node_modules", "axe-core", "axe.min.js");
/* where screenshots and logs go */
export const OUT = path.join(os.tmpdir(), "flickers-qa");
fs.mkdirSync(OUT, { recursive: true });

/* QA_BROWSER overrides; otherwise the first Edge or Chrome found in the usual places. */
const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
];
export function browserPath() {
  const found = process.env.QA_BROWSER || CANDIDATES.find(p => fs.existsSync(p));
  if (!found) throw new Error("No Edge or Chrome found. Set QA_BROWSER to its full path.");
  return found;
}
/* Normally puppeteer starts the browser itself. Some Edge builds exit straight away when puppeteer starts them that way (Code: 0), so if that
   happens we start the browser ourselves on a debugging port and connect to it. */
export async function launch(opts = {}) {
  try { return await puppeteer.launch({ executablePath: browserPath(), headless: "new", args: ["--no-sandbox"], ...opts }); }
  catch (e) {
    const port = 9300 + Math.floor(Math.random() * 500), dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-browser-"));
    const child = spawn(browserPath(), ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore" });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch (err) { /* not up yet */ } await new Promise(r => setTimeout(r, 250)); }
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
    const close = browser.close.bind(browser);
    browser.close = async () => { try { await close(); } catch (err) { /* already gone */ } child.kill(); };
    return browser;
  }
}

export const BASE = process.env.QA_BASE || "http://localhost:8080";
export const API = process.env.QA_API || "http://localhost:8787";

/* Puts a few customers' orders and requests into the pretend staff service, for checks that need something to look at. */
export async function seed({ orders = 0, wants = 0 } = {}) {
  const shop = await (await fetch(BASE + "/data/shop.json")).json();
  const ids = shop.products.filter(p => p.stock > 3).map(p => p.id);
  const day = new Date().toISOString().slice(0, 10);
  const post = async (route, body, ip) => (await fetch(API + route, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, "CF-Connecting-IP": ip }, body: JSON.stringify(body) })).json();
  for (let i = 0; i < orders; i++) await post("/orders", { name: "Seeded Customer " + i, phone: "55501" + (10 + i), method: "collect", collectDate: day, items: [{ id: ids[i % ids.length], qty: 1 }] }, "10.1.0." + i);
  for (let i = 0; i < wants; i++) await post("/wants", { kind: "request", text: "Seeded request number " + i, name: "Seeded Customer " + i, phone: "55502" + (10 + i) }, "10.2.0." + i);
}
