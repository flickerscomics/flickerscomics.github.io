/* Local stand-in for the staff API, for trying the staff area without Cloudflare or GitHub.
   Runs the real Worker code with an in-memory user store and a pretend GitHub that reads data/products.json.
   Nothing is written anywhere: published changes only live until you stop this script.

     ADMIN_API=http://localhost:8787 npm run build
     npm run dev:api          (in a second terminal; also: npm run serve)
   Then open http://localhost:8080/admin/ and sign in as  owner / owner-password-1  */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker, { hashPassword } from "./src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kv = new Map();
const meta = new Map();
const USERS = {
  get: async k => kv.get(k) ?? null, put: async (k, v, o) => { kv.set(k, String(v)); if (o && o.metadata) meta.set(k, o.metadata); else meta.delete(k); }, delete: async k => { kv.delete(k); meta.delete(k); },
  list: async ({ prefix = "", limit = 1000, cursor } = {}) => {
    const all = [...kv.keys()].filter(k => k.startsWith(prefix)).sort(), start = cursor ? Number(cursor) : 0, done = start + limit >= all.length;
    const keys = all.slice(start, start + limit).map(name => ({ name, ...(meta.has(name) ? { metadata: meta.get(name) } : {}) }));
    return done ? { keys, list_complete: true } : { keys, list_complete: false, cursor: String(start + limit) };
  }
};
const env = { USERS, SESSION_SECRET: "dev-secret-not-for-production", SETUP_KEY: "dev", GITHUB_TOKEN: "dev", GITHUB_REPO: "dev/dev", GITHUB_BRANCH: "main", ALLOWED_ORIGINS: "http://localhost:8080",
  SITE_URL: "http://localhost:8080", ORDERS_ENABLED: "true", DISCORD_WEBHOOK_URL: "http://discord.local/api/webhooks/dev/dev" };
kv.set("user:owner", JSON.stringify({ username: "owner", role: "owner", ...(await hashPassword("owner-password-1")), pv: 1, created: new Date().toISOString() }));

/* pretend GitHub */
let products = fs.readFileSync(process.env.PRODUCTS_FILE || path.join(root, "data/products.json"), "utf8"); // PRODUCTS_FILE: used by the QA suite
let featured = fs.readFileSync(process.env.FEATURED_FILE || path.join(root, "data/featured.json"), "utf8"); // FEATURED_FILE: used by the QA suite
let n = 0, discordN = 1000;
const blobs = {};
globalThis.fetch = async (url, opts = {}) => {
  const p = new URL(url).pathname.replace("/repos/dev/dev", ""), method = opts.method || "GET";
  const ok = d => new Response(JSON.stringify(d), { status: 200 });
  if (String(url).startsWith("http://localhost:8080/data/shop.json")) return new Response(fs.readFileSync(path.join(root, "dist/data/shop.json")), { status: 200 });
  if (String(url).startsWith("http://discord.local/")) {
    const m = JSON.parse(opts.body), e = m.embeds && m.embeds[0], edit = method === "PATCH";
    if (e) console.log(`\n--- Discord ${edit ? "edit of an earlier message" : "message"} ---\n` + e.title + "\n" + (e.description || "") + "\n" + (e.fields || []).map(f => "  " + f.name + ": " + f.value.replace(/\n/g, " | ")).join("\n") + (e.footer ? "\n  [" + e.footer.text + "]" : "") + (m.content ? "\n  (message text: " + m.content + ")" : "") + "\n-----------------------");
    else console.log("\n--- Discord follow-up ---\n" + m.content + "\n-----------------------");
    return ok(edit ? {} : { id: String(++discordN) });
  }
  if (p.startsWith("/git/ref/heads/")) return ok({ object: { sha: "head" + n } });
  if (p === "/contents/data/products.json") return ok({ sha: "p" + n, content: Buffer.from(products).toString("base64") });
  if (p === "/contents/data/featured.json") return ok({ sha: "f" + n, content: Buffer.from(featured).toString("base64") });
  if (p.startsWith("/git/commits/") && method === "GET") return ok({ tree: { sha: "t" } });
  if (p === "/git/blobs") { const sha = "b" + (++n); blobs[sha] = JSON.parse(opts.body); return ok({ sha }); }
  if (p === "/git/trees") { for (const t of JSON.parse(opts.body).tree) { if (t.path === "data/products.json") products = blobs[t.sha].content; if (t.path === "data/featured.json") featured = blobs[t.sha].content; } return ok({ sha: "t2" }); }
  if (p === "/git/commits") { console.log("commit:", JSON.parse(opts.body).message); return ok({ sha: "c" + n }); }
  if (p.startsWith("/git/refs/heads/")) return ok({});
  return new Response("{}", { status: 404 });
};

http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request("http://localhost:8787" + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log("Dev staff API on http://localhost:8787  (owner / owner-password-1)"));
