/* The daily briefing: one message in the staff Discord channel with what needs doing. Sent by the Worker's cron trigger
   (19:00 UTC, which is 8 PM UTC+1; see wrangler.toml) and on demand by the owner.

   It only reads, and it's built to stay inside a free-plan Worker's limit of about 50 calls per run: the newest 30 orders
   (one listing plus one read each), the stock from GitHub (a few calls), and the wanted list's key metadata (no reads). */
import { escMd, cut, pingRole, webhook } from "./discord.js";
import { ttlSeconds } from "./orders.js";
import { readStock } from "./github.js";
import { shopConfig, siteBase } from "./shop.js";
import { wantKeys } from "./wants.js";
import { fullTitle, money, REORDER_LOW } from "../../src/shared.mjs";

const ORDERS_READ = 30, SHOWN = 8;
const status = o => o.status || "new";
const awaiting = o => !!o.payment && o.payment.state === "awaiting";
const todayIn = tz => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } };
const ago = iso => { const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000); return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`; };
const more = (lines, n = SHOWN) => lines.slice(0, n).join("\n") + (lines.length > n ? `\n…and ${lines.length - n} more` : "");

/* Everything the message says, as plain data (also what the tests check). */
export async function gatherBriefing(env) {
  const cfg = await shopConfig(env), today = todayIn(cfg.timeZone);
  const page = await env.USERS.list({ prefix: "order:", limit: ORDERS_READ });
  const orders = (await Promise.all(page.keys.map(async k => { const raw = await env.USERS.get(k.name); return raw && Object.assign(JSON.parse(raw), { _key: k.name }); }))).filter(o => o && !o.test);
  const open = orders.filter(o => ["new", "ready"].includes(status(o)) && !awaiting(o));
  const stock = await readStock(env).then(s => s.products).catch(() => null);
  const keys = await wantKeys(env).catch(() => []);
  const waiting = {};
  let requests = 0;
  for (const k of keys) {
    const m = k.metadata;
    if (m && m.k === "restock" && m.p) waiting[m.p] = (waiting[m.p] || 0) + 1;
    else if (m && m.k === "request") requests++;
  }
  return {
    today, orders,
    newOrders: open.filter(o => status(o) === "new").length,
    ready: open.filter(o => status(o) === "ready").length,
    oldest: open.length ? open.reduce((a, b) => (Date.parse(a.placedAt) <= Date.parse(b.placedAt) ? a : b)) : null,
    due: open.filter(o => o.method === "collect" && o.collectDate && o.collectDate <= today).sort((a, b) => a.collectDate.localeCompare(b.collectDate)),
    toPost: open.filter(o => o.method === "post"),
    unpaid: open.filter(o => !o.paid),
    check: orders.filter(o => o.payment && o.payment.flag && status(o) !== "done"),
    awaitingPay: orders.filter(awaiting).length,
    capped: !page.list_complete,
    lastCopies: stock ? stock.filter(p => p.stock >= 1 && p.stock <= REORDER_LOW) : null,
    soldOut: stock ? stock.filter(p => p.stock <= 0).length : null,
    backInStock: stock ? stock.filter(p => p.stock > 0 && waiting[p.id]).map(p => ({ p, people: waiting[p.id] })) : [],
    requests
  };
}

export function briefingEmbed(b, site = "") {
  const orderLine = o => `• **${o.id}** · ${cut(escMd(o.name), 40)} · ${money(o.total)}${o.paid ? "" : " · not paid"}`;
  const fields = [];
  fields.push({ name: "📦 Open orders", value: b.newOrders + b.ready ? `${b.newOrders} new, ${b.ready} ready${b.oldest ? `\nOldest: **${b.oldest.id}**, placed ${ago(b.oldest.placedAt)}` : ""}` : "None. All caught up." });
  if (b.due.length) fields.push({ name: `🕗 Collections due (${b.due.length})`, value: more(b.due.map(o => `${orderLine(o)}${o.collectDate < b.today ? " · **overdue** since " + o.collectDate : ""}`)) });
  if (b.toPost.length) fields.push({ name: `✉️ To post (${b.toPost.length})`, value: more(b.toPost.map(orderLine)) });
  if (b.unpaid.length) fields.push({ name: `💸 Not paid yet (${b.unpaid.length})`, value: more(b.unpaid.map(orderLine), 5) });
  if (b.check.length) fields.push({ name: "⚠️ Check these payments", value: more(b.check.map(o => `• **${o.id}**: ${cut(escMd(o.payment.flag), 150)}`)) });
  if (b.backInStock.length) fields.push({ name: "🔔 Back in stock with people waiting", value: more(b.backInStock.map(({ p, people }) => `• **${cut(escMd(fullTitle(p)), 100)}**: ${people} waiting`)) + "\nContact them in the staff area → Wanted." });
  if (b.lastCopies && b.lastCopies.length) fields.push({ name: `📉 Nearly gone (${b.lastCopies.length})`, value: more(b.lastCopies.map(p => `• **${cut(escMd(fullTitle(p)), 100)}**: ${p.stock} left`), 10) });
  if (b.soldOut) fields.push({ name: "🚫 Sold out", value: `${b.soldOut} comic${b.soldOut === 1 ? "" : "s"}. See the Reorder tab.`, inline: true });
  if (b.requests) fields.push({ name: "💬 Special requests", value: `${b.requests} waiting in Wanted.`, inline: true });
  if (b.awaitingPay) fields.push({ name: "⏳ Waiting on Fleeca", value: `${b.awaitingPay} order${b.awaitingPay === 1 ? "" : "s"} not paid yet (cancelled automatically after 30 minutes).`, inline: true });
  const todo = b.due.length + b.toPost.length + b.check.length + b.backInStock.length;
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(b.today + "T12:00:00Z"));
  return {
    title: `📋 Daily briefing · ${day}`,
    description: todo ? `**${todo} thing${todo === 1 ? "" : "s"} need${todo === 1 ? "s" : ""} a look today.**` : "**Nothing urgent today.** 🎉",
    color: todo ? 0xFFE912 : 0x23A55A,
    ...(site ? { url: `${site}/admin/` } : {}),
    fields,
    footer: { text: b.capped ? "Based on the newest 30 orders" : "Flickers Comics" }
  };
}

/* The briefing has its own role (DISCORD_BRIEFING_ROLE, e.g. @Staff) that it always pings, and optionally its own channel
   (the secret DISCORD_BRIEFING_WEBHOOK_URL, e.g. for #staff-chat). Without them it goes to the orders channel with no ping. */
const briefingRole = env => (/^\d{5,25}$/.test(String(env.DISCORD_BRIEFING_ROLE || "")) ? String(env.DISCORD_BRIEFING_ROLE) : null);

/* Orders that have gone past their day: a collection whose day has passed, or an order to post that's still waiting two days after it was placed.
   Each is pinged once, in the orders channel, however many days it stays overdue (the order is marked). */
const POST_OVERDUE_DAYS = 2, OVERDUE_PER_RUN = 5;
const isOverdue = (o, today) => !o.overduePinged && ["new", "ready"].includes(status(o)) && !awaiting(o) && (
  o.method === "collect" ? !!o.collectDate && o.collectDate < today : Date.now() - Date.parse(o.placedAt) >= POST_OVERDUE_DAYS * 86400000);

export async function pingOverdue(env, b) {
  const late = b.orders.filter(o => isOverdue(o, b.today)).slice(0, OVERDUE_PER_RUN);
  if (!late.length) return 0;
  const role = pingRole(env);
  const lines = late.map(o => o.method === "collect"
    ? `• **${o.id}** · ${cut(escMd(o.name), 40)}: collection was due ${o.collectDate}`
    : `• **${o.id}** · ${cut(escMd(o.name), 40)}: still to post, placed ${ago(o.placedAt)}`);
  const sent = await webhook(env, { payload: {
    username: "Flickers Orders",
    content: `${role ? `<@&${role}> ` : ""}overdue`,
    allowed_mentions: { parse: [], roles: role ? [role] : [] },
    embeds: [{ title: late.length === 1 ? "Order overdue" : `${late.length} orders overdue`, description: lines.join("\n"), color: 0xF59E0B, footer: { text: "Contact the customer, then update the order in the staff area" } }]
  } });
  if (!sent.ok) { console.error("Couldn't post the overdue ping:", sent.reason); return 0; }
  for (const o of late) { const { _key, ...rec } = o; await env.USERS.put(_key, JSON.stringify({ ...rec, overduePinged: true }), { expirationTtl: ttlSeconds(rec) }); }
  return late.length;
}

export async function sendBriefing(env) {
  const b = await gatherBriefing(env);
  await pingOverdue(env, b).catch(() => console.error("Overdue ping failed"));
  const role = briefingRole(env);
  const target = { ...env, DISCORD_WEBHOOK_URL: env.DISCORD_BRIEFING_WEBHOOK_URL || env.DISCORD_WEBHOOK_URL };
  const sent = await webhook(target, { payload: {
    username: "Flickers Orders",
    content: `${role ? `<@&${role}> ` : ""}Tyler here, here's today's briefing.`,
    allowed_mentions: { parse: [], roles: role ? [role] : [] },
    embeds: [briefingEmbed(b, siteBase(env))]
  } });
  if (!sent.ok) console.error("Couldn't post the daily briefing:", sent.reason);
  return { ok: sent.ok, reason: sent.reason };
}
