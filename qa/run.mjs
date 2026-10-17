/* Runs the browser checks against a local copy of the shop and staff area.

     cd qa && npm install          (once: installs puppeteer-core; it uses your Edge or Chrome)
     node run.mjs                  (everything)    node run.mjs wants tabs     (just those)

   It builds the site (once for the real addresses, once pointed at the pretend staff service in worker/dev.mjs),
   serves it on :8080, restarts the pretend service before each check so they can't affect each other, and prints a verdict per check.
   Screenshots and logs go to a "flickers-qa" folder in your temp directory. Set QA_BROWSER if no browser is found. */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, OUT } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV = { ORDERS_LIVE: "1", ORDER_API: "http://localhost:8787/orders", ADMIN_API: "http://localhost:8787" };
const SOLD_OUT = "the-deadman-5"; // the wanted-list check needs this one sold out
// The checks build from a fixed set of comics (qa/fixture), so they don't break when the shop's stock changes. QA_LIVE_DATA=1 uses the shop's real stock instead.
const FIXTURE = process.env.QA_LIVE_DATA ? "" : path.join(ROOT, "qa", "fixture");
const PRODUCTS_SRC = FIXTURE ? path.join(FIXTURE, "products.json") : path.join(ROOT, "data/products.json");
const PLAN = [
  { name: "the site as deployed", env: {}, checks: ["func", "resilience"] },
  { name: "the site with the pretend staff service", env: DEV, checks: ["flow", "admin", "filters", "publisher", "convenience", "wish", "sharecart", "covers", "paging", "tabs", "fonts", "deal", "sales", "series", "staffdesk", "receipt", "storeaxe", "labels", "adminaxe", "dlgaxe", "audit2"] },
  { name: "the same, with one comic sold out", env: DEV, soldOut: true, checks: ["wants", "restock"] }
];
const only = process.argv.slice(2);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const up = async url => { try { return (await fetch(url)).ok; } catch (e) { return false; } };
const node = (args, env = {}, opts = {}) => spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, ...opts });
async function waitFor(url) { for (let i = 0; i < 50; i++) { if (await up(url)) return; await sleep(200); } throw new Error("Nothing answered at " + url); }

function build(env, soldOut) {
  const extra = FIXTURE ? { QA_FIXTURE: FIXTURE } : {};
  if (soldOut) {
    const file = path.join(OUT, "products-sold-out.json");
    const lines = fs.readFileSync(PRODUCTS_SRC, "utf8").split("\n").map(l => (l.includes(`"${SOLD_OUT}"`) ? l.replace(/"stock":\d+/, '"stock":0') : l));
    fs.writeFileSync(file, lines.join("\n"));
    extra.PRODUCTS_FILE = file;
  }
  execFileSync(process.execPath, ["build/build.mjs"], { cwd: ROOT, env: { ...process.env, ADMIN_API: "", ...env, ...extra }, stdio: "pipe" });
}

function verdict(out, code) {
  const bad = [];
  if (code !== 0) bad.push("exit code " + code);
  const fails = out.split("\n").filter(l => /^FAIL /.test(l));
  if (fails.length) bad.push(`${fails.length} failed: ${fails[0].slice(5, 90)}`);
  if (/SOME FAILED|OVERFLOW|violation\(s\)|[1-9]\d* issues/.test(out)) bad.push("problems reported");
  const m = out.match(/(\d+)\/(\d+) passed/);
  if (m && m[1] !== m[2]) bad.push(`only ${m[1]} of ${m[2]} passed`);
  return bad;
}

let server = null, failures = 0;
try {
  if (await up("http://localhost:8787/")) throw new Error("The pretend staff service is already running on port 8787 (npm run dev:api?). Stop it first; this runner starts its own.");
  if (!(await up("http://localhost:8080/"))) { server = node(["build/serve.mjs"], {}, { stdio: "ignore" }); await waitFor("http://localhost:8080/"); }
  for (const step of PLAN) {
    const checks = step.checks.filter(c => !only.length || only.includes(c));
    if (!checks.length) continue;
    console.log(`\n${step.name}`);
    build(step.env, step.soldOut);
    for (const name of checks) {
      const api = node(["worker/dev.mjs"], { ...(step.soldOut ? { PRODUCTS_FILE: path.join(OUT, "products-sold-out.json") } : FIXTURE ? { PRODUCTS_FILE: PRODUCTS_SRC } : {}), ...(FIXTURE ? { FEATURED_FILE: path.join(FIXTURE, "featured.json") } : {}) }, { stdio: ["ignore", fs.openSync(path.join(OUT, "dev.log"), "w"), "inherit"] });
      let out = "", code = 1;
      try {
        await waitFor("http://localhost:8787/");
        const child = spawn(process.execPath, [path.join(here, name + ".mjs")], { cwd: here, env: process.env });
        child.stdout.on("data", d => { out += d; });
        child.stderr.on("data", d => { out += d; });
        code = await new Promise(res => child.on("close", res));
      } finally { api.kill(); }
      fs.writeFileSync(path.join(OUT, name + ".log"), out);
      const bad = verdict(out, code);
      if (bad.length) failures++;
      console.log(`  ${bad.length ? "FAIL" : "ok  "} ${name}${bad.length ? "  (" + bad.join("; ") + ")  see " + path.join(OUT, name + ".log") : ""}`);
    }
  }
} finally {
  if (server) server.kill();
  try { build({}, false); } catch (e) { /* leave dist as it is */ } // put dist back to the plain build
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
