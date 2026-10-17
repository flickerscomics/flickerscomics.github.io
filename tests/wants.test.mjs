/* The wanted list: notify me, pull list, comic requests, and the alerts to staff. */
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { FakeKV } from "./helpers.mjs";

const ORIGIN = "https://shop.example", HOOK = "https://discord.test/api/webhooks/1/secret-token";
const COMICS = () => [
  { id: "batman-1", cat: "issues", title: "Batman", num: "#1", price: 400, stock: 3, blurb: "x" },
  { id: "gone-5", cat: "issues", title: "Gone Girl", num: "#5", price: 500, stock: 0, blurb: "x" },
  { id: "one-left", cat: "issues", title: "Rare", num: "#9", price: 900, stock: 1, blurb: "x" }
];
const baseEnv = (over = {}) => ({
  USERS: new FakeKV(), SESSION_SECRET: "test-secret-0123456789", SETUP_KEY: "k", GITHUB_TOKEN: "x", GITHUB_REPO: "o/r", GITHUB_BRANCH: "main",
  ALLOWED_ORIGINS: ORIGIN, SITE_URL: ORIGIN, ORDERS_ENABLED: "true", DISCORD_WEBHOOK_URL: HOOK, ...over
});
const call = (env, method, path, body, token, ip = "1.2.3.4") => worker.fetch(new Request("https://api.test" + path, {
  method, headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env);
const j = async pending => { const res = await pending; return { status: res.status, ...(await res.json()) }; };
async function staff(env) {
  await call(env, "POST", "/setup", { key: "k", username: "owner", password: "correct horse battery" });
  return (await j(await call(env, "POST", "/login", { username: "owner", password: "correct horse battery" }))).token;
}
const want = (env, over, ip) => j(call(env, "POST", "/wants", { kind: "restock", productId: "gone-5", name: "Jamie Reyes", phone: "555 0142", ...over }, null, ip));

function world({ published = COMICS() } = {}) {
  const st = { published, products: COMICS(), featured: [], head: 1, blobs: {}, n: 0, posts: [], raced: false, lastTree: null };
  const b64 = s => Buffer.from(s).toString("base64");
  const ok = d => new Response(JSON.stringify(d), { status: 200 });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), method = opts.method || "GET";
    if (u === `${ORIGIN}/data/shop.json`) return ok({ config: { postage: 1000, openHour: 20, closeHour: 22 }, products: st.published });
    if (u.startsWith(HOOK)) { const body = JSON.parse(opts.body); st.posts.push(body); return ok({ id: String(1000 + st.posts.length) }); }
    if (u.startsWith("https://api.github.com/repos/o/r")) {
      const path = new URL(u).pathname.replace("/repos/o/r", "");
      if (path.startsWith("/git/ref/heads/") && method === "GET") return ok({ object: { sha: "head" + st.head } });
      if (path === "/contents/data/products.json") return ok({ sha: "v" + st.head, content: b64(JSON.stringify(st.products)) });
      if (path === "/contents/data/featured.json") return ok({ sha: "f", content: b64(JSON.stringify(st.featured)) });
      if (path.startsWith("/git/commits/") && method === "GET") return ok({ tree: { sha: "t0" } });
      if (path === "/git/blobs") { const sha = "b" + (++st.n); st.blobs[sha] = JSON.parse(opts.body); return ok({ sha }); }
      if (path === "/git/trees") { st.lastTree = JSON.parse(opts.body).tree; return ok({ sha: "t1" }); }
      if (path === "/git/commits" && method === "POST") return ok({ sha: "c" + st.n });
      if (path.startsWith("/git/refs/heads/") && method === "PATCH") { st.products = JSON.parse(st.blobs[st.lastTree.find(t => t.path === "data/products.json").sha].content); st.head++; return ok({}); }
    }
    return new Response("{}", { status: 404 });
  };
  return st;
}
const embedOf = st => st.posts.map(p => p.embeds && p.embeds[0]).filter(Boolean);

test("a customer can ask to be told when a sold-out comic is back, once", async () => {
  const st = world(), env = baseEnv();
  const r = await want(env);
  assert.equal(r.status, 200);
  assert.match(r.id, /^W-[A-Z2-9]{6}$/);
  assert.equal(embedOf(st)[0].title, "Notify when back in stock");
  assert.match(embedOf(st)[0].fields[0].value, /Gone Girl #5/);
  const again = await want(env, { phone: "5550142" });
  assert.equal(again.already, true, "the same person asking twice (even typing the phone differently) isn't added twice");
  assert.equal(embedOf(st).length, 1, "and staff aren't pinged twice");
});

test("you can't ask to be told about a comic that's in stock, or one that doesn't exist", async () => {
  world();
  const env = baseEnv();
  assert.equal((await want(env, { productId: "batman-1" })).status, 409);
  assert.equal((await want(env, { productId: "nope" })).status, 404);
});

test("following a series and requesting a comic", async () => {
  const st = world(), env = baseEnv();
  const s = await want(env, { kind: "series", productId: "batman-1" });
  assert.equal(s.status, 200);
  assert.equal(embedOf(st)[0].title, "Pull list: follow a series");
  const q = await want(env, { kind: "request", productId: undefined, text: "Absolute Wonder Woman #1, any cover" });
  assert.equal(q.status, 200);
  assert.match(embedOf(st)[1].fields[0].value, /Absolute Wonder Woman/);
});

test("bad requests are refused clearly, and people can't flood the list", async () => {
  world();
  const cases = [[{ kind: "teleport" }, 400], [{ name: "Al" }, 400], [{ phone: "call me" }, 400], [{ kind: "request", text: "" }, 400], [{ kind: "request", text: "x" }, 400]];
  for (const [over, status] of cases) assert.equal((await want(baseEnv(), over)).status, status, JSON.stringify(over));
  const env = baseEnv();
  let last;
  for (let i = 0; i < 9; i++) last = await want(env, { kind: "request", text: "Some comic number " + i });
  assert.equal(last.status, 429);
  assert.equal((await want(baseEnv({ ORDERS_ENABLED: "false" }))).status, 503, "closed while ordering is off");
});

test("customer text can't ping anyone in the Discord post", async () => {
  const st = world(), env = baseEnv({ DISCORD_PING_ROLE: "123456789012345678" });
  await want(env, { kind: "request", name: "@everyone **x**", text: "<@123456789> @here please" });
  const post = st.posts[0];
  assert.deepEqual(post.allowed_mentions.parse, []);
  assert.ok(!post.content, "new requests don't ping the staff role either");
  assert.ok(!JSON.stringify(post).includes("@everyone") && !JSON.stringify(post).includes("@here"), "mentions are broken up");
});

test("staff see the list, mark people contacted, and remove them", async () => {
  world();
  const env = baseEnv(), token = await staff(env);
  assert.equal((await j(call(env, "GET", "/wants"))).status, 401);
  const { id } = await want(env);
  const list = await j(call(env, "GET", "/wants", null, token));
  assert.equal(list.wants.length, 1);
  assert.equal(list.wants[0].name, "Jamie Reyes");
  assert.ok(!JSON.stringify(list).includes("secret-token"));
  const r = await j(call(env, "POST", `/wants/${id}`, { status: "contacted" }, token));
  assert.equal(r.want.status, "contacted");
  assert.equal(r.want.contactedBy, "owner");
  assert.equal((await j(call(env, "POST", `/wants/${id}`, { status: "bogus" }, token))).status, 400);
  assert.equal((await j(call(env, "POST", "/wants/W-AAAAAA", { status: "waiting" }, token))).status, 404);
  assert.equal((await j(call(env, "DELETE", `/wants/${id}`, null, token))).status, 200);
  assert.equal((await j(call(env, "GET", "/wants", null, token))).wants.length, 0);
  assert.equal((await want(env)).already, undefined, "after removal the same person can ask again");
});

test("when staff restock a sold-out comic, Discord lists who asked", async () => {
  const st = world(), env = baseEnv({ DISCORD_PING_ROLE: "123456789012345678" }), token = await staff(env);
  await want(env, { name: "Jamie Reyes", phone: "5550142" });
  await want(env, { name: "Alex Moreno", phone: "5550123" });
  st.posts.length = 0;
  const loaded = await j(call(env, "GET", "/stock", null, token));
  const mine = loaded.products.map(p => ({ ...p, ...(p.id === "gone-5" ? { stock: 4 } : {}) }));
  assert.equal((await j(call(env, "POST", "/publish", { version: loaded.version, base: loaded.products, products: mine, featured: [] }, token))).status, 200);
  const alerts = embedOf(st).filter(e => /^Back in stock/.test(e.title));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].description, /2 people asked/);
  assert.match(alerts[0].description, /Jamie Reyes · 5550142/);
  assert.match(alerts[0].description, /Alex Moreno/);
  assert.match(st.posts.find(p => p.embeds && /^Back in stock/.test(p.embeds[0].title)).content, /<@&123456789012345678>/);
  const list = await j(call(env, "GET", "/wants", null, token));
  assert.ok(list.wants.every(w => w.backAt), "the list marks them as ready to contact");

  // selling out and restocking again doesn't re-alert the same people
  st.posts.length = 0;
  const l2 = await j(call(env, "GET", "/stock", null, token));
  const soldOut = l2.products.map(p => ({ ...p, ...(p.id === "gone-5" ? { stock: 0 } : {}) }));
  await call(env, "POST", "/publish", { version: l2.version, base: l2.products, products: soldOut, featured: [] }, token);
  const l3 = await j(call(env, "GET", "/stock", null, token));
  await call(env, "POST", "/publish", { version: l3.version, base: l3.products, products: l3.products.map(p => ({ ...p, ...(p.id === "gone-5" ? { stock: 2 } : {}) })), featured: [] }, token);
  assert.equal(embedOf(st).filter(e => /^Back in stock/.test(e.title)).length, 0);
});

test("a cancelled order that frees the last copy alerts the people waiting", async () => {
  const st = world(), env = baseEnv(), token = await staff(env);
  const placed = await j(call(env, "POST", "/orders", { name: "Buyer Person", phone: "5550111", method: "collect", collectDate: new Date().toISOString().slice(0, 10), items: [{ id: "one-left", qty: 1 }] }));
  assert.equal(placed.status, 200);
  assert.equal(st.products.find(p => p.id === "one-left").stock, 0);
  st.published.find(p => p.id === "one-left").stock = 0; // the site rebuilds and now shows it sold out
  await want(env, { productId: "one-left", name: "Waiting Person", phone: "5550999" });
  st.posts.length = 0;
  await call(env, "POST", `/orders/${placed.orderId}`, { status: "cancelled" }, token);
  const alert = embedOf(st).find(e => /^Back in stock: Rare #9/.test(e.title));
  assert.ok(alert, "the cancellation freed the copy and staff were told");
  assert.match(alert.description, /Waiting Person/);
});

test("a new issue of a followed series alerts followers once each", async () => {
  const st = world(), env = baseEnv(), token = await staff(env);
  await want(env, { kind: "series", productId: "batman-1", name: "Pull List Fan", phone: "5550777" });
  st.posts.length = 0;
  const publishWith = async extra => {
    const l = await j(call(env, "GET", "/stock", null, token));
    return j(call(env, "POST", "/publish", { version: l.version, base: l.products, products: [...l.products, ...extra], featured: [] }, token));
  };
  const issue = (n, over = {}) => ({ id: `batman-${n}`, cat: "issues", title: "Batman", num: `#${n}`, price: 400, stock: 5, blurb: "x", ...over });

  await publishWith([{ id: "other-1", cat: "issues", title: "Unrelated", num: "#1", price: 300, stock: 2, blurb: "x" }]);
  assert.equal(embedOf(st).length, 0, "an unrelated new comic alerts nobody");

  await publishWith([issue(2)]);
  let alerts = embedOf(st).filter(e => /^New issue/.test(e.title));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].title, /Batman #2/);
  assert.match(alerts[0].description, /Pull List Fan · 5550777/);

  const list = await j(call(env, "GET", "/wants", null, token));
  assert.equal(list.wants[0].latest.title, "Batman #2");
  await call(env, "POST", `/wants/${list.wants[0].id}`, { status: "contacted" }, token);

  await publishWith([issue(3)]);
  alerts = embedOf(st).filter(e => /^New issue/.test(e.title));
  assert.equal(alerts.length, 2, "the next issue alerts them again");
  assert.equal((await j(call(env, "GET", "/wants", null, token))).wants[0].status, "waiting", "and puts them back in the queue");
});
