/* Saved for later (the wishlist): kept in this browser only. */
import { esc, money, fullTitle } from "../shared.mjs";
import { qv, drawer, savedDlg, byId, saved, root, $, store, comicUrl, plural, takeParam, cart, cover, wantsOn, toast } from "./core.js";
import { cartQty, addToCart, openDrawer, bumpCart } from "./cart.js";

/* ===================== saved for later (wishlist) ===================== */
// Kept in this browser only. Remembers each comic's stock when it was saved, so a sold-out comic can be flagged "Back in stock".
export const SAVED_KEY = "flickers-saved-v1";
export const sanitizeSaved = raw => {
  const out = {};
  if (raw && typeof raw === "object") for (const [id, v] of Object.entries(raw)) if (Object.hasOwn(byId, id)) out[id] = { s: Math.max(0, Math.floor(Number(v && v.s) || 0)) };
  return out;
};
export const isSaved = id => Object.hasOwn(saved, id);
export const persistSaved = () => store.set(SAVED_KEY, saved);
export const backInStock = id => isSaved(id) && saved[id].s <= 0 && byId[id].stock > 0;
export function toggleSave(id) {
  const p = byId[id]; if (!p) return;
  if (isSaved(id)) { delete saved[id]; toast(`Removed ${fullTitle(p)} from your saved list`); }
  else { saved[id] = { s: p.stock }; toast(`Saved ${fullTitle(p)}`, { label: "View saved", fn: openSaved }); }
  persistSaved(); syncSaved();
}
export function syncSaved() {
  const ids = Object.keys(saved), news = ids.filter(backInStock).length;
  $("savedBtn").hidden = false;
  $("savedCount").textContent = ids.length;
  $("savedBtn").classList.toggle("has-news", news > 0);
  $("savedBtn").setAttribute("aria-label", `Saved for later: ${ids.length} ${ids.length === 1 ? "comic" : "comics"}${news ? `, ${news} back in stock` : ""}`);
  document.querySelectorAll("[data-save]").forEach(b => { b.hidden = false; b.setAttribute("aria-pressed", String(isSaved(b.dataset.save))); });
  if (savedDlg.open) renderSavedLines();
}
export function renderSavedLines() {
  const ids = Object.keys(saved);
  $("savedEmpty").hidden = ids.length > 0;
  $("savedFoot").hidden = ids.length === 0;
  $("savedLines").innerHTML = ids.map(id => {
    const p = byId[id], t = fullTitle(p), left = p.stock - cartQty(id);
    const status = p.stock <= 0 ? '<span class="low">Sold out</span>' : backInStock(id) ? '<span class="back">Back in stock</span>' : p.stock <= 2 ? `<span class="low">Only ${p.stock} left</span>` : "In stock";
    return `<li class="line">
      <div class="line-thumb">${cover(p, { lazy: false, sizes: "54px" })}</div>
      <div>
        <p class="line-title"><a href="${comicUrl(id)}">${esc(t)}</a></p>
        <p class="line-meta">${money(p.price)} · ${status}</p>
        <div class="line-actions">
          <button type="button" class="btn btn-small${p.stock > 0 && left > 0 ? " btn-yellow" : ""}" data-add="${esc(id)}" aria-disabled="${p.stock <= 0 ? !wantsOn() : left <= 0}" aria-label="${p.stock <= 0 && wantsOn() ? "Notify me when it's back" : "Add to cart"}: ${esc(t)}">${p.stock <= 0 ? (wantsOn() ? "Notify me" : "Sold out") : left <= 0 ? "All in cart" : "Add to cart"}</button>
        </div>
      </div>
      <div class="line-right"><button type="button" class="link-btn" data-save="${esc(id)}" aria-pressed="true" aria-label="Remove ${esc(t)} from saved">Remove</button></div>
    </li>`;
  }).join("");
}
export function openSaved() {
  if (qv.open) qv.close();
  if (drawer.open) drawer.close();
  renderSavedLines();
  savedDlg.showModal();
}
export function addAllSaved() {
  let n = 0;
  for (const id of Object.keys(saved)) if (addToCart(id, 1)) n++;
  if (n) { bumpCart(); toast(`Added ${plural(n, "saved comic")} to your cart`, { label: "View cart", fn: () => { savedDlg.close(); openDrawer(); } }); }
  else toast("Nothing available to add. Those are sold out or already in your cart.");
}
export const wishLink = () => new URL(`${root}?wish=${Object.keys(saved).join(",")}`, location.href).href;
export function loadSharedWish() {
  const raw = takeParam("wish");
  if (raw === null) return;
  let added = 0, skipped = 0;
  for (const id of raw.slice(0, 3000).split(",").slice(0, 60)) {
    if (!Object.hasOwn(byId, id)) { skipped++; continue; }
    if (!isSaved(id)) { saved[id] = { s: byId[id].stock }; added++; }
  }
  if (added) { persistSaved(); syncSaved(); toast(`Saved ${plural(added, "comic")} from a shared list${skipped ? ` (${skipped} no longer in the shop)` : ""}`, { label: "View saved", fn: openSaved }); }
  else toast(skipped ? "Those comics are no longer in the shop." : "Those comics were already on your saved list.");
}
$("savedBtn").addEventListener("click", openSaved);
$("savedAddAll").addEventListener("click", addAllSaved);
savedDlg.addEventListener("close", () => { // once they have seen that a comic is back, stop flagging it
  let changed = false;
  for (const id of Object.keys(saved)) if (backInStock(id)) { saved[id].s = byId[id].stock; changed = true; }
  if (changed) { persistSaved(); syncSaved(); }
});
