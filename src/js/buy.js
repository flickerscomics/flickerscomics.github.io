/* The buy box on the quick view and on a comic's own page. */
import { heartIcon, detailHTML, dealOn, dealName, esc, money, fullTitle } from "../shared.mjs";
import { qv, CONFIG, CATEGORIES, byId, root, $, focusFirst, comicUrl, cart, cover, wantsOn, toast } from "./core.js";
import { cartQty, dealWords, addToCart, openDrawer, bumpCart } from "./cart.js";
import { isSaved } from "./saved.js";

/* ===================== buy box (quick view and comic page) ===================== */
export const qvState = { id: null, qty: 1 };
export const pageBuyEl = document.querySelector("[data-buy]");
export const pageState = pageBuyEl ? { id: pageBuyEl.dataset.buy, qty: 1 } : null;
export const buyMax = p => Math.max(0, p.stock - cartQty(p.id));

export function buyCore(p, st) {
  const max = buyMax(p);
  st.qty = Math.min(Math.max(1, st.qty), Math.max(1, max));
  if (p.stock <= 0) return `<p class="qv-limit">This one is sold out.</p>`;
  if (max <= 0) return `<p class="qv-limit">Every copy we have is already in your cart.</p><button type="button" class="btn" data-qv="cart">View cart</button>`;
  return `<div class="qty" role="group" aria-label="Quantity">
      <button type="button" data-qv="dec" aria-label="One fewer" ${st.qty <= 1 ? "disabled" : ""}>−</button>
      <span class="qty-n" aria-live="polite">${st.qty}</span>
      <button type="button" data-qv="inc" aria-label="One more" ${st.qty >= max ? "disabled" : ""}>+</button>
    </div>
    <button type="button" class="btn btn-yellow" data-qv="add">Add to cart · ${money(p.price * st.qty)}</button>`;
}
export function buyHTML(p, st) {
  const live = wantsOn();
  return buyCore(p, st) + (p.stock > 0 && dealOn(CONFIG.deal) ? `<p class="deal-note"><b>${esc(dealName(CONFIG.deal))}.</b> In a cart of ${CONFIG.deal.buy + CONFIG.deal.free}, ${dealWords(CONFIG.deal)} free.</p>` : "") + `<div class="buy-extras">${p.stock <= 0 && live ? `<button type="button" class="btn btn-small btn-yellow" data-want="restock" data-id="${esc(p.id)}">Tell me when it's back</button>` : ""}<button type="button" class="link-btn save-link" data-save="${esc(p.id)}" aria-pressed="${isSaved(p.id)}">${heartIcon}Save for later</button>${live ? `<button type="button" class="link-btn" data-want="series" data-id="${esc(p.id)}">Follow ${esc(p.title)}</button>` : ""}</div>`;
}
export function renderPageBuy() { if (pageBuyEl && byId[pageState.id]) pageBuyEl.innerHTML = buyHTML(byId[pageState.id], pageState); }

export function renderQV() {
  const p = byId[qvState.id]; if (!p) return;
  $("qvBody").innerHTML = detailHTML(p, CATEGORIES, {
    imgBase: root, level: 2, headingId: "qvTitle", cover: { lazy: false, sizes: "220px" },
    before: `<button type="button" class="icon-btn qv-close" data-close aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`,
    buy: `<div class="qv-buy">${buyHTML(p, qvState)}</div>`,
    after: `<p class="hint"><a href="${comicUrl(p.id)}">Open the full page</a></p>`
  });
}
export function openQuickView(id) {
  Object.assign(qvState, { id, qty: 1 });
  renderQV();
  if (!qv.open) qv.showModal();
  (qv.querySelector('[data-qv="add"]') || qv.querySelector("[data-close]"))?.focus({ preventScroll: true }); // focusing the button must not scroll the title and cover out of sight
  qv.scrollTop = 0;
}
export function buyAction(action, st, rerender, inDialog) {
  const p = byId[st.id]; if (!p) return;
  const scope = inDialog ? qv : pageBuyEl;
  if (action === "inc") { st.qty = Math.min(buyMax(p), st.qty + 1); rerender(); focusFirst(scope, '[data-qv="inc"]:not(:disabled)', '[data-qv="dec"]'); }
  else if (action === "dec") { st.qty = Math.max(1, st.qty - 1); rerender(); focusFirst(scope, '[data-qv="dec"]:not(:disabled)', '[data-qv="inc"]'); }
  else if (action === "add") {
    const n = st.qty;
    if (addToCart(p.id, n)) { if (inDialog) qv.close(); st.qty = 1; bumpCart(); toast(`Added ${n > 1 ? n + " × " : ""}${fullTitle(p)}`, { label: "View cart", fn: openDrawer }); renderPageBuy(); }
  } else if (action === "cart") { if (inDialog) qv.close(); openDrawer(); }
}
