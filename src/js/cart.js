/* The cart: its contents, the drawer, the pinned bar on phones, and shared cart links. */
import { dealDiscount, dealOn, dealName, esc, money, fullTitle } from "../shared.mjs";
import { qv, drawer, co, savedDlg, CONFIG, byId, root, $, store, focusFirst, plural, takeParam, cart, cover, toast } from "./core.js";
import { refreshCards } from "./shelves.js";
import { qvState, pageBuyEl, renderPageBuy, renderQV } from "./buy.js";
import { renderSummary } from "./checkout.js";
import { renderSavedLines } from "./saved.js";

/* ===================== cart state ===================== */
export const CART_KEY = "flickers-cart-v1";
export const sanitizeCart = raw => {
  const out = {};
  if (raw && typeof raw === "object") for (const [id, q] of Object.entries(raw)) {
    const p = byId[id], n = Math.floor(Number(q));
    if (p && p.stock > 0 && n > 0) out[id] = Math.min(n, p.stock);
  }
  return out;
};
export const saveCart = () => store.set(CART_KEY, cart);
export const cartQty = id => cart[id] || 0;
export const cartCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
export const cartSubtotal = () => Object.entries(cart).reduce((s, [id, q]) => s + byId[id].price * q, 0);
export const cartDeal = () => dealDiscount(Object.entries(cart).map(([id, qty]) => ({ price: byId[id].price, qty })), CONFIG.deal);
export const dealWords = d => (d.free === 1 ? "the cheapest one is" : `the cheapest ${d.free} are`);
export function addToCart(id, n = 1) {
  const p = byId[id];
  if (!p || p.stock <= 0) return false;
  const next = Math.min(p.stock, cartQty(id) + n);
  if (next === cartQty(id)) return false;
  cart[id] = next; saveCart(); renderCartUI();
  return true;
}
export function setQty(id, n) {
  const p = byId[id]; if (!p) return;
  n = Math.max(0, Math.min(p.stock, n));
  if (n === 0) delete cart[id]; else cart[id] = n;
  saveCart(); renderCartUI();
}
/* ===================== cart drawer ===================== */
export function renderLines() {
  const entries = Object.entries(cart);
  $("cartEmpty").hidden = entries.length > 0;
  $("drawerFoot").hidden = entries.length === 0;
  $("drawerSub").textContent = money(cartSubtotal());
  const deal = cartDeal(), count = cartCount();
  $("drawerDealLine").hidden = !deal.discount;
  $("drawerDealName").textContent = dealName(CONFIG.deal);
  $("drawerDeal").textContent = "−" + money(deal.discount);
  $("drawerNudge").hidden = !(dealOn(CONFIG.deal) && count > 0 && deal.toGo > 0);
  $("drawerNudge").textContent = deal.toGo > 0 ? `Add ${deal.toGo} more comic${deal.toGo === 1 ? "" : "s"} ${deal.discount ? "for another free one" : `and ${dealWords(CONFIG.deal)} free`}.` : "";
  $("lines").innerHTML = entries.map(([id, q]) => {
    const p = byId[id], t = fullTitle(p);
    return `<li class="line">
      <div class="line-thumb">${cover(p, { lazy: false, sizes: "54px" })}</div>
      <div>
        <p class="line-title">${esc(t)}</p>
        <p class="line-meta">${money(p.price)} each</p>
        <div class="qty small" role="group" aria-label="Quantity of ${esc(t)}">
          <button type="button" data-dec="${id}" aria-label="One fewer ${esc(t)}">−</button>
          <span class="qty-n">${q}</span>
          <button type="button" data-inc="${id}" aria-label="One more ${esc(t)}" ${q >= p.stock ? "disabled" : ""}>+</button>
        </div>
      </div>
      <div class="line-right"><span class="line-price">${money(p.price * q)}</span><button type="button" class="link-btn" data-remove="${id}" aria-label="Remove ${esc(t)}">Remove</button></div>
    </li>`;
  }).join("");
}
export function renderCartUI() {
  const n = cartCount(), sub = cartSubtotal() - cartDeal().discount;
  $("cartCount").textContent = n;
  $("cartTotal").textContent = money(sub);
  $("cartBtn").setAttribute("aria-label", `Cart: ${n} ${n === 1 ? "item" : "items"}, ${money(sub)}`);
  $("checkoutBtn").disabled = n === 0;
  $("cartBar").hidden = n === 0; // the phone's pinned "view cart" bar (CSS shows it on small screens only)
  $("cartBarText").textContent = `View cart · ${plural(n, "item")} · ${money(sub)}`;
  document.body.classList.toggle("has-cartbar", n > 0);
  if (drawer.open) {
    const a = document.activeElement, key = a && ["inc", "dec", "remove"].find(k => a.dataset && a.dataset[k]);
    const id = key ? a.dataset[key] : null;
    renderLines();
    if (key) {
      const again = drawer.querySelector(`[data-${key}="${id}"]:not(:disabled)`) || drawer.querySelector(`[data-dec="${id}"]`);
      (again || drawer.querySelector("#checkoutBtn:not(:disabled)") || drawer.querySelector(".cart-empty .btn") || drawer.querySelector("[data-close]")).focus();
    }
  }
  refreshCards();
  if (qv.open && qvState.id) { const keep = document.activeElement; renderQV(); if (keep && keep.dataset && keep.dataset.qv) focusFirst(qv, `[data-qv="${keep.dataset.qv}"]:not(:disabled)`, '[data-qv="add"]'); }
  if (pageBuyEl) renderPageBuy();
  if (co.open && !$("coFormView").hidden) renderSummary();
  if (savedDlg.open) renderSavedLines();
}
export function openDrawer() {
  if (qv.open) qv.close();
  renderLines();
  drawer.showModal();
}
export function bumpCart() { const b = $("cartBtn"); b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }
/* ===================== sharing a cart ===================== */
// A cart link looks like  /?cart=batman-14:2,flash-3:1  (comic id : quantity). Opening one adds those comics to the visitor's own cart.
export const cartLink = () => new URL(`${root}?cart=${Object.entries(cart).map(([id, n]) => `${id}:${n}`).join(",")}`, location.href).href;
export function loadSharedCart() {
  const raw = takeParam("cart");
  if (raw === null) return;
  let added = 0, skipped = 0;
  for (const part of raw.slice(0, 3000).split(",").slice(0, 40)) {
    const [id, q] = part.split(":"), n = Math.min(99, Math.floor(Number(q === undefined ? 1 : q)));
    const p = Object.hasOwn(byId, id) ? byId[id] : null;
    if (!p || !(p.stock > 0) || !(n > 0)) { skipped++; continue; }
    const before = cartQty(id), next = Math.min(p.stock, before + n);
    if (next > before) { cart[id] = next; added += next - before; } else skipped++;
  }
  if (added) { saveCart(); renderCartUI(); bumpCart(); }
  if (added) toast(`Added ${plural(added, "comic")} from a shared cart${skipped ? ` (${skipped} unavailable)` : ""}`, { label: "View cart", fn: openDrawer });
  else toast("The comics in that cart link are sold out or no longer in the shop.");
}
$("cartBtn").addEventListener("click", openDrawer);
$("cartBarBtn").addEventListener("click", () => $("cartBtn").click());
