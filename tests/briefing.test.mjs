/* The daily briefing posted to the staff channel by the 19:00 UTC cron. */
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { FakeKV } from "./helpers.mjs";

const ORIGIN = "https://shop.example", HOOK = "https://discord.test/api/webhooks/1/secret-token";
const today = new Date().toISOString().slice(0, 10), old = new Date(Date.now() - 3 * 86400000).toISOString();
const PRODUCTS = [
  { id: "a", cat: "issues", title: "Alpha", num: "#1", price: 500, stock: 1, blurb: "x" },
  { id: "b", cat: "issues", title: "Bravo", num: "#2", price: 400, stock: 6, blurb: "x" },
  { id: "c", cat: "issues", title: "Charlie", num: "#3", price: 300, stock: 0, blurb: "x" }
];
const order = (id, over = {}) => ({ id, placedAt: new Date().toISOString(), name: "Jamie Reyes", phone: "5550142", method: "collect", collectDate: today, items: [{ id: "a", title: "Alpha #1", qty: 1, price: 500 }], subtotal: 500, postage: 0, total: 500, paid: false, status: "new", ...over });
function setup({ orders = [], wants = [], products = PRODUCTS } = {}) {
  const env = { USERS: new FakeKV(), SITE_URL: ORIGIN, GITHUB_TOKEN: "x", GITHUB_REPO: "o/r", GITHUB_BRANCH: "main", DISCORD_WEBHOOK_URL: HOOK };
  orders.forEach((o, i) => env.USERS.m.set(`order:${String(1000 + i).padStart(16, "0")}:${o.id}`, JSON.stringify(o)));
  wants.forEach((m, i) => { env.USERS.m.set(`want:${i}`, "{}"); env.USERS.meta.set(`want:${i}`, m); });
  const posts = [], b64 = s => Buffer.from(s).toString("base64"), ok = d => new Response(JSON.stringify(d));
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u === `${ORIGIN}/data/shop.json`) return ok({ config: { timeZone: "Europe/London" }, products });
    if (u.startsWith(HOOK)) { posts.push(JSON.parse(opts.body)); return ok({ id: "1" }); }
    const path = new URL(u).pathname.replace("/repos/o/r", "");
    if (path.startsWith("/git/ref/heads/")) return ok({ object: { sha: "h1" } });
    if (path === "/contents/data/products.json") return ok({ sha: "v1", content: b64(JSON.stringify(products)) });
    if (path === "/contents/data/featured.json") return ok({ sha: "f", content: b64("[]") });
    return new Response("{}", { status: 404 });
  };
  return { env, posts };
}
const run = async env => { let p; await worker.scheduled({ cron: "0 19 * * *" }, env, { waitUntil: x => { p = x; } }); await p; };
const field = (post, name) => (post.embeds[0].fields.find(f => f.name.startsWith(name)) || {}).value;

test("the briefing lists what needs doing", async () => {
  const { env, posts } = setup({
    orders: [
      order("FC-AAAAAA", { placedAt: old }),
      order("FC-BBBBBB", { status: "ready", paid: true, collectDate: "2999-01-01" }),
      order("FC-CCCCCC", { method: "post", address: "1 Road", collectDate: null, total: 900 }),
      order("FC-DDDDDD", { status: "done", paid: true }),
      order("FC-EEEEEE", { payment: { state: "awaiting" } }),
      order("FC-FFFFFF", { paid: true, payment: { state: "paid", flag: "Paid after it was cancelled. Refund the customer on Fleeca." } })
    ],
    wants: [{ k: "restock", p: "b" }, { k: "restock", p: "b" }, { k: "restock", p: "c" }, { k: "request" }]
  });
  await run(env);
  assert.equal(posts.length, 1);
  const e = posts[0].embeds[0];
  assert.match(e.title, /^Daily briefing/);
  assert.match(field(posts[0], "Open orders"), /3 new, 1 ready/);
  assert.match(field(posts[0], "Open orders"), /Oldest: \*\*FC-AAAAAA\*\*, placed 3 days ago/);
  assert.match(field(posts[0], "Collections due"), /FC-AAAAAA/);
  assert.ok(!/FC-BBBBBB/.test(field(posts[0], "Collections due")), "a future collection isn't due");
  assert.match(field(posts[0], "To post"), /FC-CCCCCC/);
  assert.ok(!/FC-EEEEEE|FC-DDDDDD/.test(JSON.stringify(e.fields.filter(f => /^(Open|Collections|To post|Not paid)/.test(f.name)))), "waiting-for-payment and finished orders are left out of the to-do lists");
  assert.match(field(posts[0], "Check these payments"), /FC-FFFFFF.*Refund/);
  assert.match(field(posts[0], "Back in stock"), /Bravo #2.*2 waiting/);
  assert.ok(!/Charlie/.test(field(posts[0], "Back in stock")), "still sold out, so nothing to tell anyone");
  assert.match(field(posts[0], "Nearly gone"), /Alpha #1.*1 left/);
  assert.match(field(posts[0], "Sold out"), /1 comic/);
  assert.match(field(posts[0], "Special requests"), /1 waiting/);
  assert.match(field(posts[0], "Waiting on Fleeca"), /1 order/);
  assert.deepEqual(posts[0].allowed_mentions.parse, [], "nothing in the message can ping anyone");
});

test("a quiet day still gets a short message", async () => {
  const { env, posts } = setup({ products: [{ ...PRODUCTS[1] }] });
  await run(env);
  assert.equal(posts.length, 1);
  assert.match(field(posts[0], "Open orders"), /All caught up/);
  assert.equal(posts[0].embeds[0].fields.length, 1);
});

test("the briefing stays well inside the free-plan call limit, and the other cron still runs the payment sweep", async () => {
  const orders = Array.from({ length: 80 }, (_, i) => order("FC-" + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)) + "ZZZZ"));
  const { env, posts } = setup({ orders });
  const before = env.USERS.ops;
  await run(env);
  assert.ok(env.USERS.ops - before <= 36, `KV calls: ${env.USERS.ops - before}`);
  assert.match(posts[0].embeds[0].footer.text, /newest 30 orders/);
  let swept = false;
  await worker.scheduled({ cron: "*/15 * * * *" }, { ...env, FLEECA_API_KEY: "" }, { waitUntil: p => { swept = true; return p; } });
  assert.ok(swept && posts.length === 1, "the 15-minute cron doesn't post a briefing");
});

test("the briefing pings its own role, in its own channel, and only that role", async () => {
  const { env, posts } = setup();
  env.DISCORD_BRIEFING_ROLE = "222222222222222222"; env.DISCORD_PING_ROLE = "111111111111111111"; env.DISCORD_BRIEFING_WEBHOOK_URL = "https://discord.test/api/webhooks/2/staff-chat";
  const staff = [], real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { if (String(url).startsWith("https://discord.test/api/webhooks/2/")) { staff.push(JSON.parse(opts.body)); return new Response("{}"); } return real(url, opts); };
  await run(env);
  assert.equal(posts.length, 0, "not in the orders channel");
  assert.match(staff[0].content, /^<@&222222222222222222> /);
  assert.deepEqual(staff[0].allowed_mentions, { parse: [], roles: ["222222222222222222"] });
});

test("overdue orders get one ping each in the orders channel, once, however long they stay overdue", async () => {
  const yesterday = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const { env, posts } = setup({ orders: [
    order("FC-LATE11", { collectDate: yesterday }),
    order("FC-TODAY1", { collectDate: today }),
    order("FC-POST11", { method: "post", address: "1 Road", collectDate: null, placedAt: old }),
    order("FC-POST22", { method: "post", address: "1 Road", collectDate: null }),
    order("FC-LATE22", { collectDate: yesterday, status: "done" })
  ] });
  env.DISCORD_PING_ROLE = "111111111111111111";
  await run(env);
  const pings = posts.filter(p => /overdue/.test(p.content || ""));
  assert.equal(pings.length, 1);
  assert.match(pings[0].content, /^<@&111111111111111111> /);
  const text = pings[0].embeds[0].description;
  assert.ok(/FC-LATE11/.test(text) && /FC-POST11/.test(text), "a missed collection and an unposted order");
  assert.ok(!/FC-TODAY1|FC-POST22|FC-LATE22/.test(text), "due today, fresh, and finished orders aren't overdue");
  await run(env);
  assert.equal(posts.filter(p => /overdue/.test(p.content || "")).length, 1, "the next day they aren't pinged again");
});
