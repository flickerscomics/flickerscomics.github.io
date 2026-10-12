/* Staff area: the Orders tab. */
import { esc, escLines, money } from "../shared.mjs";
import { $, S, api, say, orderWhen, pager, shopConfig, shopToday, copyText, csvCell, download } from "./core.js";
import { orderMessage } from "./messages.js";
import { printSlips } from "./slips.js";

/* ---------- orders tab ---------- */
const orderStatus = o => o.status || "new";
const awaiting = o => !!o.payment && o.payment.state === "awaiting"; // an online order the customer hasn't paid for on Fleeca yet
const payText = o => { const p = o.payment; return o.paid ? (p && p.state === "paid" ? `Paid via Fleeca${p.payerName ? " by " + p.payerName : ""}` : "Paid") : awaiting(o) ? "Waiting for the customer to pay on Fleeca" : "Not paid yet"; };
const STATUS_NAME = o => awaiting(o) ? "Awaiting payment" : ({ new: "New", ready: "Ready", done: o.method === "post" ? "Posted" : "Collected", cancelled: "Cancelled" })[orderStatus(o)];
const HISTORY_NAME = (change, o) => ({ new: "Reopened", ready: "Marked ready", done: o.method === "post" ? "Marked posted" : "Marked collected", cancelled: "Cancelled", paid: "Marked paid", unpaid: "Marked unpaid", entered: "Entered" })[change] || change;
const ORDER_FILTERS = [
  ["open", "Open", o => orderStatus(o) === "new" || orderStatus(o) === "ready"],
  ["archive", "Archive", o => orderStatus(o) === "done" || orderStatus(o) === "cancelled"]
];
const isOpen = o => orderStatus(o) === "new" || orderStatus(o) === "ready";
/* A collection is due once its day arrives (shop time), and stays due until the order is handed over. */
const isDue = (o, today) => isOpen(o) && !awaiting(o) && o.method === "collect" && !!o.collectDate && o.collectDate <= today;
const CHIPS = [
  ["unpaid", "Not paid", o => !o.paid && orderStatus(o) !== "cancelled" && !awaiting(o)],
  ["await", "Awaiting payment", o => awaiting(o)],
  ["due", "Due today", (o, today) => isDue(o, today)],
  ["post", "To post", o => o.method === "post"]
];
const matchesSearch = (o, q) => {
  const text = [o.id, o.name, o.address, o.notes].join(" ").toLowerCase(), digits = q.replace(/\D/g, "");
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => text.includes(w)) || (digits.length >= 3 && String(o.phone || "").replace(/\D/g, "").includes(digits));
};
const ARCHIVE_DAYS = 14;
const archiveEnd = o => new Date(Date.parse(o.completedAt) + ARCHIVE_DAYS * 86400000).toISOString();
const STOCK_NOTE = {
  held: "Taken off the shelf automatically",
  released: "Put back on the shelf automatically",
  manual: "Not adjusted automatically (GitHub couldn't be reached). Change it under Stock.",
  "restore-failed": "Cancelled, but not put back. Add the comics back under Stock."
};

function ordersCsv(orders) {
  const head = ["Order", "Placed", "Status", "Paid", "Customer", "Phone", "Method", "Collect on", "Address", "Items", "Subtotal", "Deal discount", "Postage", "Total", "Notes"];
  const rows = orders.map(o => [o.id, o.placedAt, STATUS_NAME(o), o.paid ? (o.payment && o.payment.state === "paid" ? "Yes (Fleeca)" : "Yes") : "No", o.name, o.phone, o.method === "post" ? "Post" : "Collect", o.collectDate || "", o.address || "",
    o.items.map(i => `${i.qty} x ${i.title}`).join("; "), o.subtotal, o.discount || 0, o.postage, o.total, o.notes || ""]);
  return "﻿" + [head, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
function orderHTML(o, expanded) {
  const s = orderStatus(o), finish = o.method === "post" ? "Mark posted" : "Mark collected";
  const btn = (attrs, text, cls = "") => `<button type="button" class="btn btn-small ${cls}" data-oid="${esc(o.id)}" ${attrs}>${text}</button>`;
  const actions = [];
  if (awaiting(o)) { /* only cancelling: it's marked paid by itself when the customer pays */ }
  else if (s === "new") actions.push(btn('data-status="ready"', "Mark ready", "btn-yellow"), btn('data-status="done"', finish));
  else if (s === "ready") actions.push(btn('data-status="done"', finish, "btn-yellow"), btn('data-status="new"', "Back to new"));
  else if (s === "done" || s === "cancelled") actions.push(btn('data-status="new"', "Reopen"));
  if (!awaiting(o)) actions.push(btn(`data-paid="${o.paid ? "no" : "yes"}"`, o.paid ? "Mark unpaid" : "Mark paid"));
  const tool = (act, text) => `<button type="button" class="btn btn-small btn-quiet" data-oact="${act}" data-oid="${esc(o.id)}">${text}</button>`;
  actions.push(tool("copy", "Copy message"), tool("print", "Print slip"));
  if (s === "new" || s === "ready") actions.push(btn('data-status="cancelled"', "Cancel order", "btn-danger"));
  const history = [o.source === "staff" ? `Keyed in by ${o.enteredBy} · ${orderWhen(o.placedAt)}` : `Placed by the customer · ${orderWhen(o.placedAt)}`, ...(o.history || []).filter(h => h.change !== "entered").map(h => `${HISTORY_NAME(h.change, o)} by ${h.by} · ${orderWhen(h.at)}`)];
  const pillClass = awaiting(o) ? "pill-void" : { new: "pill-edit", ready: "pill-added", done: "", cancelled: "pill-void" }[s];
  return `<details class="order${s === "cancelled" ? " is-cancelled" : ""}" data-order="${esc(o.id)}"${expanded ? " open" : ""}>
    <summary><b>${esc(o.id)}</b> <span>${esc(orderWhen(o.placedAt))}</span> <span>${esc(o.name)}</span> <span class="pill">${o.method === "post" ? "Post" : "Collect"}</span>${o.source === "staff" ? ' <span class="pill pill-void">Counter</span>' : ""} <span class="pill ${pillClass}">${esc(STATUS_NAME(o))}</span>${o.paid ? ' <span class="pill pill-added">Paid</span>' : ""}${o.payment && o.payment.flag ? ' <span class="pill pill-edit">Check payment</span>' : ""}${o.stock === "manual" || o.stock === "restore-failed" ? ' <span class="pill pill-edit">Adjust stock</span>' : ""}${/^failed/.test(o.discord || "") ? ' <span class="pill pill-edit">Not posted to Discord</span>' : ""} <b class="order-total">${money(o.total)}</b></summary>
    <dl class="done-dl">
      <dt>Phone</dt><dd>${esc(o.phone)}</dd>
      ${o.method === "collect" ? `<dt>Collect on</dt><dd>${esc(o.collectDate)}</dd>` : `<dt>Post to</dt><dd>${escLines(o.address)}</dd>`}
      <dt>Items</dt><dd>${o.items.map(i => `${i.qty} × ${esc(i.title)} · ${money(i.price * i.qty)}`).join("<br>")}</dd>
      ${o.discount ? `<dt>Deal</dt><dd>${esc(o.deal || "Deal")}: −${money(o.discount)}</dd>` : ""}
      <dt>Total</dt><dd>${money(o.total)}${o.postage ? ` (incl. ${money(o.postage)} postage)` : ""}</dd>
      <dt>Payment</dt><dd>${esc(payText(o))}${o.payment && o.payment.paidAt ? ` · ${esc(orderWhen(o.payment.paidAt))}` : ""}${o.payment && o.payment.id ? ` · Fleeca payment ${esc(o.payment.id)}` : ""}</dd>
      ${o.payment && o.payment.flag ? `<dt>Check</dt><dd><b>${esc(o.payment.flag)}</b></dd>` : ""}
      ${STOCK_NOTE[o.stock] ? `<dt>Stock</dt><dd>${STOCK_NOTE[o.stock]}</dd>` : ""}
      ${o.completedAt ? `<dt>Kept until</dt><dd>${esc(orderWhen(archiveEnd(o)))}, then deleted</dd>` : ""}
      ${o.notes ? `<dt>Notes</dt><dd>${escLines(o.notes)}</dd>` : ""}
      <dt>History</dt><dd>${history.map(esc).join("<br>")}</dd>
      <dt>Discord</dt><dd>${esc(o.discord || "")}</dd>
    </dl>
    <div class="order-actions">${actions.join("")}</div>
  </details>`;
}

export async function renderOrders() {
  $("panel").innerHTML = `<div class="admin-msg" id="aMsg" role="status"></div>
    <div class="orders-top" id="ordersTop"><p class="hint">Loading…</p></div>
    <div class="orders-tools">
      <label class="search"><span class="sr-only">Search orders</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="oSearch" placeholder="Search by order number, name or phone" autocomplete="off"></label>
      <button type="button" class="btn btn-yellow btn-small" id="counterBtn">+ Take an order</button>
      <button type="button" class="btn btn-small" id="printBtn">Print slips</button>
    </div>
    <p class="due-strip" id="dueStrip" role="status" hidden></p>
    <div class="orders-chips" id="orderChips" role="group" aria-label="Narrow the list"></div>
    <div class="orders-filter" id="ordersFilter" role="group" aria-label="Show orders"></div>
    <div id="ordersList"></div>`;
  let data;
  try { data = await api("/orders"); } catch (e) { say(e.message, "error"); return; }
  const pg = pager("/orders", "orders", data), orders = pg.items, open = new Set();
  const cfg = await shopConfig(), today = shopToday(cfg);
  let filter = "open", query = "";
  const chips = { unpaid: false, await: false, due: false, post: false };
  let shown = []; // what's on screen now, for printing

  $("ordersTop").innerHTML = `<div class="orders-status">
      <span class="pill ${data.ordersOpen ? "pill-added" : ""}">Online ordering: ${data.ordersOpen ? "ON" : "OFF"}</span>
      <span class="pill ${data.discord ? "pill-added" : ""}">Discord: ${data.discord ? "connected" : "not connected"}</span>
      <button type="button" class="btn btn-small" id="dcTest"${data.discord ? "" : " disabled"}>Send a test message to Discord</button>
      <button type="button" class="btn btn-small" id="csvBtn"${orders.length ? "" : " disabled"}>Download as spreadsheet (CSV)</button>
    </div>
    <p class="hint">Every order is posted to the Discord channel, and the post is updated as you work the order. Orders take comics off the shelf automatically, and cancelling puts them back. Finished orders (collected, posted or cancelled) move to the Archive and are deleted after 14 days. ${data.ordersOpen ? "" : "Customers can't order online yet, so this list stays empty until ordering is switched on."}</p>`;
  $("dcTest").addEventListener("click", async () => {
    $("dcTest").disabled = true;
    try { await api("/orders/test", { method: "POST" }); say("Sent. Check the Discord channel for a message marked TEST.", "ok"); }
    catch (e) { say(e.message, "error"); }
    $("dcTest").disabled = false;
  });
  $("csvBtn").addEventListener("click", () => download(`flickers-orders-${new Date().toISOString().slice(0, 10)}.csv`, ordersCsv(orders), "text/csv;charset=utf-8"));

  const paint = () => {
    const due = orders.filter(o => isDue(o, today)), dueToday = due.filter(o => o.collectDate === today).length, late = due.length - dueToday;
    $("dueStrip").hidden = !due.length;
    $("dueStrip").innerHTML = due.length ? `<b>${dueToday ? `${dueToday} collection${dueToday === 1 ? "" : "s"} due today` : "Nothing due today"}</b>${late ? ` · ${late} earlier collection${late === 1 ? "" : "s"} not picked up yet` : ""} <button type="button" class="link-btn" data-chipjump="due">Show them</button>` : "";
    $("orderChips").innerHTML = CHIPS.map(([k, name, fn]) => `<button type="button" class="chip" data-chip="${k}" aria-pressed="${chips[k]}">${name} (${orders.filter(o => isOpen(o) === (filter === "open") && fn(o, today)).length})</button>`).join("");
    $("ordersFilter").innerHTML = (filter === "archive" ? '<p class="hint orders-note">Finished orders are kept here for two weeks, then deleted for good. Reopen one to move it back to Open.</p>' : "") + ORDER_FILTERS.map(([k, name, fn]) => `<button type="button" class="btn btn-small" data-filter="${k}" aria-pressed="${filter === k}">${name} (${orders.filter(fn).length})</button>`).join("");
    const list = orders.filter(ORDER_FILTERS.find(f => f[0] === filter)[2]).filter(o => CHIPS.every(([k, , fn]) => !chips[k] || fn(o, today))).filter(o => !query || matchesSearch(o, query));
    shown = list;
    $("printBtn").textContent = list.length ? `Print slips (${list.length})` : "Print slips";
    $("printBtn").disabled = !list.length;
    if (filter === "archive") list.sort((a, b) => Date.parse(b.completedAt || 0) - Date.parse(a.completedAt || 0));
    $("ordersList").innerHTML = list.length ? list.map(o => orderHTML(o, open.has(o.id))).join("")
      : `<p class="admin-empty">${query || Object.values(chips).some(Boolean) ? "No orders match that." : filter === "open" ? "No open orders." : "Nothing in the archive."}</p>`;
    $("ordersList").insertAdjacentHTML("beforeend", pg.html("orders"));
    $("csvBtn").disabled = !orders.length;
  };
  $("oSearch").addEventListener("input", () => { query = $("oSearch").value.trim(); paint(); });
  $("orderChips").addEventListener("click", ev => {
    const b = ev.target.closest("[data-chip]"); if (!b) return;
    chips[b.dataset.chip] = !chips[b.dataset.chip]; paint();
    $("orderChips").querySelector(`[data-chip="${b.dataset.chip}"]`).focus();
  });
  $("dueStrip").addEventListener("click", ev => { if (ev.target.closest("[data-chipjump]")) { filter = "open"; chips.due = true; paint(); $("orderChips").querySelector('[data-chip="due"]').focus(); } });
  $("printBtn").addEventListener("click", () => { if (!printSlips(shown.slice(0, 60), cfg)) say("Nothing to print.", "error"); });
  $("counterBtn").addEventListener("click", async () => {
    const { openCounter } = await import("./counter.js");
    openCounter({
      stock: S.orig,
      onPlaced: r => {
        if (!orders.some(o => o.id === r.order.id)) orders.unshift(r.order);
        filter = isOpen(r.order) ? "open" : "archive"; paint();
        say(`Order ${r.orderId} created: ${money(r.total)}${r.order.status === "done" ? ", handed over" : ""}${r.paid ? ", paid" : ""}. The shelf has been updated.`, "ok", isOpen(r.order) ? [{ label: "Print slip", fn: () => printSlips([r.order], cfg) }] : []);
      }
    });
  });
  $("ordersFilter").addEventListener("click", ev => {
    const b = ev.target.closest("[data-filter]"); if (!b) return;
    filter = b.dataset.filter; paint();
    $("ordersFilter").querySelector(`[data-filter="${filter}"]`).focus();
  });
  $("ordersList").addEventListener("toggle", ev => { const id = ev.target.dataset && ev.target.dataset.order; if (id) (ev.target.open ? open.add(id) : open.delete(id)); }, true);
  $("ordersList").addEventListener("click", async ev => {
    const more = ev.target.closest("[data-more]");
    if (more) { more.disabled = true; try { await pg.more(); paint(); } catch (e) { more.disabled = false; say(e.message, "error"); } return; }
    const b = ev.target.closest("[data-oid]"); if (!b) return;
    const id = b.dataset.oid, o = orders.find(x => x.id === id); if (!o) return;
    if (b.dataset.oact === "copy") { copyText(orderMessage(o, cfg), `Message for ${o.name} copied. Paste it into your text.`); return; }
    if (b.dataset.oact === "print") { printSlips([o], cfg); return; }
    const body = b.dataset.status ? { status: b.dataset.status } : { paid: b.dataset.paid === "yes" };
    const go = async () => {
      b.disabled = true;
      try {
        const r = await api(`/orders/${encodeURIComponent(id)}`, { method: "POST", body });
        Object.assign(o, r.order);
        const what = body.status ? STATUS_NAME(o) + (body.status === "cancelled" || body.status === "done" ? " (moved to the Archive)" : "") : o.paid ? "marked paid" : "marked unpaid";
        const extra = [...(r.warnings || []), ...(r.discord === "failed" ? ["The Discord post couldn't be updated."] : [])];
        say(`${id}: ${what}.${extra.length ? " " + extra.join(" ") : ""}`, extra.length ? "error" : "ok");
        paint();
        const summary = $("ordersList").querySelector(`[data-order="${id}"] summary`); // keep the keyboard where it was
        if (summary) summary.focus(); else $("ordersFilter").querySelector(`[data-filter="${filter}"]`).focus();
      } catch (e) { b.disabled = false; say(e.message, "error"); }
    };
    if (body.status === "cancelled") say(`Cancel order ${id} for ${o.name}? ${o.stock === "held" ? "The comics go back on the shelf. " : ""}It moves to the Archive for two weeks.`, "error", [{ label: "Cancel order", danger: true, fn: go }, { label: "Keep order", fn: () => say("") }]);
    else go();
  });
  paint();
}
