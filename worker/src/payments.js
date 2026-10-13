/* Online payments through Fleeca: what happens after the customer has been sent to pay.

   An online order is saved and its comics held, then waits ("awaiting"). Only a signed webhook, or a payment we fetch from Fleeca
   ourselves, can change that. The customer's browser never can: the return page only reads what we already know.
     paid    -> marked paid, posted to Discord, counted as a sale
     failed  -> cancelled, comics back on the shelf
     else    -> left waiting; the sweep (every 15 minutes) cancels orders still unpaid after 30 minutes
   Webhooks can arrive twice, late or out of order, so every step checks the order's current state first. */
import { bad } from "./http.js";
import { adjustStock } from "./github.js";
import { shopConfig, siteBase } from "./shop.js";
import { webhook, escMd, pingRole } from "./discord.js";
import { announceLowStock } from "./alerts.js";
import { recordSale } from "./sales.js";
import { orderStatus, isAwaiting, findOrderKey, postToDiscord, editDiscord, ttlSeconds } from "./orders.js";
import { getPayment, verifySignature, modeNumber, fleecaMode } from "./fleeca.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ABANDON_MS = 30 * 60 * 1000, LONG_PENDING_MS = 2 * 3600 * 1000, SWEEP_BATCH = 3, RECHECK_MS = 20 * 1000, RETURN_WAIT_MS = 1500;

const save = (env, key, o) => env.USERS.put(key, JSON.stringify(o), { expirationTtl: ttlSeconds(o) });
const note = (o, change) => { o.history = [...(o.history || []), { at: new Date().toISOString(), by: "Fleeca", change }].slice(-30); };
const lines = o => o.items.map(i => [i.id, i.qty]);

async function staffAlert(env, text) {
  const role = pingRole(env);
  const sent = await webhook(env, { payload: { username: "Flickers Orders", content: (role ? `<@&${role}> ` : "") + text, allowed_mentions: { parse: [], roles: role ? [role] : [] } } });
  if (!sent.ok) console.error("Couldn't post a payment alert");
}

async function loadByPayment(env, id) {
  if (!UUID.test(String(id))) return null;
  const key = await env.USERS.get(`pay:${String(id).toLowerCase()}`) || await env.USERS.get(`pay:${id}`);
  const raw = key && await env.USERS.get(key);
  return raw ? { key, o: JSON.parse(raw) } : null;
}

/* Cancel an order nobody paid for and put its comics back. The record stays so the customer's tracking page and staff can see what happened. */
async function cancelUnpaid(env, key, o, state) {
  if (orderStatus(o) !== "cancelled") {
    if (o.stock === "held") {
      try { await adjustStock(env, lines(o), `Order ${o.id} not paid: comics put back on the shelf`); o.stock = "released"; }
      catch (e) { o.stock = "restore-failed"; console.error("Couldn't restore stock for an unpaid order"); await staffAlert(env, `Order ${o.id} wasn't paid and was cancelled, but its comics couldn't be put back in stock automatically. Add them back under Stock.`); }
    }
    o.status = "cancelled"; o.completedAt = new Date().toISOString();
    note(o, "cancelled: not paid");
  }
  o.payment = { ...o.payment, state };
  await env.USERS.delete(`await:${o.id}`);
  await save(env, key, o);
}

/* Apply what Fleeca says about a payment ({status, amount, mode, payer_name, payer_routing, paid_at}) to the order it belongs to.
   Safe to call again with the same news. Returns what happened. */
export async function settle(env, key, o, p) {
  const pay = o.payment || (o.payment = { provider: "fleeca", state: "awaiting" });
  const status = String(p.status || "");

  if (status === "payment_successful") {
    if (pay.state === "paid") return "paid"; // the same webhook again
    const fresh = await env.USERS.get(key); // another request (the webhook and the return page arrive together) may have just finished it
    if (fresh && (JSON.parse(fresh).payment || {}).state === "paid") return "paid";
    const mode = modeNumber(p.mode);
    const wrong = Number(p.amount) !== o.total ? `Fleeca says $${Number(p.amount)} was paid but the order is $${o.total}`
      : mode === null || mode !== modeNumber(pay.mode) || mode !== fleecaMode(env) ? "the payment's mode (sandbox or live) doesn't match this order" : "";
    if (wrong) {
      if (!pay.flag) { pay.flag = wrong; await save(env, key, o); await staffAlert(env, `Order ${o.id}: ${wrong}. It was NOT marked paid. Check the payment in Fleeca's Merchant Center.`); }
      return "flagged";
    }
    let late = "";
    if (orderStatus(o) === "cancelled") { // paid after it was cancelled (a slow customer, or the link outlived the 30 minutes)
      if (o.stock === "released") {
        try { await adjustStock(env, lines(o).map(([id, q]) => [id, -q]), `Order ${o.id} paid after it was cancelled: comics taken off the shelf again`); o.stock = "held"; o.status = "new"; delete o.completedAt; note(o, "reopened: paid after cancelling"); }
        catch (e) { late = "Paid after it was cancelled, and the comics are no longer in stock. Refund the customer on Fleeca."; }
      } else if (o.stock !== "restore-failed") { o.status = "new"; delete o.completedAt; note(o, "reopened: paid after cancelling"); }
      else late = "Paid after it was cancelled. Its comics were never put back, so check the stock, or refund the customer on Fleeca.";
    }
    if (late) pay.flag = late;
    Object.assign(pay, { state: "paid", status, payerName: String(p.payer_name || "").slice(0, 100), payerRouting: String(p.payer_routing || "").slice(0, 20), paidAt: p.paid_at || new Date().toISOString() });
    const sandbox = mode === 0; // a sandbox payment moves no money, so it must never make a real order "paid"
    if (sandbox) { pay.sandbox = true; pay.flag = pay.flag || "Sandbox payment: no money moved. Not marked paid."; note(o, "sandbox payment (no money moved)"); }
    else { o.paid = true; note(o, "paid via Fleeca"); }
    await env.USERS.delete(`await:${o.id}`);
    const cfg = await shopConfig(env);
    if (o.discordId) { const r = await editDiscord(env, o, cfg); o.discord = r.ok ? "sent" : `failed: ${r.reason}`; }
    else { const sent = await postToDiscord(env, o, cfg); o.discord = sent.ok ? "sent" : `failed: ${sent.reason}`; if (sent.id) o.discordId = sent.id; }
    const low = o.lowAt; delete o.lowAt;
    await save(env, key, o);
    if (o.paid) await recordSale(env, o).catch(() => {}); // an online order is a sale only once it's really paid
    if (late) await staffAlert(env, `Order ${o.id}: ${late}`);
    if (low) await announceLowStock(env, low.map(([id, b]) => ({ id, stock: b })), low.map(([id, , a]) => ({ id, stock: a }))).catch(() => {});
    return "paid";
  }

  if (status === "payment_failed") {
    if (pay.state !== "awaiting") return pay.state; // already paid, cancelled or settled
    await cancelUnpaid(env, key, o, "failed");
    return "failed";
  }

  if (status === "pending" && pay.state === "awaiting" && pay.status !== "pending") { pay.status = "pending"; await save(env, key, o); }
  return "awaiting";
}

/* POST /fleeca/callback: the webhook. Always verified against the raw body; unknown payments are acknowledged and ignored. */
export async function handleCallback(env, request) {
  const raw = await request.text();
  const p = raw.length < 20000 ? await verifySignature(raw, request.headers.get("X-Fleeca-Signature"), env.FLEECA_API_KEY) : null;
  if (!p || typeof p !== "object") throw bad(403, "That signature isn't right.");
  const hit = await loadByPayment(env, p.payment_id);
  if (!hit) return { ok: true, ignored: true };
  await settle(env, hit.key, hit.o, p);
  return { ok: true };
}

/* GET /fleeca/return?payment_id=...: where the customer's browser lands after Fleeca. It only reports what we know (asking Fleeca if the
   webhook hasn't arrived yet) and sends them back to the shop. Opening this address proves nothing, so it never marks anything paid by itself. */
export async function handleReturn(env, url) {
  const site = siteBase(env) || "";
  const go = query => new Response(null, { status: 303, headers: { Location: `${site}/?${query}`, "Cache-Control": "no-store" } });
  const hit = await loadByPayment(env, url.searchParams.get("payment_id"));
  if (!hit) return go("payment=unknown");
  let { key, o } = hit;
  if (isAwaiting(o)) { // Fleeca sends the webhook and the customer's browser at about the same moment: give the webhook a moment to land first
    await new Promise(r => setTimeout(r, RETURN_WAIT_MS));
    const again = await env.USERS.get(key);
    if (again) o = JSON.parse(again);
  }
  if (isAwaiting(o) && env.FLEECA_API_KEY && Date.now() - (o.payment.checkedAt || 0) > RECHECK_MS) { // at most one Fleeca call per order every 20 seconds
    o.payment.checkedAt = Date.now();
    try { await save(env, key, o); const p = await getPayment(env, o.payment.id); if (p) await settle(env, key, o, p); }
    catch (e) { console.error("Couldn't check a payment with Fleeca"); }
  }
  const state = o.payment ? o.payment.state : "";
  const status = state === "paid" ? "paid" : ["failed", "cancelled", "expired"].includes(state) ? "failed" : "pending";
  return go(`order=${encodeURIComponent(o.id)}&status=${status}`);
}

/* Run by the Worker's cron trigger. Orders still unpaid after 30 minutes: ask Fleeca, then settle or cancel. A few at a time, to stay
   under Fleeca's 10 calls a minute and the Worker's request limits. */
export async function sweepAbandoned(env) {
  if (!env.FLEECA_API_KEY) return { checked: 0 };
  const page = await env.USERS.list({ prefix: "await:", limit: 30 });
  let done = 0;
  for (const k of page.keys) {
    if (done >= SWEEP_BATCH) break;
    const age = Date.now() - ((k.metadata && k.metadata.p) || 0);
    if (age < ABANDON_MS) continue;
    const id = k.name.slice(6), key = await findOrderKey(env, id), raw = key && await env.USERS.get(key), o = raw && JSON.parse(raw);
    if (!o || !isAwaiting(o)) { await env.USERS.delete(k.name); continue; }
    done++;
    let p = null;
    if (o.payment.id) {
      try { p = await getPayment(env, o.payment.id); }
      catch (e) { if (e.status === 429) break; if (e.status !== 404) continue; } // 404: Fleeca never heard of it. Anything else: try again next time
    }
    const result = p ? await settle(env, key, o, p) : "awaiting";
    if (result === "awaiting" && !(p && p.status === "pending" && age < LONG_PENDING_MS)) await cancelUnpaid(env, key, o, "expired");
  }
  return { checked: done };
}
