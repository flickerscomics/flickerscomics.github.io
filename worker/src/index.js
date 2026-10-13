/* Flickers Comics staff API (Cloudflare Worker).

   Staff sign in here with a username and password. Passwords are salted and hashed with PBKDF2 and
   only the hash is stored (in Workers KV), so nobody can read a password from the code or the data.
   After signing in, staff load and publish stock through this Worker. The Worker commits the change
   to GitHub using a token that only the Worker knows, so staff don't need GitHub accounts and no
   GitHub token ever reaches a browser.

   Bindings (see wrangler.toml and worker/README.md):
     USERS           KV namespace holding user records
     SESSION_SECRET  secret, random string used to sign session tokens
     SETUP_KEY       secret, lets you create the first owner account once
     GITHUB_TOKEN    secret, fine-grained token with Contents: read and write on the shop repo only
     GITHUB_REPO     "owner/repo"
     GITHUB_BRANCH   branch the site is built from, e.g. "main"
     ALLOWED_ORIGINS comma-separated origins allowed to call this API (the site, plus localhost if wanted)
   Orders and Discord (src/orders.js, docs/DISCORD.md): SITE_URL, ORDERS_ENABLED, DISCORD_WEBHOOK_URL, DISCORD_PING_ROLE */

import { HttpError, bad } from "./http.js";
import { placeOrder, staffOrder, lookupOrder, listOrders, sendTestMessage, updateOrder } from "./orders.js";
import { createWant, listWants, updateWant, deleteWant, announceRestocks, announceNewIssues } from "./wants.js";
import { sendBriefing } from "./briefing.js";
import { handleCallback, handleReturn, sweepAbandoned } from "./payments.js";
import { salesReport, reportParams } from "./sales.js";
import { reorderData } from "./reorder.js";
import { gh, readStock, branchName, serializeProducts, mergeStock } from "./github.js";

const PBKDF2_ITERATIONS = 100000; // Cloudflare Workers allows at most 100,000
const SESSION_HOURS = 12;
const REMEMBER_DAYS = 14;
const MIN_PASSWORD = 10;
const CATEGORIES = ["issues", "graphic", "tpb", "omnibus", "manga", "funko"];
const BADGES = ["new", "variant", "exclusive"];
const COVER_RE = /^assets\/covers\/[a-z0-9][a-z0-9._-]{0,80}\.jpg$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const USER_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;
const MAX_UPLOAD_BYTES = 400 * 1024, MAX_UPLOADS = 30; // each photo is one GitHub call, and a free-plan Worker may make about 50 per request
const enc = new TextEncoder();

/* ---------- small helpers ---------- */
const b64 = bytes => { let s = ""; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
const b64url = bytes => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = str => unb64(str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - str.length % 4) % 4));


function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
const equalStrings = (a, b) => equalBytes(enc.encode(String(a)), enc.encode(String(b)));

/* ---------- passwords ---------- */
export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return { salt: b64(salt), hash: b64(new Uint8Array(bits)), iter: iterations };
}
export async function verifyPassword(password, record) {
  const { hash } = await hashPassword(password, unb64(record.salt), record.iter);
  return equalBytes(unb64(hash), unb64(record.hash));
}
const DUMMY = { salt: b64(new Uint8Array(16)), hash: b64(new Uint8Array(32)), iter: PBKDF2_ITERATIONS };

function checkPasswordRules(pw, username) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) throw bad(400, `Passwords need at least ${MIN_PASSWORD} characters.`);
  if (pw.length > 200) throw bad(400, "That password is too long.");
  if (username && pw.toLowerCase().includes(username.toLowerCase())) throw bad(400, "The password can't contain the username.");
}

/* ---------- session tokens ---------- */
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signToken(secret, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}
export async function verifyToken(secret, token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64url(sig), enc.encode(body)); } catch (e) { return null; }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch (e) { return null; }
}

/* ---------- users ---------- */
const userKey = name => `user:${name}`;
const normName = s => String(s || "").trim().toLowerCase();
async function getUser(env, name) {
  const raw = await env.USERS.get(userKey(name));
  return raw ? JSON.parse(raw) : null;
}
const putUser = (env, u) => env.USERS.put(userKey(u.username), JSON.stringify(u));
const publicUser = u => ({ username: u.username, role: u.role, created: u.created });
async function listUsers(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.USERS.list({ prefix: "user:", cursor });
    for (const k of page.keys) { const raw = await env.USERS.get(k.name); if (raw) out.push(JSON.parse(raw)); }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
async function createUser(env, username, password, role) {
  username = normName(username);
  if (!USER_RE.test(username)) throw bad(400, "Usernames are 3 to 24 characters: letters, numbers, dots, dashes and underscores.");
  checkPasswordRules(password, username);
  if (await getUser(env, username)) throw bad(409, "That username is already taken.");
  const user = { username, role, ...(await hashPassword(password)), pv: 1, created: new Date().toISOString() };
  await putUser(env, user);
  return user;
}

/* ---------- login throttling (best effort: KV is eventually consistent) ---------- */
async function throttle(env, key, limit) {
  const n = Number(await env.USERS.get(key)) || 0;
  if (n >= limit) throw bad(429, "Too many failed sign-ins. Wait 15 minutes and try again.");
  return n;
}
const noteFailure = (env, key, n) => env.USERS.put(key, String(n + 1), { expirationTtl: 900 });

/* ---------- validating what staff send ---------- */
const str = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));
export function cleanProduct(raw, i) {
  const where = `Item ${i + 1}`;
  if (!raw || typeof raw !== "object") throw bad(400, `${where} isn't valid.`);
  const p = { id: str(raw.id, 61) };
  if (!ID_RE.test(p.id)) throw bad(400, `${where} has an invalid id.`);
  if (!CATEGORIES.includes(raw.cat)) throw bad(400, `${p.id}: unknown category.`);
  p.cat = raw.cat;
  p.title = str(raw.title, 120);
  if (!p.title) throw bad(400, `${p.id}: title is required.`);
  for (const [k, max] of [["num", 20], ["vol", 20], ["subtitle", 120], ["variant", 80], ["collects", 120], ["grade", 20], ["publisher", 80]]) {
    const v = str(raw[k], max); if (v) p[k] = v;
  }
  if (raw.pages !== undefined && raw.pages !== "" && raw.pages !== null) {
    const pages = Number(raw.pages);
    if (!Number.isInteger(pages) || pages < 0 || pages > 10000) throw bad(400, `${p.id}: pages must be a whole number.`);
    if (pages) p.pages = pages;
  }
  const price = Number(raw.price), stock = Number(raw.stock);
  if (!Number.isFinite(price) || price < 0 || price > 10000000) throw bad(400, `${p.id}: price must be 0 or more.`);
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000) throw bad(400, `${p.id}: stock must be a whole number.`);
  p.price = price; p.stock = stock;
  p.blurb = str(raw.blurb, 1500);
  const tag = str(raw.tagline, 60); if (tag) p.tagline = tag;
  const badges = Array.isArray(raw.badges) ? raw.badges.filter(b => BADGES.includes(b)) : [];
  if (badges.length) p.badges = [...new Set(badges)];
  const staff = str(raw.staff, 200); if (staff) p.staff = staff;
  if (raw.image) {
    if (!COVER_RE.test(raw.image)) throw bad(400, `${p.id}: that cover image path isn't allowed.`);
    p.image = raw.image;
  }
  return p;
}

function decodeJpeg(b64Str, path) {
  if (!COVER_RE.test(path)) throw bad(400, "That cover image path isn't allowed.");
  let bytes;
  try { bytes = unb64(String(b64Str)); } catch (e) { throw bad(400, "A cover image couldn't be read."); }
  if (bytes.length > MAX_UPLOAD_BYTES) throw bad(413, "A cover image is too large. Photos are shrunk before upload, so try a different photo.");
  if (!(bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)) throw bad(400, "Cover images must be JPEG photos.");
  return String(b64Str);
}

async function publish(env, user, body) {
  if (!Array.isArray(body.products) || body.products.length > 2000) throw bad(400, "The stock list isn't valid.");
  const mine = body.products.map(cleanProduct);
  const uploads = body.uploads && typeof body.uploads === "object" ? Object.entries(body.uploads) : [];
  if (uploads.length > MAX_UPLOADS) throw bad(400, `Too many new photos in one publish (the limit is ${MAX_UPLOADS}). Publish in smaller batches.`);

  const current = await readStock(env);
  let products = mine, merged = false;
  if (current.version !== body.version) {
    // The stock changed after staff loaded it (an order took stock off the shelf, or a colleague published).
    // Lay their changes onto the latest stock rather than overwriting it.
    if (!Array.isArray(body.base) || body.base.length > 2000) throw bad(409, "The stock changed after you loaded it. Reload to get the latest.");
    products = mergeStock(body.base.map(cleanProduct), mine, current.products).map(cleanProduct);
    merged = true;
  }
  const ids = new Set();
  for (const p of products) { if (ids.has(p.id)) throw bad(400, `Two items share the id "${p.id}".`); ids.add(p.id); }
  const featured = (Array.isArray(body.featured) ? body.featured : []).filter(id => ids.has(id)).slice(0, 3);
  const commit = await gh(env, `/git/commits/${current.head}`);

  const tree = [];
  const referenced = new Set(products.map(p => p.image).filter(Boolean));
  const photos = uploads.map(([path, data]) => [path, decodeJpeg(data, path)]).filter(([path]) => referenced.has(path)); // skips photos for items deleted again before publishing
  const blobs = await Promise.all(photos.map(([, content]) => gh(env, "/git/blobs", { method: "POST", body: { content, encoding: "base64" } })));
  photos.forEach(([path], i) => tree.push({ path, mode: "100644", type: "blob", sha: blobs[i].sha }));
  // remove cover photos nothing uses any more
  const oldImages = new Set(current.products.map(p => p.image).filter(Boolean));
  for (const path of oldImages) if (!referenced.has(path) && COVER_RE.test(path)) tree.push({ path, mode: "100644", type: "blob", sha: null });
  for (const p of products) if (p.image && !oldImages.has(p.image) && !uploads.some(([path]) => path === p.image)) throw bad(400, `${p.id}: its cover photo wasn't uploaded.`);

  const productsBlob = await gh(env, "/git/blobs", { method: "POST", body: { content: serializeProducts(products), encoding: "utf-8" } });
  tree.push({ path: "data/products.json", mode: "100644", type: "blob", sha: productsBlob.sha });
  const featuredBlob = await gh(env, "/git/blobs", { method: "POST", body: { content: JSON.stringify(featured, null, 2) + "\n", encoding: "utf-8" } });
  tree.push({ path: "data/featured.json", mode: "100644", type: "blob", sha: featuredBlob.sha });

  const before = new Map(current.products.map(p => [p.id, JSON.stringify(p)]));
  const added = products.filter(p => !before.has(p.id)).length;
  const edited = products.filter(p => before.has(p.id) && before.get(p.id) !== JSON.stringify(p)).length;
  const removed = [...before.keys()].filter(id => !ids.has(id)).length;
  const parts = [added && `${added} added`, edited && `${edited} edited`, removed && `${removed} removed`, JSON.stringify(featured) !== JSON.stringify(current.featured) && "new this week updated"].filter(Boolean);
  if (!parts.length && !tree.some(t => t.path.startsWith("assets/"))) return { ok: true, version: current.version, unchanged: true, ...(merged ? { merged, products } : {}) };

  const newTree = await gh(env, "/git/trees", { method: "POST", body: { base_tree: commit.tree.sha, tree } });
  const newCommit = await gh(env, "/git/commits", { method: "POST", body: { message: `Update stock (${user.username}): ${parts.join(", ") || "photos"}`, tree: newTree.sha, parents: [current.head] } });
  await gh(env, `/git/refs/heads/${branchName(env)}`, { method: "PATCH", body: { sha: newCommit.sha, force: false } });
  // tell staff who was waiting for anything that's back, or for a new issue of a followed series (best effort: the publish already succeeded)
  try { await announceRestocks(env, current.products, products); await announceNewIssues(env, current.products, products); }
  catch (e) { console.error("Couldn't post wanted-list alerts"); }
  return { ok: true, version: productsBlob.sha, commit: newCommit.sha, ...(merged ? { merged, products } : {}) };
}

/* ---------- http ---------- */
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const h = { Vary: "Origin", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Max-Age": "600" };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function readJson(request) {
  try { const text = await request.text(); if (text.length > 6 * 1024 * 1024) throw bad(413, "That request is too large."); return text ? JSON.parse(text) : {}; }
  catch (e) { if (e instanceof HttpError) throw e; throw bad(400, "The request wasn't valid JSON."); }
}

async function authenticate(request, env) {
  const m = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "");
  const payload = m && await verifyToken(env.SESSION_SECRET, m[1]);
  const user = payload && await getUser(env, payload.u);
  if (!user || user.pv !== payload.pv) throw bad(401, "Your session has ended. Sign in again.");
  return user;
}
const needOwner = user => { if (user.role !== "owner") throw bad(403, "Only the owner can do that."); };

async function route(request, env) {
  const url = new URL(request.url), method = request.method, path = url.pathname.replace(/\/+$/, "") || "/";
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (method === "GET" && path === "/") return { ok: true };

  if (method === "POST" && path === "/setup") {
    const body = await readJson(request);
    if (!env.SETUP_KEY || !equalStrings(body.key || "", env.SETUP_KEY)) throw bad(403, "That setup key isn't right.");
    if ((await listUsers(env)).length) throw bad(409, "The shop already has users. Sign in as the owner to add more.");
    const user = await createUser(env, body.username, body.password, "owner");
    return { user: publicUser(user) };
  }

  if (method === "POST" && path === "/login") {
    const body = await readJson(request);
    const name = normName(body.username), ipKey = `rl:ip:${ip}`, userKeyRl = `rl:u:${name}`;
    const ipFails = await throttle(env, ipKey, 10), userFails = await throttle(env, userKeyRl, 20);
    const user = await getUser(env, name);
    const ok = await verifyPassword(String(body.password || ""), user || DUMMY); // same work whether or not the user exists
    if (!user || !ok) {
      await Promise.all([noteFailure(env, ipKey, ipFails), noteFailure(env, userKeyRl, userFails)]);
      throw bad(401, "That username and password don't match.");
    }
    await env.USERS.delete(userKeyRl);
    const ttl = (body.remember ? REMEMBER_DAYS * 24 : SESSION_HOURS) * 3600;
    const exp = Math.floor(Date.now() / 1000) + ttl;
    return { token: await signToken(env.SESSION_SECRET, { u: user.username, pv: user.pv, exp }), exp, user: publicUser(user) };
  }

  if (method === "POST" && path === "/fleeca/callback") return handleCallback(env, request); // server to server: signed, no Origin
  if (method === "POST" && path === "/orders") return placeOrder(env, await readJson(request), ip);
  if (method === "POST" && path === "/orders/lookup") return lookupOrder(env, await readJson(request), ip);
  if (method === "POST" && path === "/wants") return createWant(env, await readJson(request), ip);

  const user = await authenticate(request, env);

  if (method === "GET" && path === "/me") return { user: publicUser(user) };

  if (method === "POST" && path === "/password") {
    const body = await readJson(request);
    if (!(await verifyPassword(String(body.current || ""), user))) throw bad(403, "Your current password isn't right.");
    checkPasswordRules(body.next, user.username);
    const next = { ...user, ...(await hashPassword(body.next)), pv: user.pv + 1 };
    await putUser(env, next);
    return { token: await signToken(env.SESSION_SECRET, { u: next.username, pv: next.pv, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 }) };
  }

  if (method === "GET" && path === "/stock") {
    const s = await readStock(env);
    return { version: s.version, products: s.products, featured: s.featured };
  }
  if (method === "POST" && path === "/publish") return publish(env, user, await readJson(request));

  if (method === "GET" && path === "/orders") return { ...(await listOrders(env, url.searchParams.get("cursor"))), ordersOpen: String(env.ORDERS_ENABLED) === "true", discord: !!env.DISCORD_WEBHOOK_URL };
  if (method === "POST" && path === "/orders/test") return sendTestMessage(env, user);
  if (method === "POST" && path === "/staff/orders") return staffOrder(env, await readJson(request), user);
  if (method === "GET" && path === "/reorder") return reorderData(env);
  if (method === "GET" && path === "/report") { needOwner(user); return salesReport(env, reportParams(url)); }
  if (method === "GET" && path === "/wants") return listWants(env, url.searchParams.get("cursor"));
  const wm = /^\/wants\/([^/]+)$/.exec(path);
  if (wm && method === "POST") return updateWant(env, wm[1], await readJson(request), user);
  if (wm && method === "DELETE") return deleteWant(env, wm[1]);
  const om = /^\/orders\/([^/]+)$/.exec(path);
  if (method === "POST" && om) return updateOrder(env, om[1], await readJson(request), user);

  if (path === "/users" && method === "GET") { needOwner(user); return { users: (await listUsers(env)).map(publicUser) }; }
  if (path === "/users" && method === "POST") {
    needOwner(user);
    const body = await readJson(request);
    const role = body.role === "owner" ? "owner" : "staff";
    return { user: publicUser(await createUser(env, body.username, body.password, role)) };
  }
  const m = /^\/users\/([^/]+)(\/password)?$/.exec(path);
  if (m) {
    needOwner(user);
    const target = await getUser(env, normName(decodeURIComponent(m[1])));
    if (!target) throw bad(404, "No such user.");
    if (method === "DELETE" && !m[2]) {
      if (target.username === user.username) throw bad(400, "You can't remove your own account.");
      await env.USERS.delete(userKey(target.username));
      return { ok: true };
    }
    if (method === "POST" && m[2]) {
      const body = await readJson(request);
      checkPasswordRules(body.password, target.username);
      await putUser(env, { ...target, ...(await hashPassword(body.password)), pv: target.pv + 1 });
      return { ok: true };
    }
  }
  throw bad(404, "Not found.");
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "GET" && new URL(request.url).pathname.replace(/\/+$/, "") === "/fleeca/return") { // the customer's browser coming back from Fleeca
      try { return await handleReturn(env, new URL(request.url)); }
      catch (e) { console.error("Fleeca return failed"); return new Response(null, { status: 303, headers: { Location: `${String(env.SITE_URL || "").replace(/\/+$/, "")}/?payment=unknown` } }); }
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    // Browsers from other sites can't read responses without a matching Origin, but refuse them outright too.
    const origin = request.headers.get("Origin");
    if (origin && !cors["Access-Control-Allow-Origin"]) return json({ error: "This site isn't allowed to use the staff API." }, 403, cors);
    try {
      return json(await route(request, env), 200, cors);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      console.error(e);
      return json({ error: "Something went wrong. Try again." }, 500, cors);
    }
  },
  // Cron triggers (wrangler.toml): the daily briefing at 19:00 UTC, and every 15 minutes the cancelling of online orders nobody paid for.
  async scheduled(event, env, ctx) {
    if (event.cron === "0 19 * * *") ctx.waitUntil(sendBriefing(env).catch(() => console.error("Daily briefing failed")));
    else ctx.waitUntil(sweepAbandoned(env).catch(() => console.error("Payment sweep failed")));
  }
};
