/* Adding copies back to the shelf from the Reorder tab. */
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { FakeKV, caller, j } from "./helpers.mjs";

const ORIGIN = "https://shop.example", HOOK = "https://discord.test/api/webhooks/1/secret-token";
const call = caller(worker, ORIGIN);
const COMICS = () => [
  { id: "a", cat: "issues", title: "Alpha", num: "#1", price: 500, stock: 5, blurb: "x" },
  { id: "b", cat: "issues", title: "Bravo", num: "#2", price: 400, stock: 1, blurb: "x" },
  { id: "c", cat: "issues", title: "Charlie", num: "#3", price: 300, stock: 0, blurb: "x" }
];
const CONFIG = { postage: 1000, openHour: 20, closeHour: 22, collectDaysAhead: 14, deal: { enabled: true, buy: 2, free: 1 } };
const baseEnv = (over = {}) => ({
  USERS: new FakeKV(), SESSION_SECRET: "test-secret-0123456789", SETUP_KEY: "k", GITHUB_TOKEN: "x", GITHUB_REPO: "o/r", GITHUB_BRANCH: "main",
  ALLOWED_ORIGINS: ORIGIN, SITE_URL: ORIGIN, ORDERS_ENABLED: "false", DISCORD_WEBHOOK_URL: HOOK, ...over
});
async function owner(env) {
  await call(env, "POST", "/setup", { key: "k", username: "owner", password: "correct horse battery" });
  return (await j(call(env, "POST", "/login", { username: "owner", password: "correct horse battery" }))).token;
}
/* the real stock in GitHub starts as `fresh`; the published site shows `published` (the same, a minute behind) */
function world({ fresh = COMICS(), published = COMICS() } = {}) {
  const st = { products: fresh, head: 1, blobs: {}, n: 0, posts: [], tree: null, commits: [] };
  const b64 = s => Buffer.from(s).toString("base64"), ok = d => new Response(JSON.stringify(d));
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), method = opts.method || "GET";
    if (u === `${ORIGIN}/data/shop.json`) return ok({ config: CONFIG, products: published });
    if (u.startsWith(HOOK)) { st.posts.push(JSON.parse(opts.body)); return ok({ id: String(1000 + st.posts.length) }); }
    const path = new URL(u).pathname.replace("/repos/o/r", "");
    if (path.startsWith("/git/ref/heads/") && method === "GET") return ok({ object: { sha: "h" + st.head } });
    if (path === "/contents/data/products.json") return ok({ sha: "v" + st.head, content: b64(JSON.stringify(st.products)) });
    if (path === "/contents/data/featured.json") return ok({ sha: "f", content: b64("[]") });
    if (path.startsWith("/git/commits/") && method === "GET") return ok({ tree: { sha: "t0" } });
    if (path === "/git/blobs") { const sha = "b" + (++st.n); st.blobs[sha] = JSON.parse(opts.body); return ok({ sha }); }
    if (path === "/git/trees") { st.tree = JSON.parse(opts.body).tree; return ok({ sha: "t1" }); }
    if (path === "/git/commits" && method === "POST") { st.commits.push(JSON.parse(opts.body).message); return ok({ sha: "c" + st.n }); }
    if (path.startsWith("/git/refs/heads/") && method === "PATCH") { st.products = JSON.parse(st.blobs[st.tree.find(t => t.path === "data/products.json").sha].content); st.head++; return ok({}); }
    return new Response("{}", { status: 404 });
  };
  return st;
}
const orderPosts = st => st.posts.filter(p => p.embeds && /^Order /.test(p.embeds[0].title));
const add = (env, items, token) => j(call(env, "POST", "/stock/add", { items }, token));

test("staff can add copies back to the stock; it adds to what's on the shelf right now and tells the wanted list", async () => {
  const st = world(), env = baseEnv(), token = await owner(env);
  const res = await add(env, [{ id: "c", qty: 4 }, { id: "a", qty: 2 }], token);
  assert.equal(res.status, 200);
  assert.equal(res.added, 6);
  assert.deepEqual(res.stock, { c: 4, a: 7 });
  assert.equal(st.products.find(p => p.id === "c").stock, 4, "it's in GitHub, so the next build shows it");
  assert.equal(st.products.find(p => p.id === "a").stock, 7);
  assert.match(st.commits[0], /Restock \(owner\): 6 copies added/);
});

test("it adds to the live stock, not to a stale copy: copies sold in the meantime stay sold", async () => {
  const st = world({ fresh: COMICS().map(p => p.id === "a" ? { ...p, stock: 2 } : p), published: COMICS() }), env = baseEnv(), token = await owner(env);
  const res = await add(env, [{ id: "a", qty: 3 }], token);
  assert.deepEqual(res.stock, { a: 5 }, "2 left on the real shelf + 3 arrived (not 5 + 3)");
});

test("a comic someone was waiting for tells staff it's back in Discord", async () => {
  const st = world(), env = baseEnv({ ORDERS_ENABLED: "true" }), token = await owner(env);
  assert.equal((await j(call(env, "POST", "/wants", { kind: "restock", productId: "c", name: "Wanda Waiting", phone: "555 0505" }))).status, 200);
  await add(env, [{ id: "c", qty: 2 }], token);
  assert.ok(st.posts.some(p => JSON.stringify(p).includes("Wanda Waiting")), "the staff are told who to contact");
});

test("bad requests are refused and change nothing", async () => {
  const st = world(), env = baseEnv(), token = await owner(env);
  for (const items of [[], [{ id: "a", qty: 0 }], [{ id: "a", qty: 1.5 }], [{ id: "a", qty: 1000 }], [{ id: "../x", qty: 1 }], [{ id: "a" }], "nope"]) assert.equal((await add(env, items, token)).status, 400, JSON.stringify(items));
  assert.equal((await add(env, [{ id: "ghost", qty: 1 }], token)).status, 409, "a comic that isn't in the shop");
  assert.equal((await add(env, [{ id: "a", qty: 1 }])).status, 401, "signed-in staff only");
  assert.equal(st.commits.length, 0);
});

import { cleanProduct } from "../worker/src/index.js";
test("an omnibus can list a long run of contents without being cut short", () => {
  const long = Array.from({ length: 40 }, (_, i) => `Batman: Story Number ${i + 1}`).join(", "); // well over the old 120 characters
  const p = cleanProduct({ id: "omni", cat: "omnibus", title: "Omnibus", price: 100, stock: 1, collects: long }, 0);
  assert.equal(p.collects, long);
});
