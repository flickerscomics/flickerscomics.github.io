/* Tracking an order by number and phone. */
import { esc, money, hLabel } from "../shared.mjs";
import { drawer, co, tr, CONFIG, $, takeParam, postJson } from "./core.js";
import { fmtDate } from "./hours.js";
import { form } from "./checkout.js";

/* ===================== tracking an order ===================== */
export const trForm = $("trackForm"), trResult = $("trackResult");
export const TRACK_TEXT = {
  new: () => "We've got your order and we're getting it ready. We'll text you as soon as it is.",
  ready: o => o.method === "collect"
    ? `It's ready. Come to the counter${o.collectDate ? " on " + fmtDate(o.collectDate) : ""} between ${hLabel(CONFIG.openHour)} and ${hLabel(CONFIG.closeHour)} and give your order number.`
    : "It's packed and will be posted to you shortly.",
  done: o => (o.method === "collect" ? "Collected. Thanks for shopping with Flickers Comics." : "Posted. It's on its way to you."),
  cancelled: () => "This order was cancelled. If that's a surprise, get in touch with the shop."
};
export function trackHTML(o) {
  const collect = o.method === "collect", labels = ["Received", "Ready", collect ? "Collected" : "Posted"];
  const at = { new: 0, ready: 1, done: 2 }[o.state];
  const steps = o.state === "cancelled" ? "" : `<ol class="steps" aria-label="Order progress">${labels.map((l, i) => {
    const cls = o.state === "done" || i < at ? "is-done" : i === at ? "is-current" : "";
    return `<li${cls ? ` class="${cls}"` : ""}${i === at && o.state !== "done" ? ' aria-current="step"' : ""}>${l}${cls === "is-done" ? '<span class="sr-only"> (done)</span>' : ""}</li>`;
  }).join("")}</ol>`;
  return `<div class="track-result">
    <p class="eyebrow">Order ${esc(o.id)}</p>
    <h3 class="track-status" id="trackStatus" tabindex="-1">${esc(o.state === "ready" ? (collect ? "Ready to collect" : "Packed") : o.statusLabel)}</h3>
    <p class="track-msg">${esc(TRACK_TEXT[o.state](o))}</p>
    ${steps}
    <dl class="done-dl">
      <dt>Items</dt><dd>${o.items.map(i => `${i.qty} × ${esc(i.title)}`).join("<br>")}</dd>
      ${o.discount ? `<dt>Deal</dt><dd>${esc(o.deal || "Deal")}: <strong>−${money(o.discount)}</strong></dd>` : ""}
      <dt>Total</dt><dd><strong>${money(o.total)}</strong>${o.postage ? ` <span class="hint">incl. ${money(o.postage)} postage</span>` : ""}</dd>
      <dt>Payment</dt><dd>${o.paid ? "Paid" : "Not paid yet"}</dd>
    </dl>
    <p class="hint">Finished orders are kept for two weeks, then deleted.</p>
    <div><button type="button" class="btn btn-small" data-track-again>Check another order</button></div>
  </div>`;
}
export function openTrack(pre = {}, auto = false) {
  if (co.open) co.close();
  if (drawer.open) drawer.close();
  trForm.hidden = false; trResult.hidden = true; trResult.innerHTML = "";
  $("t-id").value = pre.id || ""; $("t-phone").value = pre.phone || "";
  $("trackError").textContent = "";
  tr.showModal();
  tr.scrollTop = 0;
  if (auto && pre.id && pre.phone) trForm.requestSubmit(); else (pre.id ? $("t-phone") : $("t-id")).focus();
}
trForm.addEventListener("submit", async ev => {
  ev.preventDefault();
  const id = $("t-id").value.trim(), phone = $("t-phone").value.trim(), err = $("trackError"), btn = $("trackBtn");
  err.textContent = "";
  if (!id || !phone) { err.textContent = "Enter your order number and the phone number you gave."; return; }
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Checking…";
  try {
    const { ok, data } = await postJson(CONFIG.orderApi.replace(/\/+$/, "") + "/lookup", { id, phone });
    if (!ok) { err.textContent = data.error || "We couldn't check that just now. Try again in a moment."; return; }
    trForm.hidden = true; trResult.hidden = false; trResult.innerHTML = trackHTML(data);
    $("trackStatus").focus();
  } catch (e) { err.textContent = "We couldn't reach the shop just now. Check your connection and try again."; }
  finally { btn.disabled = false; btn.textContent = label; }
});
export function enableTracking() {
  if (!CONFIG.orderApi || CONFIG.testMode) return;
  document.querySelectorAll("[data-track]").forEach(b => { b.hidden = false; });
  const asked = takeParam("track"); // a link like /?track=FC-7K3PQ2 opens the form with the number filled in
  if (asked) openTrack({ id: asked.slice(0, 20) });
}
