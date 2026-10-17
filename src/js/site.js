/* Flickers Comics storefront.
   The shelves and comic pages are rendered at build time (see build/). This script adds the cart,
   quick view, checkout, search and filters on top. Stock and prices come from data/shop.json.
   It is split by job: core (shared state and small helpers), hours, cart, shelves (search and filters), buy (quick view and comic page),
   checkout, saved, wants, track. This file starts it all up and handles clicks. */
import { fullTitle } from "../shared.mjs";
import { qv, drawer, co, tr, savedDlg, wd, byId, saved, lastOrder, root, $, store, cart, setCart, setSaved, setShop, statusReady, wantsOn, copyText, toast } from "./core.js";
import { renderHours } from "./hours.js";
import { CART_KEY, sanitizeCart, cartQty, addToCart, setQty, renderCartUI, openDrawer, bumpCart, cartLink, loadSharedCart } from "./cart.js";
import { grid, filters, readUrlState, buildIndex, applyFilters, setGroup, refreshCards } from "./shelves.js";
import { qvState, pageState, renderPageBuy, renderQV, openQuickView, buyAction } from "./buy.js";
import { handlePaymentReturn } from "./checkout.js";
import { SAVED_KEY, sanitizeSaved, toggleSave, syncSaved, wishLink, loadSharedWish } from "./saved.js";
import { showWantButtons, openWant } from "./wants.js";
import { trForm, trResult, openTrack, enableTracking } from "./track.js";

/* ===================== back to top ===================== */
function initToTop() {
  const btn = $("toTop");
  if (!btn) return;
  let shown = false;
  const update = () => { const want = window.scrollY > 900; if (want !== shown) { shown = want; btn.hidden = !want; } };
  window.addEventListener("scroll", update, { passive: true });
  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const home = document.querySelector("main"); if (home) { home.setAttribute("tabindex", "-1"); home.focus({ preventScroll: true }); }
  });
  update();
}
/* ===================== events ===================== */
function handleAdd(id, btn) {
  const p = byId[id]; if (!p) return;
  if (p.stock <= 0 && wantsOn()) { openWant("restock", id); return; }
  if (!addToCart(id, 1)) { toast(p.stock <= 0 ? "That one is sold out." : "Every copy we have is already in your cart."); return; }
  bumpCart();
  if (btn) {
    btn.classList.add("added"); btn.textContent = "Added";
    setTimeout(() => { btn.classList.remove("added"); refreshCards(); }, 1100);
  }
  toast(`Added ${fullTitle(p)}`, { label: "View cart", fn: openDrawer });
}
document.addEventListener("click", ev => {
  const t = ev.target.closest("[data-want],[data-save],[data-share-saved],[data-share-cart],[data-open],[data-add],.divider[data-group],[data-tile],[data-inc],[data-dec],[data-remove],[data-qv],[data-close],[data-copy],[data-track],[data-track-this],[data-track-again]");
  if (!t) return;
  const d = t.dataset;
  if ("track" in d) { openTrack(); return; }
  if ("trackThis" in d) { openTrack(lastOrder, true); return; }
  if ("trackAgain" in d) { trForm.hidden = false; trResult.hidden = true; trResult.innerHTML = ""; $("t-id").value = ""; $("t-phone").value = ""; $("t-id").focus(); return; }
  if (d.copy) { copyText(d.copy, "Order number copied.", "Couldn't copy. Select the number and copy it by hand."); return; }
  if (d.want) { openWant(d.want, d.id, d.want === "request" ? filters.q.trim() : ""); return; }
  if (d.save) { toggleSave(d.save); return; }
  if ("shareSaved" in d) { copyText(wishLink(), "List link copied. Anyone who opens it can save the same comics.", "Couldn't copy the link."); return; }
  if ("shareCart" in d) { copyText(cartLink(), "Cart link copied. Anyone who opens it gets these comics in their cart.", "Couldn't copy the link."); return; }
  if (d.open) {
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey || ev.button) return; // let the link open normally
    ev.preventDefault(); openQuickView(d.open); return;
  }
  if (d.add) { if (t.getAttribute("aria-disabled") === "true") { const p = byId[d.add]; toast(p.stock <= 0 ? "That one is sold out." : "Every copy we have is already in your cart."); } else handleAdd(d.add, t); return; }
  if (d.tile) { setGroup(d.tile); $("shop").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); return; }
  if (d.group) { setGroup(d.group); return; }
  if (d.inc) { setQty(d.inc, cartQty(d.inc) + 1); return; }
  if (d.dec) { setQty(d.dec, cartQty(d.dec) - 1); return; }
  if (d.remove) { setQty(d.remove, 0); return; }
  if (d.qv) {
    if (t.closest("dialog") === qv) buyAction(d.qv, qvState, renderQV, true);
    else if (pageState) buyAction(d.qv, pageState, renderPageBuy, false);
    return;
  }
  if ("close" in d) {
    const dlg = t.closest("dialog");
    if (dlg) dlg.close();
    if (d.goto) { const target = document.getElementById(d.goto); if (target) target.scrollIntoView({ block: "start" }); else location.href = `${root}#${d.goto}`; }
  }
});
[qv, drawer, co, tr, savedDlg, wd].forEach(dlg => dlg.addEventListener("click", ev => { if (ev.target === dlg) dlg.close(); }));
window.addEventListener("storage", ev => {
  if (ev.key === CART_KEY) { setCart(sanitizeCart(store.get(CART_KEY, {}))); renderCartUI(); }
  if (ev.key === SAVED_KEY) { setSaved(sanitizeSaved(store.get(SAVED_KEY, {}))); syncSaved(); }
});
/* ===================== start ===================== */
if (grid) { readUrlState(); setGroup(filters.group); }
try {
  const data = await statusReady;
  setShop(data);
  setCart(sanitizeCart(store.get(CART_KEY, {})));
  renderHours();
  setInterval(renderHours, 60000);
  setSaved(sanitizeSaved(store.get(SAVED_KEY, {})));
  buildIndex();
  syncSaved();
  applyFilters();
  handlePaymentReturn();
  initToTop();
  enableTracking();
  showWantButtons();
  renderCartUI();
  loadSharedCart();
  loadSharedWish();
} catch (e) {
  // The pre-rendered pages still read fine without it; only the cart is unavailable.
  const btn = $("cartBtn");
  if (btn) btn.disabled = true;
  document.querySelectorAll(".add, [data-qv=\"add\"]").forEach(b => { b.disabled = true; });
  const note = document.createElement("p");
  note.className = "page-note"; note.setAttribute("role", "alert");
  note.append("We couldn't load the shop's live stock, so ordering is paused. Check your connection, then ");
  const retry = document.createElement("button");
  retry.type = "button"; retry.textContent = "Try again";
  retry.addEventListener("click", () => location.reload());
  note.append(retry);
  document.body.prepend(note);
  console.error("Flickers Comics: couldn't load shop data", e);
}
