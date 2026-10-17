/* The shelves: search (with suggestions), sorting, filters and the address bar that remembers them. */
import { searchItems, searchWords, norm, isVariant, esc, money, fullTitle } from "../shared.mjs";
import { CATEGORIES, PRODUCTS, byId, index, $, replaceQuery, cart, setIndex, wantsOn } from "./core.js";
import { cartQty } from "./cart.js";

/* ===================== shelves ===================== */
export const grid = $("grid");
export const filters = { group: "all", q: "", sort: "featured", instock: false, novar: false, last: false, max: 0, pub: "" };
export const SORTS = ["featured", "newest", "price-asc", "price-desc", "title"];
// The shelf (publisher or category tab), search and sort live in the address, e.g. ?shelf=DC+Comics&sort=price-asc,
// so a filtered shelf can be shared and the Back button keeps working. Other parameters are left alone.
export function readUrlState() {
  const p = new URLSearchParams(location.search);
  const q = p.get("q"), s = p.get("sort"), g = p.get("shelf");
  if (q) { filters.q = q; if ($("q")) $("q").value = q; }
  if (SORTS.includes(s)) { filters.sort = s; if ($("sort")) $("sort").value = s; }
  if (g && document.querySelector(`.divider[data-group="${CSS.escape(g)}"]`)) filters.group = g;
  for (const k of ["instock", "novar", "last"]) if (p.get(k) === "1" && document.querySelector(`[data-chip="${k}"]`)) filters[k] = true;
  const pub = p.get("pub"); if (pub && $("pubFilter") && [...$("pubFilter").options].some(o => o.value === pub)) { filters.pub = pub; $("pubFilter").value = pub; }
  const max = Number(p.get("max")); if (max > 0 && $("maxPrice") && [...$("maxPrice").options].some(o => Number(o.value) === max)) { filters.max = max; $("maxPrice").value = String(max); }
}
export function writeUrlState() {
  const p = new URLSearchParams(location.search);
  ["shelf", "q", "sort", "instock", "novar", "last", "max", "pub"].forEach(k => p.delete(k));
  if (filters.group !== "all") p.set("shelf", filters.group);
  if (filters.q.trim()) p.set("q", filters.q.trim());
  if (filters.sort !== "featured") p.set("sort", filters.sort);
  for (const k of ["instock", "novar", "last"]) if (filters[k]) p.set(k, "1");
  if (filters.max) p.set("max", String(filters.max));
  if (filters.pub) p.set("pub", filters.pub);
  replaceQuery(p);
}

/* What each comic can be found and sorted by, built once from the shop data (the cards themselves carry only an id, shelf and position). */
export function buildIndex() {
  setIndex(new Map(PRODUCTS.map(p => [p.id, { title: fullTitle(p).toLowerCase(), words: searchWords(p, CATEGORIES), blurb: norm(p.blurb), variant: isVariant(p) }])));
}
export function applyFilters() {
  if (!grid) return;
  const cards = [...grid.querySelectorAll(".card")], inGroup = c => filters.group === "all" || c.dataset.group === filters.group;
  if (!index.size) { cards.forEach(c => { c.hidden = !inGroup(c); }); return; } // shop data not here yet: only the shelf can be applied
  const q = filters.q.trim();
  const rows = cards.map(c => ({ c, p: byId[c.dataset.id], i: Number(c.dataset.index) }));
  rows.filter(r => !r.p).forEach(r => { r.c.hidden = true; }); // a card for something the shop no longer lists
  const known = rows.filter(r => r.p);
  const sorters = {
    featured: (a, b) => ((b.p.stock > 0) - (a.p.stock > 0)) || a.i - b.i,
    newest: (a, b) => String(b.p.added || "").localeCompare(String(a.p.added || "")) || ((b.p.stock > 0) - (a.p.stock > 0)) || a.i - b.i, // comics with no date (the older ones) keep the shelf order below the dated ones
    "price-asc": (a, b) => a.p.price - b.p.price || a.i - b.i,
    "price-desc": (a, b) => b.p.price - a.p.price || a.i - b.i,
    title: (a, b) => index.get(a.p.id).title.localeCompare(index.get(b.p.id).title, "en", { numeric: true, sensitivity: "base" }) || a.i - b.i // natural order: #2 comes before #10
  };
  known.sort(sorters[filters.sort] || sorters.featured);
  let shown = 0;
  const found = searchItems(known.map(r => index.get(r.p.id)), q);
  known.forEach(({ c, p }, k) => {
    const ok = inGroup(c) && found.flags[k]
      && (!filters.instock || p.stock > 0) && (!filters.novar || !index.get(p.id).variant) && (!filters.last || (p.stock >= 1 && p.stock <= 2)) && (!filters.max || p.price <= filters.max) && (!filters.pub || (p.publisher || "Other") === filters.pub);
    c.hidden = !ok;
    if (ok) shown++;
    grid.appendChild(c);
  });
  document.querySelectorAll("[data-chip]").forEach(b => b.setAttribute("aria-pressed", String(!!filters[b.dataset.chip])));
  const narrowed = filters.instock || filters.novar || filters.last || filters.max > 0 || !!filters.pub;
  if ($("clearFilters")) $("clearFilters").hidden = !narrowed;
  $("empty").hidden = shown > 0;
  writeUrlState();
  const tab = filters.group === "all" ? null : document.querySelector(`.divider[data-group="${CSS.escape(filters.group)}"]`);
  const label = (filters.group === "all" ? "" : ` in ${tab && tab.firstChild ? tab.firstChild.textContent : filters.group}`) + (filters.pub ? ` from ${filters.pub}` : "");
  const how = found.mode === "close" ? ", close matches" : found.mode === "blurb" ? ", found in descriptions" : "";
  $("results").textContent = shown ? `${shown} ${shown === 1 ? "item" : "items"}${label}${q ? ` matching “${q}”${how}` : ""}${narrowed ? ", filtered" : ""}` : "";
}
export function setGroup(g) {
  filters.group = g;
  document.querySelectorAll(".divider").forEach(b => {
    const on = b.dataset.group === g;
    b.setAttribute("aria-pressed", String(on));
    if (on && b.parentElement.scrollWidth > b.parentElement.clientWidth) b.parentElement.scrollTo({ left: Math.max(0, b.offsetLeft - 24) }); // slide the tab row sideways only, never the page
  });
  applyFilters();
}

export function stockHTML(p) {
  const parts = [], n = cartQty(p.id);
  if (p.stock <= 0) parts.push(`<span class="low">Sold out</span>`);
  else if (p.stock <= 2) parts.push(`<span class="low">Only ${p.stock} left</span>`);
  if (n) parts.push(`<span class="incart">${n} in your cart</span>`);
  return parts.join(" · ");
}
export function addState(p) {
  if (p.stock <= 0 && wantsOn()) return { off: false, label: "Notify me", notify: true };
  if (p.stock <= 0) return { off: true, label: "Sold out" };
  if (cartQty(p.id) >= p.stock) return { off: true, label: "All in cart" };
  return { off: false, label: "Add" };
}
export function refreshCards() {
  document.querySelectorAll(".card").forEach(card => {
    const p = byId[card.dataset.id]; if (!p) return;
    const btn = card.querySelector(".add"), st = addState(p), t = fullTitle(p);
    card.querySelector(".stock").innerHTML = stockHTML(p);
    btn.setAttribute("aria-disabled", String(st.off));
    btn.setAttribute("aria-label", st.notify ? "Notify me when it's back: " + t : (st.off ? st.label + ": " : "Add to cart: ") + t);
    if (!btn.classList.contains("added")) btn.textContent = st.label;
  });
}
/* Suggestions under the search box: the comics that match what's been typed so far, so a customer can pick one instead of finishing the title. */
export function initSuggest() {
  const input = $("q"), list = $("qSuggest");
  if (!input || !list) return;
  let shown = [], active = -1;
  const close = () => { list.hidden = true; list.innerHTML = ""; shown = []; active = -1; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); };
  const mark = i => {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute("aria-selected", String(k === i)));
    if (i >= 0) { input.setAttribute("aria-activedescendant", "sug-" + i); list.children[i].scrollIntoView({ block: "nearest" }); } else input.removeAttribute("aria-activedescendant");
  };
  const pick = i => { const p = shown[i]; if (!p) return; input.value = fullTitle(p); filters.q = input.value; close(); setGroup("all"); };
  const open = () => {
    const q = input.value.trim();
    if (q.length < 2 || !index.size) return close();
    const found = searchItems(PRODUCTS.map(p => index.get(p.id)), q);
    if (found.mode !== "exact" && found.mode !== "close") return close();
    shown = PRODUCTS.filter((p, k) => found.flags[k]).sort((a, b) => (b.stock > 0) - (a.stock > 0)).slice(0, 6);
    if (!shown.length || (shown.length === 1 && fullTitle(shown[0]).toLowerCase() === q.toLowerCase())) return close(); // they've typed the whole title already
    list.innerHTML = shown.map((p, i) => `<li role="option" id="sug-${i}" aria-selected="false" data-i="${i}"><span class="sug-title">${esc(fullTitle(p))}</span><span class="sug-meta">${p.stock > 0 ? money(p.price) : "Sold out"}</span></li>`).join("");
    list.hidden = false; input.setAttribute("aria-expanded", "true"); active = -1;
  };
  input.addEventListener("input", open);
  input.addEventListener("keydown", ev => {
    if (list.hidden) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); mark((active + 1) % shown.length); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); mark(active <= 0 ? shown.length - 1 : active - 1); }
    else if (ev.key === "Enter" && active >= 0) { ev.preventDefault(); pick(active); }
    else if (ev.key === "Escape") { ev.preventDefault(); close(); }
  });
  list.addEventListener("mousedown", ev => { const li = ev.target.closest("li[data-i]"); if (li) { ev.preventDefault(); pick(Number(li.dataset.i)); } }); // before the box loses focus
  input.addEventListener("blur", () => setTimeout(close, 120));
}
if ($("q")) {
  initSuggest();
  $("q").addEventListener("input", ev => { filters.q = ev.target.value; applyFilters(); });
  $("sort").addEventListener("change", ev => { filters.sort = ev.target.value; applyFilters(); });
  $("clearSearch").addEventListener("click", () => { Object.assign(filters, { q: "", instock: false, novar: false, last: false, max: 0, pub: "" }); $("q").value = ""; if ($("maxPrice")) $("maxPrice").value = "0"; if ($("pubFilter")) $("pubFilter").value = ""; setGroup("all"); $("q").focus(); });
  document.querySelectorAll("[data-chip]").forEach(b => b.addEventListener("click", () => { filters[b.dataset.chip] = !filters[b.dataset.chip]; applyFilters(); }));
  if ($("maxPrice")) $("maxPrice").addEventListener("change", ev => { filters.max = Number(ev.target.value) || 0; applyFilters(); });
  if ($("pubFilter")) $("pubFilter").addEventListener("change", ev => { filters.pub = ev.target.value; applyFilters(); });
  if ($("clearFilters")) $("clearFilters").addEventListener("click", () => { Object.assign(filters, { instock: false, novar: false, last: false, max: 0, pub: "" }); if ($("maxPrice")) $("maxPrice").value = "0"; if ($("pubFilter")) $("pubFilter").value = ""; applyFilters(); });
}
document.addEventListener("keydown", ev => {
  if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey || !$("q")) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.querySelector("dialog[open]")) return;
  ev.preventDefault();
  $("q").focus();
  $("q").scrollIntoView({ block: "center" });
});
