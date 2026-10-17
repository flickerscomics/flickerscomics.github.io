/* The wanted list: three things customers can ask the shop for, all kept in one place for staff.
     restock  "Tell me when this sold-out comic is back"
     series   "Tell me when a new issue of this series arrives" (a pull list)
     request  "Can you get this comic in for me?" (a special order)
   Customers leave a name and phone number. Nobody is messaged automatically (this is a roleplay phone, not SMS):
   when something is back or a new issue arrives, a message goes to the staff Discord channel listing who to contact,
   and the staff area's Wanted tab shows the same. Records are kept for 120 days. */
import { bad } from "./http.js";
import { loadShop } from "./shop.js";
import { escMd, cut, pingRole, webhook } from "./discord.js";
import { fullTitle, norm, seriesKey } from "../../src/shared.mjs";

const WANT_TTL = 120 * 24 * 3600;
const WANTS_PER_WINDOW = 8, WINDOW_SECONDS = 600, MAX_WANTS = 600, PAGE = 40;
const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const KINDS = ["restock", "series", "request"];
const WANT_STATUSES = ["waiting", "contacted"];
const WANT_ID_RE = /^W-[A-Z2-9]{6}$/;

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const digitsOf = s => String(s || "").replace(/\D/g, "");
const newWantId = () => "W-" + [...crypto.getRandomValues(new Uint8Array(6))].map(b => ID_ALPHABET[b % 32]).join("");
const wantKey = w => `want:${String(9e15 - Date.parse(w.createdAt)).padStart(16, "0")}:${w.id}`;
const dupKey = w => `wdup:${w.kind}:${w.kind === "request" ? norm(w.text) : w.kind === "series" ? w.seriesKey : w.productId}:${digitsOf(w.phone)}`;
const ttlFor = w => Math.max(60, Math.floor(WANT_TTL - (Date.now() - Date.parse(w.createdAt)) / 1000));
const seriesTitle = p => p.title + (p.vol ? " " + p.vol : "");

/* Workers allow only a few dozen KV calls per request on the free plan, and each read is one, so nothing here reads the whole list.
   Each want is stored with a little metadata (kind, comic, series) that a key listing returns for free, so a scan only reads the few that match. */
const metaOf = w => ({ k: w.kind, ...(w.productId ? { p: w.productId } : {}), ...(w.seriesKey ? { s: w.seriesKey.slice(0, 200) } : {}) });
const save = (env, w) => env.USERS.put(wantKey(w), JSON.stringify(w), { expirationTtl: ttlFor(w), metadata: metaOf(w) });
export const wantsFromKeys = (env, keys) => readAll(env, keys);
const readAll = async (env, keys) => (await Promise.all(keys.map(k => env.USERS.get(k.name)))).filter(Boolean).map(raw => JSON.parse(raw));
export async function wantKeys(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.USERS.list({ prefix: "want:", cursor });
    out.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
/* the wants whose metadata passes `test` (wants saved before metadata existed are read to be sure), at most PAGE of them */
const wantsWhere = async (env, test) => (await readAll(env, (await wantKeys(env)).filter(k => !k.metadata || test(k.metadata)).slice(0, PAGE)));

/* ---------- customers ---------- */
export async function createWant(env, raw, ip) {
  if (String(env.ORDERS_ENABLED) !== "true") throw bad(503, "Requests aren't open yet.");
  if (!raw || typeof raw !== "object" || !KINDS.includes(raw.kind)) throw bad(400, "That request wasn't valid.");
  const name = clean(raw.name, 80), phone = clean(raw.phone, 30), digits = digitsOf(phone);
  if (name.length < 3) throw bad(400, "Enter your full name.");
  if (/[^\d\s()+\-#]/.test(phone) || digits.length < 4 || digits.length > 15) throw bad(400, "Enter your phone number using digits only.");

  const rlKey = `rl:want:${ip}`, n = Number(await env.USERS.get(rlKey)) || 0;
  if (n >= WANTS_PER_WINDOW) throw bad(429, "That's a lot of requests from your connection. Wait a few minutes and try again.");
  await env.USERS.put(rlKey, String(n + 1), { expirationTtl: WINDOW_SECONDS });

  const w = { id: newWantId(), kind: raw.kind, name, phone, createdAt: new Date().toISOString(), status: "waiting" };
  if (w.kind === "request") {
    w.text = clean(raw.text, 300);
    if (w.text.length < 3) throw bad(400, "Tell us which comic you're after.");
  } else {
    const shop = await loadShop(env), p = (shop.products || []).find(x => x.id === clean(raw.productId, 61));
    if (!p) throw bad(404, "That comic isn't in the shop any more.");
    w.productId = p.id; w.title = fullTitle(p);
    if (w.kind === "restock" && p.stock > 0) throw bad(409, "That one is in stock right now, so you can order it.");
    if (w.kind === "series") { w.seriesKey = seriesKey(p); w.series = seriesTitle(p); }
  }

  const dk = dupKey(w), existing = await env.USERS.get(dk);
  if (existing) return { ok: true, already: true, id: existing };
  if ((await wantKeys(env)).length >= MAX_WANTS) throw bad(503, "The wanted list is full right now. Please ask in store.");
  await save(env, w);
  await env.USERS.put(`wid:${w.id}`, wantKey(w), { expirationTtl: WANT_TTL });
  await env.USERS.put(dk, w.id, { expirationTtl: WANT_TTL });

  const what = { restock: ["Notify when back in stock", "Comic", w.title, "A customer wants to be told when this is back in stock."], series: ["Pull list: follow a series", "Series", w.series, "A customer wants to hear when a new issue arrives."], request: ["Comic request", "Comic requested", w.text, "A customer is asking if we can get this comic in."] }[w.kind];
  await webhook(env, { payload: { username: "Flickers Orders", allowed_mentions: { parse: [] }, embeds: [{
    title: what[0], description: what[3], color: 0x5865F2,
    fields: [{ name: what[1], value: cut(escMd(what[2]), 250) }, { name: "Customer", value: cut(escMd(name), 200), inline: true }, { name: "Phone", value: cut(escMd(phone), 100), inline: true }],
    footer: { text: "Wanted list · staff area → Wanted" }, timestamp: w.createdAt }] } });
  return { ok: true, id: w.id };
}

/* ---------- staff ---------- */
/* One page, newest first (keys sort that way); `cursor` fetches the next. */
export async function listWants(env, cursor) {
  const page = await env.USERS.list({ prefix: "want:", cursor: cursor || undefined, limit: PAGE });
  return { wants: await readAll(env, page.keys), cursor: page.list_complete ? null : page.cursor };
}

async function findWant(env, id) {
  if (!WANT_ID_RE.test(String(id))) throw bad(400, "That isn't a request number.");
  const key = await env.USERS.get(`wid:${id}`), raw = key && await env.USERS.get(key);
  if (!raw) throw bad(404, "That request wasn't found. It may have been removed.");
  return { key, w: JSON.parse(raw) };
}
export async function updateWant(env, id, patch, user) {
  const { w } = await findWant(env, id);
  if (!patch || !WANT_STATUSES.includes(patch.status)) throw bad(400, "That isn't a valid status.");
  if (patch.status !== w.status) {
    w.status = patch.status;
    if (w.status === "contacted") { w.contactedBy = user.username; w.contactedAt = new Date().toISOString(); } else { delete w.contactedBy; delete w.contactedAt; }
    await save(env, w);
  }
  return { want: w };
}
export async function deleteWant(env, id) {
  const { key, w } = await findWant(env, id);
  await env.USERS.delete(key); await env.USERS.delete(`wid:${id}`); await env.USERS.delete(dupKey(w));
  return { ok: true };
}

/* ---------- alerts to staff ---------- */
const people = list => list.slice(0, 20).map(w => `• ${cut(escMd(w.name), 60)} · ${escMd(w.phone)}`).join("\n") + (list.length > 20 ? `\n…and ${list.length - 20} more` : "");

/* A sold-out comic has come back: tell staff who asked to be told. before/after are the stock lists either side of the change. */
export async function announceRestocks(env, before, after) {
  const was = new Map((before || []).map(p => [p.id, p.stock]));
  const back = (after || []).filter(p => p.stock > 0 && was.has(p.id) && was.get(p.id) <= 0);
  if (!back.length) return;
  const ids = new Set(back.map(p => p.id));
  const wants = (await wantsWhere(env, m => m.k === "restock" && ids.has(m.p))).filter(w => w.kind === "restock" && !w.backAt);
  const role = pingRole(env);
  for (const p of back) {
    const group = wants.filter(w => w.productId === p.id);
    if (!group.length) continue;
    const sent = await webhook(env, { payload: {
      username: "Flickers Orders", content: role ? `<@&${role}> back in stock` : undefined,
      allowed_mentions: { parse: [], roles: role ? [role] : [] },
      embeds: [{ title: `Back in stock: ${fullTitle(p)}`, description: `${p.stock} on the shelf. ${group.length} ${group.length === 1 ? "person asked" : "people asked"} to be told:\n${people(group)}`, color: 0x23A55A, footer: { text: "Contact them, then mark them contacted in the staff area → Wanted" } }]
    } });
    for (const w of group) { w.backAt = new Date().toISOString(); w.status = "waiting"; await save(env, w); }
    if (!sent.ok) console.error("Couldn't post a restock alert");
  }
}

/* A new issue of something customers follow has been added to the shop. */
export async function announceNewIssues(env, before, after) {
  const had = new Set((before || []).map(p => p.id));
  const fresh = (after || []).filter(p => !had.has(p.id) && p.stock > 0);
  if (!fresh.length) return;
  const keys = new Set(fresh.map(seriesKey));
  const follows = (await wantsWhere(env, m => m.k === "series" && keys.has(m.s))).filter(w => w.kind === "series");
  if (!follows.length) return;
  const role = pingRole(env);
  for (const p of fresh) {
    const key = seriesKey(p), group = follows.filter(w => w.seriesKey === key && !(w.notified || []).includes(p.id));
    if (!group.length) continue;
    await webhook(env, { payload: {
      username: "Flickers Orders", content: role ? `<@&${role}> new issue for the pull list` : undefined,
      allowed_mentions: { parse: [], roles: role ? [role] : [] },
      embeds: [{ title: `New issue: ${fullTitle(p)}`, description: `${group.length} ${group.length === 1 ? "customer follows" : "customers follow"} **${escMd(seriesTitle(p))}**:\n${people(group)}`, color: 0x23A55A, footer: { text: "Set one aside and contact them, then mark them contacted in the staff area → Wanted" } }]
    } });
    for (const w of group) {
      w.notified = [...(w.notified || []), p.id].slice(-50);
      w.latest = { id: p.id, title: fullTitle(p), at: new Date().toISOString() };
      w.status = "waiting"; delete w.contactedBy; delete w.contactedAt;
      await save(env, w);
    }
  }
}
