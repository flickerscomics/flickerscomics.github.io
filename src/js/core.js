/* Shared state and small helpers for the storefront: the shop data, the visitor's cart and saved list, storage, toasts, the dialogs. */
import { esc, coverHTML } from "../shared.mjs";

export const root = document.body.dataset.root || "";
export const $ = id => document.getElementById(id);
export const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};
export const focusFirst = (rootEl, ...sels) => { for (const s of sels) { const el = rootEl.querySelector(s); if (el) { el.focus(); return; } } };
export const firstName = s => String(s).trim().split(/\s+/)[0] || "";
export const comicUrl = id => `${root}comic/${id}/`;
/* the dialogs; each is filled in and opened by the code below */
export const qv = $("qv"), drawer = $("drawer"), co = $("co"), tr = $("track"), savedDlg = $("saved"), wd = $("want");
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
/* The address's query string is for sharing (shelf, search, cart and wish links); these keep it tidy. */
export function replaceQuery(params) {
  const qs = params.toString();
  try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (e) { /* ignore */ }
}
/* Reads a one-off ?name=value link parameter and removes it from the address, leaving the rest alone. Null when it isn't there. */
export function takeParam(name) {
  let params;
  try { params = new URLSearchParams(location.search); } catch (e) { return null; }
  const value = params.get(name);
  if (value === null) return null;
  params.delete(name);
  replaceQuery(params);
  return value;
}
export async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch (e) { /* no body */ }
  return { ok: res.ok, data };
}
export let CONFIG, CATEGORIES, PRODUCTS = [], byId = {}, index = new Map();
export let cart = {}, saved = {}, lastOrder = null; // the visitor's cart and saved list, and the order just placed in this visit (so its tracking page can open without retyping)
/* The state above is owned here: other modules read it, and change it only through these. */
export const setCart = v => { cart = v; };
export const setSaved = v => { saved = v; };
export const setLastOrder = v => { lastOrder = v; };
export const setIndex = v => { index = v; };
export function setShop(data) {
  CONFIG = data.config; CATEGORIES = data.categories; PRODUCTS = data.products;
  PRODUCTS.forEach(p => { p.stock = Math.max(0, Math.floor(Number(p.stock) || 0)); p.price = Math.max(0, Number(p.price) || 0); });
  byId = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
}
export const apiBase = () => CONFIG.orderApi.replace(/\/orders\/?$/, "");
export const cover = (p, opts) => coverHTML(p, { imgBase: root, ...opts });
export const statusReady = fetch(`${root}data/shop.json?v=${document.body.dataset.build || ""}`).then(r => { if (!r.ok) throw new Error("shop.json " + r.status); return r.json(); });
export function wantsOn() { return !!(CONFIG && CONFIG.orderApi && !CONFIG.testMode); }
export function copyText(text, ok, fail) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast(ok), () => toast(fail));
  else toast(fail);
}
/* ===================== toast ===================== */
export const toastEl = $("toast");
export let toastTimer = 0;
export function hideToast() { toastEl.hidden = true; toastEl.innerHTML = ""; }
export function toast(msg, action) {
  toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ""}`;
  if (action) toastEl.querySelector(".toast-btn").addEventListener("click", () => { hideToast(); action.fn(); });
  toastEl.hidden = false;
  toastEl.classList.remove("show"); void toastEl.offsetWidth; toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4500);
}
