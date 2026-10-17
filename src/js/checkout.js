/* Checkout: the form, the order summary, placing the order, the confirmation and coming back from Fleeca. */
import { dealName, esc, escLines, money, fullTitle, hLabel, hoursText } from "../shared.mjs";
import { drawer, co, CONFIG, byId, lastOrder, $, store, firstName, takeParam, postJson, cart, setCart, setLastOrder, toast } from "./core.js";
import { shopNow, ymdAdd, isoDate, fmtDate } from "./hours.js";
import { saveCart, cartCount, cartSubtotal, cartDeal, renderCartUI } from "./cart.js";
import { grid } from "./shelves.js";

/* ===================== checkout ===================== */
export const form = $("coForm");
export const F = { name: $("f-name"), phone: $("f-phone"), date: $("f-date"), address: $("f-address"), notes: $("f-notes") };
export const getMethod = () => (form.querySelector('input[name="method"]:checked') || {}).value || "collect";
export function totals() { const sub = cartSubtotal(), discount = cartDeal().discount, post = getMethod() === "post" ? CONFIG.postage : 0; return { sub, discount, post, total: sub - discount + post }; }
export function renderSummary() {
  $("sumList").innerHTML = Object.entries(cart).map(([id, q]) => { const p = byId[id]; return `<li class="sum-item"><span><b>${q}×</b> ${esc(fullTitle(p))}</span><span>${money(p.price * q)}</span></li>`; }).join("");
  const t = totals(), post = getMethod() === "post";
  $("sumSub").textContent = money(t.sub);
  $("sumDealLine").hidden = !t.discount;
  $("sumDealName").textContent = dealName(CONFIG.deal);
  $("sumDeal").textContent = "−" + money(t.discount);
  $("sumShipLabel").textContent = post ? "Postage" : "Collection";
  $("sumShip").textContent = post ? money(CONFIG.postage) : "Free";
  $("sumTotal").textContent = money(t.total);
  $("footTotal").textContent = money(t.total);
  $("payBtn").textContent = CONFIG.testMode ? "Place test order" : CONFIG.payOnline ? `Pay ${money(t.total)} with Fleeca` : "Place order";
  $("payHint").textContent = CONFIG.testMode ? "Test mode: nothing is charged" : CONFIG.payOnline ? "You'll go to Fleeca to pay. Log in to Fleeca banking first, and pay from the account you want to use." : "The shop gets your order straight away.";
}
export function syncMethod() {
  const post = getMethod() === "post";
  $("collectPanel").hidden = post;
  $("postPanel").hidden = !post;
  renderSummary();
}
export function setDateBounds() {
  const n = shopNow();
  const start = n.h >= CONFIG.closeHour ? ymdAdd(n, 1) : { y: n.y, m: n.m, d: n.d };
  const end = ymdAdd(start, CONFIG.collectDaysAhead);
  F.date.min = isoDate(start); F.date.max = isoDate(end);
  if (F.date.value && (F.date.value < F.date.min || F.date.value > F.date.max)) F.date.value = "";
  $("h-date").textContent = `Any day up to two weeks ahead. We're open ${hoursText(CONFIG)} every day.`;
}
export function validate() {
  const e = {}, method = getMethod();
  if (F.name.value.trim().length < 3) e.name = "Enter your full name.";
  const raw = F.phone.value.trim(), digits = raw.replace(/\D/g, "");
  if (!raw) e.phone = "Enter a phone number so we can reach you.";
  else if (/[^\d\s()+\-#]/.test(raw) || digits.length < 4 || digits.length > 15) e.phone = "Enter your phone number using digits only.";
  if (method === "collect") {
    const d = F.date.value;
    if (!d) e.date = "Pick the day you can collect.";
    else if (d < F.date.min || d > F.date.max) e.date = `Pick a day between ${fmtDate(F.date.min)} and ${fmtDate(F.date.max)}.`;
  } else if (F.address.value.trim().length < 8) e.address = "Enter the full address we should post to.";
  return e;
}
export function showErrors(errs) {
  ["name", "phone", "date", "address"].forEach(k => {
    const el = F[k], msg = $("e-" + k);
    if (errs[k]) { el.setAttribute("aria-invalid", "true"); msg.textContent = errs[k]; msg.hidden = false; }
    else { el.removeAttribute("aria-invalid"); msg.textContent = ""; msg.hidden = true; }
  });
  const first = ["name", "phone", "date", "address"].find(k => errs[k]);
  if (first) F[first].focus();
}
export function buildOrder() {
  const t = totals(), method = getMethod();
  return {
    id: "FC-" + String(Math.floor(1000 + Math.random() * 9000)),
    placedAt: new Date().toISOString(),
    name: F.name.value.trim(),
    phone: F.phone.value.trim(),
    method,
    collectDate: method === "collect" ? F.date.value : null,
    address: method === "post" ? F.address.value.trim() : null,
    notes: F.notes.value.trim(),
    items: Object.entries(cart).map(([id, q]) => ({ id, title: fullTitle(byId[id]), qty: q, price: byId[id].price })),
    subtotal: t.sub, ...(t.discount ? { discount: t.discount, deal: dealName(CONFIG.deal) } : {}), postage: t.post, total: t.total,
    test: CONFIG.testMode
  };
}
export const ME_KEY = "flickers-customer";
export function openCheckout() {
  if (!cartCount()) return;
  if (drawer.open) drawer.close();
  $("coFormView").hidden = false;
  $("coDoneView").hidden = true;
  $("coDoneView").innerHTML = "";
  $("testNote").hidden = !CONFIG.testMode;
  $("formError").textContent = "";
  setDateBounds();
  syncMethod();
  const me = store.get(ME_KEY, null);
  if (me && !F.name.value && !F.phone.value) { F.name.value = String(me.name || ""); F.phone.value = String(me.phone || ""); }
  $("f-remember").checked = !store.get(ME_KEY + "-off", false);
  co.showModal();
  co.scrollTop = 0;
  F.name.focus();
}
export async function placeOrder(ev) {
  ev.preventDefault();
  $("formError").textContent = "";
  const errs = validate();
  showErrors(errs);
  if (Object.keys(errs).length) return;
  const order = buildOrder();
  if ($("f-remember").checked) { store.set(ME_KEY, { name: order.name, phone: order.phone }); store.set(ME_KEY + "-off", null); } // next time the form is already filled in
  else { store.set(ME_KEY, null); store.set(ME_KEY + "-off", true); }
  if (CONFIG.testMode || !CONFIG.orderApi) {
    setCart({}); saveCart(); renderCartUI();
    showDone(order);
    return;
  }
  // Live mode: only the comic ids and quantities are sent. The order service looks the prices up itself,
  // keeps a record, logs the order to the shop's Discord channel, and tells us the real totals.
  const btn = $("payBtn"), label = btn.textContent;
  btn.disabled = true; btn.textContent = CONFIG.payOnline ? "Connecting to Fleeca…" : "Sending your order…";
  try {
    const { ok, data } = await postJson(CONFIG.orderApi, { name: order.name, phone: order.phone, method: order.method, collectDate: order.collectDate, address: order.address, notes: order.notes, items: order.items.map(i => ({ id: i.id, qty: i.qty })) });
    if (!ok) { const err = new Error(data.error || "bad status"); err.shown = !!data.error; throw err; }
    const placed = { ...order, id: data.orderId || order.id, subtotal: data.subtotal ?? order.subtotal, discount: data.discount ?? order.discount ?? 0, deal: order.deal || dealName(CONFIG.deal), postage: data.postage ?? order.postage, total: data.total ?? order.total, test: false, paid: false };
    if (data.paymentUrl) {
      store.set("flickers-pending-order", placed);
      window.location.href = data.paymentUrl;
      return;
    }
    setCart({}); saveCart(); renderCartUI();
    btn.disabled = false;
    setLastOrder({ id: placed.id, phone: placed.phone });
    showDone(placed);
  } catch (e) {
    $("formError").textContent = e.shown ? e.message : "We couldn't send your order. Check your connection and try again.";
    btn.disabled = false; btn.textContent = label; renderSummary();
  }
}
export function discordPreview(o) {
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const items = o.items.map(i => `${i.qty} × ${esc(i.title)} · ${money(i.price * i.qty)}`).join("<br>");
  return `<section class="dc-wrap" aria-labelledby="dcTitle">
    <h3 id="dcTitle">Staff notification preview</h3>
    <p class="hint">Shown in test mode only. When ordering is switched on, a message like this is posted to the shop's Discord channel for every order.</p>
    <div class="dc">
      <div class="dc-avatar" aria-hidden="true">FC</div>
      <div class="dc-msg">
        <div class="dc-head"><span class="dc-name">Flickers Orders</span><span class="dc-tag">App</span><span class="dc-time">Today at ${time}</span></div>
        <p class="dc-text"><span class="dc-mention">@Staff</span> New order to ${o.method === "collect" ? "collect" : "post"}.</p>
        <div class="dc-embed">
          <div class="dc-title">Order ${esc(o.id)} · ${money(o.total)}</div>
          <div class="dc-fields">
            <div class="dc-field"><b>Customer</b>${esc(o.name)}</div>
            <div class="dc-field"><b>Phone</b>${esc(o.phone)}</div>
            ${o.method === "collect" ? `<div class="dc-field wide"><b>Collect on</b>${esc(fmtDate(o.collectDate))}, ${hoursText(CONFIG)}</div>` : `<div class="dc-field wide"><b>Post to</b>${escLines(o.address)}</div>`}
            <div class="dc-field wide"><b>Items</b>${items}</div>
            <div class="dc-field"><b>Subtotal</b>${money(o.subtotal)}</div>
            ${o.discount ? `<div class="dc-field"><b>${esc(o.deal || "Deal")}</b>−${money(o.discount)}</div>` : ""}
            <div class="dc-field"><b>${o.method === "post" ? "Postage" : "Collection"}</b>${o.postage ? money(o.postage) : "Free"}</div>
            ${o.notes ? `<div class="dc-field wide"><b>Notes</b>${escLines(o.notes)}</div>` : ""}
          </div>
          <div class="dc-foot">${o.test ? "Test order, not charged" : o.paid ? "Paid through Fleeca" : "Payment pending"}</div>
        </div>
      </div>
    </div>
  </section>`;
}
/* Plain text of an order, to paste into a message or keep in the notes app. */
export function orderSummary(o) {
  const when = o.method === "collect" ? `Collect ${fmtDate(o.collectDate)}, ${hoursText(CONFIG)}` : `Post to ${String(o.address || "").replace(/\s*\n\s*/g, ", ")}`;
  return [`Flickers Comics order ${o.id}`, ...o.items.map(i => `${i.qty} x ${i.title}`), `Total ${money(o.total)}`, when].join("\n");
}
export function showDone(o) {
  const collect = o.method === "collect";
  $("coFormView").hidden = true;
  const view = $("coDoneView");
  view.hidden = false;
  view.innerHTML = `<div class="done">
    <div class="done-top">
      <p class="eyebrow">${o.test ? "Test order" : o.paid ? "Payment received" : "Order received"}</p>
      <h2 class="done-title" id="doneTitle" tabindex="-1">Thanks, ${esc(firstName(o.name))}. Order received.</h2>
      <p class="ticket">Order <strong>${esc(o.id)}</strong> <button type="button" class="link-btn" data-copy="${esc(o.id)}">Copy number</button> <button type="button" class="link-btn" data-copy="${esc(orderSummary(o))}">Copy order details</button></p>
      <p class="done-note">${o.test ? "This was a test, so nothing was charged and the shop wasn't notified." : o.paid ? "Your payment went through and the shop has your order." : "The shop has your order."}</p>
    </div>
    <div class="done-grid">
      <dl class="done-dl">
        <dt>Name</dt><dd>${esc(o.name)}</dd>
        <dt>Phone</dt><dd>${esc(o.phone)}</dd>
        ${collect ? `<dt>Collect</dt><dd>${esc(fmtDate(o.collectDate))}, ${hoursText(CONFIG)}</dd>` : `<dt>Post to</dt><dd>${escLines(o.address)}</dd>`}
        <dt>Items</dt><dd>${o.items.map(i => `${i.qty} × ${esc(i.title)}`).join("<br>")}</dd>
        ${o.discount ? `<dt>Deal</dt><dd>${esc(o.deal || "Deal")}: <strong>−${money(o.discount)}</strong></dd>` : ""}
        <dt>Total</dt><dd><strong>${money(o.total)}</strong>${o.postage ? ` <span class="hint">incl. ${money(o.postage)} postage</span>` : ""}</dd>
      </dl>
      <div class="next">
        <h3>What happens next</h3>
        <p>${collect
          ? `Come to the counter on ${esc(fmtDate(o.collectDate))} between ${hLabel(CONFIG.openHour)} and ${hLabel(CONFIG.closeHour)} and give your order number.`
          : "We post your order to the address you gave and text you when it's on its way."}</p>
        <p>We'll text ${esc(o.phone)} if anything changes.</p>
        ${o.test || !lastOrder ? "" : '<p><button type="button" class="link-btn" data-track-this>Check on this order any time</button></p>'}
      </div>
    </div>
    ${o.test ? discordPreview(o) : ""}
    <div><button type="button" class="btn btn-yellow" data-close>Back to the shop</button></div>
  </div>`;
  co.scrollTop = 0;
  $("doneTitle").focus();
}
export function resetCheckout() {
  form.reset();
  ["name", "phone", "date", "address"].forEach(k => { F[k].removeAttribute("aria-invalid"); $("e-" + k).hidden = true; });
  $("coFormView").hidden = false;
  $("coDoneView").hidden = true;
  $("coDoneView").innerHTML = "";
}
export function handlePaymentReturn() {
  // Live mode only: the order service sends shoppers back to  ?order=FC-1234&status=paid  (or failed, or pending while Fleeca confirms).
  const unknown = takeParam("payment");
  if (unknown === "unknown") { toast("We couldn't find that payment. If you paid, check Track order with your order number and phone."); return; }
  const id = takeParam("order"), status = takeParam("status");
  if (!id || !status) return;
  const pending = store.get("flickers-pending-order", null);
  if (status === "paid" && pending && pending.id === id) {
    setCart({}); saveCart(); renderCartUI();
    store.set("flickers-pending-order", null);
    co.showModal();
    showDone({ ...pending, test: false, paid: true });
  } else if (status === "paid") {
    // paid, but this browser doesn't hold the order (a different device or cleared storage): the order is placed all the same
    toast(`Payment received. Thank you! Your order number is ${id}. You can follow it under Track order.`);
  } else if (status === "pending") {
    // The order is placed and its comics are held; Fleeca just hasn't confirmed yet. Don't tell a paying customer it failed.
    if (pending && pending.id === id) { setCart({}); saveCart(); renderCartUI(); store.set("flickers-pending-order", null); }
    toast(`We're confirming your payment with Fleeca. Check Track order in a minute with order number ${id}.`);
  } else {
    toast("Your payment didn't go through, so nothing was charged. Your cart is still here.");
  }
}
co.addEventListener("close", () => { if (!$("coDoneView").hidden) resetCheckout(); });
$("checkoutBtn").addEventListener("click", openCheckout);
form.addEventListener("submit", placeOrder);
form.querySelectorAll('input[name="method"]').forEach(r => r.addEventListener("change", syncMethod));
["name", "phone", "date", "address"].forEach(k => F[k].addEventListener("input", () => {
  if (F[k].getAttribute("aria-invalid") === "true") { F[k].removeAttribute("aria-invalid"); $("e-" + k).hidden = true; }
}));
$("checkoutBtn").addEventListener("click", openCheckout);
