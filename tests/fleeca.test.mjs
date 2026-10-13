/* Online payments through Fleeca, with a pretend Fleeca (no real network calls). */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker from "../worker/src/index.js";
import { FakeKV, caller, j } from "./helpers.mjs";

const ORIGIN = "https://shop.example", HOOK = "https://discord.test/api/webhooks/1/secret-token", KEY = "fleeca-test-key-0123456789";
const call = caller(worker, ORIGIN);
const COMICS = () => [
  { id: "a", cat: "issues", title: "Alpha", num: "#1", price: 500, stock: 5, blurb: "x" },
  { id: "b", cat: "issues", title: "Bravo", num: "#2", price: 400, stock: 1, blurb: "x" }
];
const CONFIG = { postage: 1000, openHour: 20, closeHour: 22, collectDaysAhead: 14, deal: { enabled: true, buy: 2, free: 1 } };
const today = () => new Date().toISOString().slice(0, 10);
const baseEnv = (over = {}) => ({
  USERS: new FakeKV(), SESSION_SECRET: "test-secret-0123456789", SETUP_KEY: "k", GITHUB_TOKEN: "x", GITHUB_REPO: "o/r", GITHUB_BRANCH: "main",
  ALLOWED_ORIGINS: ORIGIN, SITE_URL: ORIGIN, ORDERS_ENABLED: "true", DISCORD_WEBHOOK_URL: HOOK, FLEECA_PAYMENTS: "true", FLEECA_MODE: "1", FLEECA_API_KEY: KEY, ...over
});
const buy = (over = {}) => ({ name: "Jamie Reyes", phone: "555 0142", method: "collect", collectDate: today(), items: [{ id: "a", qty: 1 }], ...over });

/* GitHub (stock), Discord and Fleeca, all pretend. fl.reply makes Fleeca answer with that error status; fl.down makes it unreachable. */
function world() {
  const st = { products: COMICS(), head: 1, blobs: {}, n: 0, posts: [], tree: null, commits: [] };
  const fl = { payments: new Map(), calls: [], reply: 0, down: false };
  const b64 = s => Buffer.from(s).toString("base64"), ok = (d, status = 200) => new Response(JSON.stringify(d), { status });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), method = opts.method || "GET";
    if (u.startsWith("https://banking.gta.world/api/v2/")) {
      fl.calls.push({ url: u, method, auth: opts.headers && opts.headers.Authorization, body: opts.body ? JSON.parse(opts.body) : null });
      if (fl.down) throw new Error("network");
      if (fl.reply) return ok({ message: "no" }, fl.reply);
      if (method === "POST") {
        const body = JSON.parse(opts.body), id = crypto.randomUUID();
        fl.payments.set(id, { payment_id: id, amount: body.amount, mode: body.mode ? "live" : "sandbox", status: "awaiting", description: body.description });
        return ok({ success: true, payment_id: id, payment_link: `https://banking.gta.world/gateway/${id}` }, 201);
      }
      const p = fl.payments.get(u.split("/").pop());
      return p ? ok({ success: true, data: p }) : ok({}, 404);
    }
    if (u === `${ORIGIN}/data/shop.json`) return ok({ config: CONFIG, products: COMICS() });
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
    return ok({}, 404);
  };
  return { st, fl };
}
const orderPosts = st => st.posts.filter(p => p.embeds && /^Order /.test(p.embeds[0].title));
const stockOf = (st, id) => st.products.find(p => p.id === id).stock;
const storedOrder = (env, id) => JSON.parse(env.USERS.m.get([...env.USERS.m.keys()].find(k => k.startsWith("order:") && k.endsWith(":" + id))));

const sign = (raw, key = KEY) => "sha256=" + crypto.createHmac("sha256", key).update(raw).digest("hex");
const webhook = (env, body, { key = KEY, header } = {}) => {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return worker.fetch(new Request("https://api.test/fleeca/callback", { method: "POST", headers: { "Content-Type": "application/json", "X-Fleeca-Signature": header ?? sign(raw, key) }, body: raw }), env);
};
const news = (pay, over = {}) => ({ payment_id: pay.payment_id, payment_url: "x", mode: pay.mode, amount: pay.amount, payer_routing: "020001001", payer_name: "Jane Citizen", status: "payment_successful", paid_at: "2026-10-12T12:00:00+00:00", ...over });
const back = (env, id) => worker.fetch(new Request(`https://api.test/fleeca/return${id === undefined ? "" : "?payment_id=" + id}`), env);
async function ordered(env, fl, over) {
  const r = await j(call(env, "POST", "/orders", buy(over)));
  return { r, pay: [...fl.payments.values()].pop() };
}
const age = (env, id, minutes) => env.USERS.meta.set(`await:${id}`, { p: Date.now() - minutes * 60000 });

test("with payments on, an order gets a Fleeca link, holds its comics and says nothing in Discord yet", async () => {
  const { st, fl } = world(), env = baseEnv();
  const { r, pay } = await ordered(env, fl);
  assert.equal(r.status, 200);
  assert.equal(r.paymentUrl, `https://banking.gta.world/gateway/${pay.payment_id}`);
  assert.equal(r.paid, false);
  assert.equal(pay.amount, r.total, "Fleeca is asked for the order total");
  assert.equal(pay.mode, "live");
  assert.equal(pay.description, `Flickers Comics order ${r.orderId}`);
  assert.equal(fl.calls[0].auth, `Bearer ${KEY}`);
  assert.equal(stockOf(st, "a"), 4, "comics are held while the customer pays");
  assert.equal(orderPosts(st).length, 0, "nothing posted for an order that isn't paid");
  const o = storedOrder(env, r.orderId);
  assert.equal(o.payment.state, "awaiting");
  assert.equal(o.payment.id, pay.payment_id);
  assert.ok(env.USERS.m.has(`pay:${pay.payment_id}`) && env.USERS.m.has(`await:${r.orderId}`));
  assert.ok(!env.USERS.meta.has(`sale:${r.orderId}`), "not a sale until it's paid");
  assert.ok(!JSON.stringify(r).includes(KEY) && !JSON.stringify(o).includes(KEY), "the key never leaves the Worker");
});

test("the customer can see the order is waiting for payment", async () => {
  const { fl } = world(), env = baseEnv();
  const { r } = await ordered(env, fl);
  const t = await j(call(env, "POST", "/orders/lookup", { id: r.orderId, phone: "555 0142" }));
  assert.equal(t.statusLabel, "Awaiting payment");
  assert.equal(t.paid, false);
});

test("if Fleeca is down or refuses, the comics go back, nothing is saved or posted, and the customer gets a plain message", async () => {
  for (const [label, set, status, text] of [["unreachable", fl => { fl.down = true; }, 502, /couldn't connect to Fleeca/], ["rate limited", fl => { fl.reply = 429; }, 503, /busy/], ["rejected", fl => { fl.reply = 422; }, 502, /couldn't connect/]]) {
    const { st, fl } = world(), env = baseEnv();
    set(fl);
    const r = await j(call(env, "POST", "/orders", buy()));
    assert.equal(r.status, status, label);
    assert.match(r.error, text, label);
    assert.match(r.error, /Nothing was charged/);
    assert.equal(stockOf(st, "a"), 5, `${label}: the comics are back on the shelf`);
    assert.equal([...env.USERS.m.keys()].filter(k => /^(order|oid|pay|await|sale):/.test(k)).length, 0, `${label}: no order is left behind`);
    assert.equal(orderPosts(st).length, 0, `${label}: nothing in Discord`);
  }
});

test("with payments off, or no key, orders work exactly as before", async () => {
  for (const over of [{ FLEECA_PAYMENTS: "false" }, { FLEECA_API_KEY: undefined }]) {
    const { st, fl } = world(), env = baseEnv(over);
    const r = await j(call(env, "POST", "/orders", buy()));
    assert.equal(r.status, 200);
    assert.equal(r.paymentUrl, undefined);
    assert.equal(fl.calls.length, 0);
    assert.equal(orderPosts(st).length, 1, "posted straight away");
    assert.equal(storedOrder(env, r.orderId).payment, undefined);
  }
});

test("a signed 'paid' webhook marks the order paid, posts it once, and counts the sale; a repeat changes nothing", async () => {
  const { st, fl } = world(), env = baseEnv();
  const { r, pay } = await ordered(env, fl);
  const first = await webhook(env, news(pay));
  assert.equal(first.status, 200);
  const o = storedOrder(env, r.orderId);
  assert.equal(o.paid, true);
  assert.equal(o.payment.state, "paid");
  assert.equal(o.payment.payerName, "Jane Citizen");
  assert.equal(o.payment.payerRouting, "020001001");
  assert.ok(o.history.some(h => h.change === "paid via Fleeca"));
  assert.equal(orderPosts(st).length, 1);
  assert.match(orderPosts(st)[0].embeds[0].fields.find(f => f.name === "Payment").value, /Paid via Fleeca by Jane Citizen/);
  assert.ok(env.USERS.meta.has(`sale:${r.orderId}`));
  assert.ok(!env.USERS.m.has(`await:${r.orderId}`));
  const commits = st.commits.length;
  assert.equal((await webhook(env, news(pay))).status, 200);
  assert.equal(orderPosts(st).length, 1, "no second post");
  assert.equal(st.commits.length, commits, "no second stock change");
  assert.equal(stockOf(st, "a"), 4);
});

test("a webhook with a wrong or missing signature is refused and changes nothing", async () => {
  const { st, fl } = world(), env = baseEnv();
  const { r, pay } = await ordered(env, fl);
  assert.equal((await webhook(env, news(pay), { key: "some-other-key" })).status, 403);
  assert.equal((await webhook(env, news(pay), { header: "" })).status, 403);
  assert.equal((await webhook(env, news(pay), { header: "sha256=abc" })).status, 403);
  assert.equal((await webhook(env, "not json", { header: sign("something else") })).status, 403);
  assert.equal(storedOrder(env, r.orderId).paid, false);
  assert.equal(orderPosts(st).length, 0);
  const noKey = baseEnv({ FLEECA_API_KEY: undefined });
  assert.equal((await webhook(noKey, news(pay))).status, 403, "with no key set nothing can be verified");
});

test("a payment for the wrong amount, or in the wrong mode, is not accepted as paid", async () => {
  const { st, fl } = world(), env = baseEnv();
  const { r, pay } = await ordered(env, fl);
  await webhook(env, news(pay, { amount: pay.amount - 1 }));
  let o = storedOrder(env, r.orderId);
  assert.equal(o.paid, false);
  assert.match(o.payment.flag, /order is \$500/);
  assert.equal(st.posts.filter(p => /NOT marked paid/.test(p.content || "")).length, 1, "staff are told");
  await webhook(env, news(pay, { mode: "sandbox" }));
  o = storedOrder(env, r.orderId);
  assert.equal(o.paid, false, "a sandbox payment can't pay a live order");
  assert.equal(o.payment.state, "awaiting");
  await webhook(env, news(pay)); // the right one still works afterwards
  assert.equal(storedOrder(env, r.orderId).paid, true);
});

test("a failed payment cancels the order and puts the comics back; pending just waits; unknown payments are ignored", async () => {
  const { st, fl } = world(), env = baseEnv();
  const { r, pay } = await ordered(env, fl);
  await webhook(env, news(pay, { status: "pending" }));
  assert.equal(storedOrder(env, r.orderId).payment.state, "awaiting");
  assert.equal(stockOf(st, "a"), 4);
  await webhook(env, news(pay, { status: "payment_failed" }));
  const o = storedOrder(env, r.orderId);
  assert.equal(o.status, "cancelled");
  assert.equal(o.payment.state, "failed");
  assert.equal(stockOf(st, "a"), 5);
  assert.equal(orderPosts(st).length, 0);
  assert.ok(!env.USERS.meta.has(`sale:${r.orderId}`));
  const again = await webhook(env, news(pay, { status: "payment_failed" }));
  assert.equal(again.status, 200);
  assert.equal(stockOf(st, "a"), 5, "a repeat doesn't put them back twice");
  assert.equal((await webhook(env, { payment_id: crypto.randomUUID(), status: "payment_successful", amount: 5, mode: "live" })).status, 200, "acknowledged and ignored");
});

test("the return page sends the customer back to the shop with what we know, and never marks anything paid by itself", async () => {
  const { fl } = world(), env = baseEnv();
  const { r, pay } = await ordered(env, fl);
  let res = await back(env, pay.payment_id);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), `${ORIGIN}/?order=${r.orderId}&status=pending`, "Fleeca hasn't said it's paid, so it stays pending");
  assert.equal(storedOrder(env, r.orderId).paid, false);
  await webhook(env, news(pay));
  res = await back(env, pay.payment_id);
  assert.equal(res.headers.get("Location"), `${ORIGIN}/?order=${r.orderId}&status=paid`);
  for (const bad of [undefined, "nonsense", crypto.randomUUID()]) assert.equal((await back(env, bad)).headers.get("Location"), `${ORIGIN}/?payment=unknown`);
});

test("if the webhook is late, the return page asks Fleeca itself, and not more than once every 20 seconds", async () => {
  const { st, fl } = world(), env = baseEnv();
  const { r, pay } = await ordered(env, fl);
  const calls = fl.calls.length;
  await back(env, pay.payment_id);
  await back(env, pay.payment_id);
  await back(env, pay.payment_id);
  assert.equal(fl.calls.length, calls + 1, "one check, however many times the page is opened");
  fl.payments.get(pay.payment_id).status = "payment_successful";
  const o = storedOrder(env, r.orderId); o.payment.checkedAt = 0; env.USERS.m.set([...env.USERS.m.keys()].find(k => k.startsWith("order:")), JSON.stringify(o));
  const res = await back(env, pay.payment_id);
  assert.equal(res.headers.get("Location"), `${ORIGIN}/?order=${r.orderId}&status=paid`);
  assert.equal(orderPosts(st).length, 1);
  const done = storedOrder(env, r.orderId);
  assert.equal(done.paid, true);
  fl.payments.get(pay.payment_id).payer_name = "Jane Citizen";
});

test("a failed check with Fleeca on the return page still sends the customer home safely", async () => {
  const { fl } = world(), env = baseEnv();
  const { r, pay } = await ordered(env, fl);
  fl.down = true;
  const res = await back(env, pay.payment_id);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), `${ORIGIN}/?order=${r.orderId}&status=pending`);
});

test("the sweep cancels orders still unpaid after 30 minutes, settles paid ones, and leaves new ones alone", async () => {
  const { st, fl } = world(), env = baseEnv();
  const abandoned = await ordered(env, fl), paid = await ordered(env, fl), fresh = await ordered(env, fl);
  fl.payments.get(paid.pay.payment_id).status = "payment_successful";
  age(env, abandoned.r.orderId, 45); age(env, paid.r.orderId, 45); age(env, fresh.r.orderId, 5);
  assert.equal(stockOf(st, "a"), 2);
  await worker.scheduled({}, env, { waitUntil: p => p });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(storedOrder(env, abandoned.r.orderId).status, "cancelled");
  assert.equal(storedOrder(env, abandoned.r.orderId).payment.state, "expired");
  assert.equal(storedOrder(env, paid.r.orderId).paid, true);
  assert.equal(storedOrder(env, fresh.r.orderId).payment.state, "awaiting");
  assert.equal(stockOf(st, "a"), 3, "only the abandoned order's comic came back");
  assert.equal(orderPosts(st).length, 1);
});

test("the sweep handles only a few orders at a time and stops when Fleeca says slow down", async () => {
  const { fl } = world(), env = baseEnv();
  const ids = [];
  for (let i = 0; i < 5; i++) { const { r } = await ordered(env, fl, { items: [{ id: "a", qty: 1 }] }); ids.push(r.orderId); age(env, r.orderId, 60); }
  const before = fl.calls.length;
  await worker.scheduled({}, env, { waitUntil: p => p });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(fl.calls.length - before, 3, "three Fleeca checks per run");
  assert.equal(ids.filter(id => storedOrder(env, id).status === "cancelled").length, 3);
  fl.reply = 429;
  const calls = fl.calls.length;
  await worker.scheduled({}, env, { waitUntil: p => p });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(fl.calls.length - calls, 1, "one 429 and it stops");
  assert.equal(ids.filter(id => storedOrder(env, id).status === "cancelled").length, 3, "nothing cancelled on a guess");
});

test("a payment that turns up after the order was cancelled reopens it if the comics are still there", async () => {
  const { st, fl } = world(), env = baseEnv();
  const { r, pay } = await ordered(env, fl);
  age(env, r.orderId, 45);
  await worker.scheduled({}, env, { waitUntil: p => p });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(storedOrder(env, r.orderId).status, "cancelled");
  assert.equal(stockOf(st, "a"), 5);
  await webhook(env, news(pay));
  const o = storedOrder(env, r.orderId);
  assert.equal(o.paid, true);
  assert.equal(o.status, "new");
  assert.equal(stockOf(st, "a"), 4);
  assert.equal(orderPosts(st).length, 1);
});

test("a late payment for comics that sold meanwhile is flagged for a refund, not lost", async () => {
  const { st, fl } = world(), env = baseEnv();
  const { r, pay } = await ordered(env, fl, { items: [{ id: "b", qty: 1 }] }); // the only copy
  age(env, r.orderId, 45);
  await worker.scheduled({}, env, { waitUntil: p => p });
  await new Promise(r => setTimeout(r, 20));
  st.products.find(p => p.id === "b").stock = 0; // somebody else got it
  await webhook(env, news(pay));
  const o = storedOrder(env, r.orderId);
  assert.equal(o.paid, true);
  assert.equal(o.status, "cancelled");
  assert.match(o.payment.flag, /Refund the customer/);
  assert.ok(st.posts.some(p => /Refund the customer/.test(p.content || "")));
});

test("staff can't mark an order that's waiting for payment as paid or ready, but can cancel it", async () => {
  const { st, fl } = world(), env = baseEnv();
  await call(env, "POST", "/setup", { key: "k", username: "owner", password: "correct horse battery" });
  const token = (await j(call(env, "POST", "/login", { username: "owner", password: "correct horse battery" }))).token;
  const { r } = await ordered(env, fl);
  assert.equal((await j(call(env, "POST", `/orders/${r.orderId}`, { paid: true }, token))).status, 409);
  assert.equal((await j(call(env, "POST", `/orders/${r.orderId}`, { status: "ready" }, token))).status, 409);
  const cancelled = await j(call(env, "POST", `/orders/${r.orderId}`, { status: "cancelled" }, token));
  assert.equal(cancelled.status, 200);
  assert.equal(stockOf(st, "a"), 5);
  assert.ok(!env.USERS.m.has(`await:${r.orderId}`), "the sweep won't look at it");
  assert.ok(!env.USERS.meta.has(`sale:${r.orderId}`));
});

test("orders staff key in themselves never go through Fleeca", async () => {
  const { st, fl } = world(), env = baseEnv();
  await call(env, "POST", "/setup", { key: "k", username: "owner", password: "correct horse battery" });
  const token = (await j(call(env, "POST", "/login", { username: "owner", password: "correct horse battery" }))).token;
  const r = await j(call(env, "POST", "/staff/orders", { name: "Walk-in", method: "collect", items: [{ id: "a", qty: 1 }] }, token));
  assert.equal(r.status, 200);
  assert.equal(fl.calls.length, 0);
  assert.equal(orderPosts(st).length, 1);
});

test("in sandbox mode a 'successful' payment is recorded but never marks the order paid or counts as a sale", async () => {
  const { st, fl } = world(), env = baseEnv({ FLEECA_MODE: "0" });
  const { r, pay } = await ordered(env, fl);
  assert.equal(pay.mode, "sandbox");
  await webhook(env, news(pay));
  const o = storedOrder(env, r.orderId);
  assert.equal(o.paid, false);
  assert.equal(o.payment.state, "paid");
  assert.equal(o.payment.sandbox, true);
  assert.ok(!env.USERS.meta.has(`sale:${r.orderId}`));
  assert.match(orderPosts(st)[0].embeds[0].fields.find(f => f.name === "Payment").value, /SANDBOX.*NOT paid/);
  const res = await back(env, pay.payment_id);
  assert.equal(res.headers.get("Location"), `${ORIGIN}/?order=${r.orderId}&status=paid`);
});

test("a failed attempt because Fleeca is unavailable doesn't count towards the customer's order limit", async () => {
  const { fl } = world(), env = baseEnv();
  fl.down = true;
  for (let i = 0; i < 8; i++) assert.equal((await call(env, "POST", "/orders", buy())).status, 502, "never locked out for Fleeca's trouble");
  fl.down = false;
  assert.equal((await call(env, "POST", "/orders", buy())).status, 200);
});
