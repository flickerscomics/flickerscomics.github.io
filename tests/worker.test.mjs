import test from "node:test";
import assert from "node:assert/strict";
import worker, { hashPassword, verifyPassword, signToken, verifyToken } from "../worker/src/index.js";
import { FakeKV } from "./helpers.mjs";

/* ---------- fakes ---------- */
const ORIGIN = "https://shop.example";
const baseEnv = () => ({
  USERS: new FakeKV(), SESSION_SECRET: "test-secret-0123456789", SETUP_KEY: "setup-key", GITHUB_TOKEN: "ghp_fake",
  GITHUB_REPO: "o/r", GITHUB_BRANCH: "main", ALLOWED_ORIGINS: ORIGIN
});
const call = (env, method, path, body, token, headers = {}) => worker.fetch(new Request("https://api.test" + path, {
  method, headers: { Origin: ORIGIN, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined
}), env);
const j = async res => ({ status: res.status, ...(await res.json()) });

async function setup(env) {
  await call(env, "POST", "/setup", { key: "setup-key", username: "Owner", password: "correct horse battery" });
  const r = await j(await call(env, "POST", "/login", { username: "owner", password: "correct horse battery" }));
  return r.token;
}

/* a tiny in-memory GitHub */
function fakeGitHub(initialProducts) {
  const state = { products: initialProducts, featured: [], head: "head1", n: 0, calls: [], blobs: {}, tree: null, message: null };
  const b64 = s => Buffer.from(s).toString("base64");
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url), path = u.pathname.replace("/repos/o/r", ""), method = opts.method || "GET";
    state.calls.push(`${method} ${path}`);
    const ok = data => new Response(JSON.stringify(data), { status: 200 });
    if (path.startsWith("/git/ref/heads/")) return ok({ object: { sha: state.head } });
    if (path === "/contents/data/products.json") return ok({ sha: "psha" + state.products.length, content: b64(JSON.stringify(state.products)) });
    if (path === "/contents/data/featured.json") return ok({ sha: "fsha", content: b64(JSON.stringify(state.featured)) });
    if (path.startsWith("/git/commits/") && method === "GET") return ok({ tree: { sha: "tree0" } });
    if (path === "/git/blobs") { const sha = "blob" + (++state.n); state.blobs[sha] = JSON.parse(opts.body); return ok({ sha }); }
    if (path === "/git/trees") { state.tree = JSON.parse(opts.body).tree; return ok({ sha: "tree1" }); }
    if (path === "/git/commits") { state.message = JSON.parse(opts.body).message; return ok({ sha: "commit1" }); }
    if (path.startsWith("/git/refs/heads/")) return ok({});
    return new Response("{}", { status: 404 });
  };
  return state;
}
const item = (over = {}) => ({ id: "batman-1", cat: "issues", title: "Batman", num: "#1", publisher: "DC Comics", price: 400, stock: 3, blurb: "Hi.", ...over });

/* ---------- crypto ---------- */
test("password hashes verify, and differ per salt", async () => {
  const a = await hashPassword("hunter2-hunter2"), b = await hashPassword("hunter2-hunter2");
  assert.notEqual(a.hash, b.hash);
  assert.ok(await verifyPassword("hunter2-hunter2", a));
  assert.ok(!(await verifyPassword("hunter3-hunter3", a)));
  assert.ok(!JSON.stringify(a).includes("hunter2"));
});
test("tokens round trip, expire and reject tampering", async () => {
  const t = await signToken("s", { u: "a", exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal((await verifyToken("s", t)).u, "a");
  assert.equal(await verifyToken("other", t), null);
  const [body, sig] = t.split(".");
  assert.equal(await verifyToken("s", `${body}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`), null);
  assert.equal(await verifyToken("s", `${body.slice(0, -2)}xx.${sig}`), null);
  assert.equal(await verifyToken("s", await signToken("s", { u: "a", exp: 1 })), null);
});

/* ---------- accounts ---------- */
test("setup works once, with the right key", async () => {
  const env = baseEnv();
  assert.equal((await j(await call(env, "POST", "/setup", { key: "nope", username: "owner", password: "correct horse battery" }))).status, 403);
  assert.equal((await j(await call(env, "POST", "/setup", { key: "setup-key", username: "owner", password: "short" }))).status, 400);
  assert.equal((await j(await call(env, "POST", "/setup", { key: "setup-key", username: "owner", password: "correct horse battery" }))).status, 200);
  assert.equal((await j(await call(env, "POST", "/setup", { key: "setup-key", username: "two", password: "correct horse battery" }))).status, 409);
  const stored = [...env.USERS.m.values()].join("");
  assert.ok(!stored.includes("correct horse"), "plain password must never be stored");
});
test("login: wrong password and unknown user get the same answer", async () => {
  const env = baseEnv(); await setup(env);
  const a = await j(await call(env, "POST", "/login", { username: "owner", password: "wrong wrong wrong" }));
  const b = await j(await call(env, "POST", "/login", { username: "ghost", password: "wrong wrong wrong" }));
  assert.equal(a.status, 401); assert.deepEqual(a, b);
});
test("login is throttled after repeated failures", async () => {
  const env = baseEnv(); await setup(env);
  let last;
  for (let i = 0; i < 11; i++) last = await j(await call(env, "POST", "/login", { username: "owner", password: "bad bad bad bad" }, null, { "CF-Connecting-IP": "9.9.9.9" }));
  assert.equal(last.status, 429);
});
test("a correct sign-in clears earlier failed attempts for that user", async () => {
  const env = baseEnv(); await setup(env);
  for (let i = 0; i < 4; i++) await call(env, "POST", "/login", { username: "owner", password: "wrong wrong wrong" });
  assert.ok(env.USERS.m.has("rl:u:owner"));
  assert.equal((await j(await call(env, "POST", "/login", { username: "owner", password: "correct horse battery" }))).status, 200);
  assert.ok(!env.USERS.m.has("rl:u:owner"));
});
test("protected routes need a valid token; staff can't manage users", async () => {
  const env = baseEnv(); const owner = await setup(env);
  assert.equal((await j(await call(env, "GET", "/me"))).status, 401);
  assert.equal((await j(await call(env, "POST", "/users", { username: "sam", password: "blue-umbrella-42", role: "staff" }, owner))).status, 200);
  const sam = (await j(await call(env, "POST", "/login", { username: "sam", password: "blue-umbrella-42" }))).token;
  assert.equal((await j(await call(env, "GET", "/users", null, sam))).status, 403);
  assert.equal((await j(await call(env, "GET", "/users", null, owner))).users.length, 2);
});
test("changing a password signs out old sessions", async () => {
  const env = baseEnv(); const old = await setup(env);
  const r = await j(await call(env, "POST", "/password", { current: "correct horse battery", next: "a brand new passphrase" }, old));
  assert.equal(r.status, 200);
  assert.equal((await j(await call(env, "GET", "/me", null, old))).status, 401);
  assert.equal((await j(await call(env, "GET", "/me", null, r.token))).status, 200);
});
test("owner can reset a password and remove staff but not themselves", async () => {
  const env = baseEnv(); const owner = await setup(env);
  await call(env, "POST", "/users", { username: "sam", password: "blue-umbrella-42" }, owner);
  assert.equal((await j(await call(env, "POST", "/users/sam/password", { password: "another-long-one" }, owner))).status, 200);
  assert.equal((await j(await call(env, "POST", "/login", { username: "sam", password: "blue-umbrella-42" }))).status, 401);
  assert.equal((await j(await call(env, "POST", "/login", { username: "sam", password: "another-long-one" }))).status, 200);
  assert.equal((await j(await call(env, "DELETE", "/users/owner", null, owner))).status, 400);
  assert.equal((await j(await call(env, "DELETE", "/users/sam", null, owner))).status, 200);
});
test("other origins are refused", async () => {
  const env = baseEnv();
  const res = await call(env, "POST", "/login", { username: "a", password: "b" }, null, { Origin: "https://evil.example" });
  assert.equal(res.status, 403);
});

/* ---------- publishing ---------- */
test("publish commits products, featured and new photos in one commit", async () => {
  const env = baseEnv(); const token = await setup(env);
  const gh = fakeGitHub([item()]);
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).toString("base64");
  const body = {
    version: "psha1", featured: ["batman-1", "ghost"],
    products: [item({ stock: 5 }), item({ id: "new-one", title: "New One", image: "assets/covers/new-one-abc.jpg", hacker: "<script>" })],
    uploads: { "assets/covers/new-one-abc.jpg": jpeg }
  };
  const r = await j(await call(env, "POST", "/publish", body, token));
  assert.equal(r.status, 200);
  assert.match(gh.message, /Update stock \(owner\): 1 added, 1 edited/);
  const paths = gh.tree.map(t => t.path).sort();
  assert.deepEqual(paths, ["assets/covers/new-one-abc.jpg", "data/featured.json", "data/products.json"]);
  const productsBlob = Object.values(gh.blobs).find(b => b.content.includes("new-one"));
  assert.ok(!productsBlob.content.includes("hacker"), "unknown fields are dropped");
  const out = JSON.parse(productsBlob.content), day = new Date().toISOString().slice(0, 10);
  assert.equal(out.find(p => p.id === "new-one").added, day, "a new comic is dated the day it's published, for Newest arrivals");
  assert.equal(out.find(p => p.id === "batman-1").added, undefined, "comics that were already on the shelf aren't given a date");
  assert.deepEqual(JSON.parse(Object.values(gh.blobs).find(b => b.content.includes("batman-1") && !b.content.includes("title")).content), ["batman-1"]);
});
test("publish refuses a stale version, bad data and non-JPEG uploads", async () => {
  const env = baseEnv(); const token = await setup(env);
  fakeGitHub([item()]);
  assert.equal((await j(await call(env, "POST", "/publish", { version: "old", products: [item()], featured: [] }, token))).status, 409);
  assert.equal((await j(await call(env, "POST", "/publish", { version: "psha1", products: [item({ price: -1 })], featured: [] }, token))).status, 400);
  assert.equal((await j(await call(env, "POST", "/publish", { version: "psha1", products: [item({ id: "../x" })], featured: [] }, token))).status, 400);
  assert.equal((await j(await call(env, "POST", "/publish", { version: "psha1", products: [item(), item()], featured: [] }, token))).status, 400);
  const notJpeg = Buffer.from("<html>").toString("base64");
  const r = await j(await call(env, "POST", "/publish", { version: "psha1", products: [item({ image: "assets/covers/a.jpg" })], featured: [], uploads: { "assets/covers/a.jpg": notJpeg } }, token));
  assert.equal(r.status, 400);
  assert.equal((await j(await call(env, "POST", "/publish", { version: "psha1", products: [item({ image: "../../etc/passwd" })], featured: [] }, token))).status, 400);
});
test("publish removes photos that nothing uses any more", async () => {
  const env = baseEnv(); const token = await setup(env);
  const gh = fakeGitHub([item({ image: "assets/covers/old.jpg" })]);
  const r = await j(await call(env, "POST", "/publish", { version: "psha1", products: [item({ stock: 1 })], featured: [] }, token));
  assert.equal(r.status, 200);
  assert.ok(gh.tree.some(t => t.path === "assets/covers/old.jpg" && t.sha === null));
});
