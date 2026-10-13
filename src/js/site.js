/* Flickers Comics storefront.
   The shelves and comic pages are rendered at build time (see build/). This script adds the cart,
   quick view, checkout, search and filters on top. Stock and prices come from data/shop.json. */
import { searchItems, searchWords, norm, isVariant, heartIcon, detailHTML, dealDiscount, dealOn, dealName, esc, escLines, money, fullTitle, hLabel, hoursText, hoursShort, DAYS, coverHTML } from "../shared.mjs";

const root = document.body.dataset.root || "";
const $ = id => document.getElementById(id);
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};
const focusFirst = (rootEl, ...sels) => { for (const s of sels) { const el = rootEl.querySelector(s); if (el) { el.focus(); return; } } };
const firstName = s => String(s).trim().split(/\s+/)[0] || "";
const comicUrl = id => `${root}comic/${id}/`;
/* the dialogs; each is filled in and opened by the code below */
const qv = $("qv"), drawer = $("drawer"), co = $("co"), tr = $("track"), savedDlg = $("saved"), wd = $("want");
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/* The address's query string is for sharing (shelf, search, cart and wish links); these keep it tidy. */
function replaceQuery(params) {
  const qs = params.toString();
  try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (e) { /* ignore */ }
}
/* Reads a one-off ?name=value link parameter and removes it from the address, leaving the rest alone. Null when it isn't there. */
function takeParam(name) {
  let params;
  try { params = new URLSearchParams(location.search); } catch (e) { return null; }
  const value = params.get(name);
  if (value === null) return null;
  params.delete(name);
  replaceQuery(params);
  return value;
}
async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch (e) { /* no body */ }
  return { ok: res.ok, data };
}

let CONFIG, CATEGORIES, PRODUCTS = [], byId = {}, index = new Map();
const apiBase = () => CONFIG.orderApi.replace(/\/orders\/?$/, "");
const cover = (p, opts) => coverHTML(p, { imgBase: root, ...opts });
const statusReady = fetch(`${root}data/shop.json?v=${document.body.dataset.build || ""}`).then(r => { if (!r.ok) throw new Error("shop.json " + r.status); return r.json(); });

/* ===================== hours ===================== */
function shopNow() {
  const d = new Date();
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: CONFIG.timeZone, year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23"
    }).formatToParts(d).map(x => [x.type, x.value]));
    return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour % 24, wd: parts.weekday };
  } catch (e) {
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), wd: DAYS[(d.getDay() + 6) % 7] };
  }
}
const ymdAdd = (o, n) => { const t = new Date(Date.UTC(o.y, o.m - 1, o.d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const isoDate = o => `${o.y}-${String(o.m).padStart(2, "0")}-${String(o.d).padStart(2, "0")}`;
function fmtDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
function hoursStatus() {
  const n = shopNow();
  if (n.h >= CONFIG.openHour && n.h < CONFIG.closeHour) return { open: true, text: `Open now · closes at ${hLabel(CONFIG.closeHour)}` };
  if (n.h < CONFIG.openHour) return { open: false, text: `Closed · opens today at ${hLabel(CONFIG.openHour)}` };
  return { open: false, text: `Closed · opens tomorrow at ${hLabel(CONFIG.openHour)}` };
}
function renderHours() {
  const st = hoursStatus();
  $("stripStatus").classList.toggle("is-open", st.open);
  $("stripStatusText").textContent = st.text;
  const pill = $("hoursStatus");
  if (pill) { pill.classList.toggle("is-open", st.open); $("hoursStatusText").textContent = st.text; }
  const week = $("week");
  if (week) {
    const today = shopNow().wd;
    week.innerHTML = DAYS.map(d => `<li class="day${d === today ? " is-today" : ""}"><b>${d}</b><span>${hoursShort(CONFIG)}</span>${d === today ? `<em class="sr-only">today</em>` : ""}</li>`).join("");
  }
}

/* ===================== cart state ===================== */
const CART_KEY = "flickers-cart-v1";
let cart = {};
const sanitizeCart = raw => {
  const out = {};
  if (raw && typeof raw === "object") for (const [id, q] of Object.entries(raw)) {
    const p = byId[id], n = Math.floor(Number(q));
    if (p && p.stock > 0 && n > 0) out[id] = Math.min(n, p.stock);
  }
  return out;
};
const saveCart = () => store.set(CART_KEY, cart);
const cartQty = id => cart[id] || 0;
const cartCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
const cartSubtotal = () => Object.entries(cart).reduce((s, [id, q]) => s + byId[id].price * q, 0);
const cartDeal = () => dealDiscount(Object.entries(cart).map(([id, qty]) => ({ price: byId[id].price, qty })), CONFIG.deal);
const dealWords = d => (d.free === 1 ? "the cheapest one is" : `the cheapest ${d.free} are`);
function addToCart(id, n = 1) {
  const p = byId[id];
  if (!p || p.stock <= 0) return false;
  const next = Math.min(p.stock, cartQty(id) + n);
  if (next === cartQty(id)) return false;
  cart[id] = next; saveCart(); renderCartUI();
  return true;
}
function setQty(id, n) {
  const p = byId[id]; if (!p) return;
  n = Math.max(0, Math.min(p.stock, n));
  if (n === 0) delete cart[id]; else cart[id] = n;
  saveCart(); renderCartUI();
}

/* ===================== shelves ===================== */
const grid = $("grid");
const filters = { group: "all", q: "", sort: "featured", instock: false, novar: false, last: false, max: 0, pub: "" };
const SORTS = ["featured", "price-asc", "price-desc", "title"];
// The shelf (publisher or category tab), search and sort live in the address, e.g. ?shelf=DC+Comics&sort=price-asc,
// so a filtered shelf can be shared and the Back button keeps working. Other parameters are left alone.
function readUrlState() {
  const p = new URLSearchParams(location.search);
  const q = p.get("q"), s = p.get("sort"), g = p.get("shelf");
  if (q) { filters.q = q; if ($("q")) $("q").value = q; }
  if (SORTS.includes(s)) { filters.sort = s; if ($("sort")) $("sort").value = s; }
  if (g && document.querySelector(`.divider[data-group="${CSS.escape(g)}"]`)) filters.group = g;
  for (const k of ["instock", "novar", "last"]) if (p.get(k) === "1" && document.querySelector(`[data-chip="${k}"]`)) filters[k] = true;
  const pub = p.get("pub"); if (pub && $("pubFilter") && [...$("pubFilter").options].some(o => o.value === pub)) { filters.pub = pub; $("pubFilter").value = pub; }
  const max = Number(p.get("max")); if (max > 0 && $("maxPrice") && [...$("maxPrice").options].some(o => Number(o.value) === max)) { filters.max = max; $("maxPrice").value = String(max); }
}
function writeUrlState() {
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
function buildIndex() {
  index = new Map(PRODUCTS.map(p => [p.id, { title: fullTitle(p).toLowerCase(), words: searchWords(p, CATEGORIES), blurb: norm(p.blurb), variant: isVariant(p) }]));
}
function applyFilters() {
  if (!grid) return;
  const cards = [...grid.querySelectorAll(".card")], inGroup = c => filters.group === "all" || c.dataset.group === filters.group;
  if (!index.size) { cards.forEach(c => { c.hidden = !inGroup(c); }); return; } // shop data not here yet: only the shelf can be applied
  const q = filters.q.trim();
  const rows = cards.map(c => ({ c, p: byId[c.dataset.id], i: Number(c.dataset.index) }));
  rows.filter(r => !r.p).forEach(r => { r.c.hidden = true; }); // a card for something the shop no longer lists
  const known = rows.filter(r => r.p);
  const sorters = {
    featured: (a, b) => ((b.p.stock > 0) - (a.p.stock > 0)) || a.i - b.i,
    "price-asc": (a, b) => a.p.price - b.p.price || a.i - b.i,
    "price-desc": (a, b) => b.p.price - a.p.price || a.i - b.i,
    title: (a, b) => index.get(a.p.id).title.localeCompare(index.get(b.p.id).title) || a.i - b.i
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
function setGroup(g) {
  filters.group = g;
  document.querySelectorAll(".divider").forEach(b => {
    const on = b.dataset.group === g;
    b.setAttribute("aria-pressed", String(on));
    if (on && b.parentElement.scrollWidth > b.parentElement.clientWidth) b.parentElement.scrollTo({ left: Math.max(0, b.offsetLeft - 24) }); // slide the tab row sideways only, never the page
  });
  applyFilters();
}

function stockHTML(p) {
  const parts = [], n = cartQty(p.id);
  if (p.stock <= 0) parts.push(`<span class="low">Sold out</span>`);
  else if (p.stock <= 2) parts.push(`<span class="low">Only ${p.stock} left</span>`);
  if (n) parts.push(`<span class="incart">${n} in your cart</span>`);
  return parts.join(" · ");
}
function wantsOn() { return !!(CONFIG && CONFIG.orderApi && !CONFIG.testMode); }
function addState(p) {
  if (p.stock <= 0 && wantsOn()) return { off: false, label: "Notify me", notify: true };
  if (p.stock <= 0) return { off: true, label: "Sold out" };
  if (cartQty(p.id) >= p.stock) return { off: true, label: "All in cart" };
  return { off: false, label: "Add" };
}
function refreshCards() {
  document.querySelectorAll(".card").forEach(card => {
    const p = byId[card.dataset.id]; if (!p) return;
    const btn = card.querySelector(".add"), st = addState(p), t = fullTitle(p);
    card.querySelector(".stock").innerHTML = stockHTML(p);
    btn.setAttribute("aria-disabled", String(st.off));
    btn.setAttribute("aria-label", st.notify ? "Notify me when it's back: " + t : (st.off ? st.label + ": " : "Add to cart: ") + t);
    if (!btn.classList.contains("added")) btn.textContent = st.label;
  });
}

/* ===================== buy box (quick view and comic page) ===================== */
let qvState = { id: null, qty: 1 };
const pageBuyEl = document.querySelector("[data-buy]");
const pageState = pageBuyEl ? { id: pageBuyEl.dataset.buy, qty: 1 } : null;
const buyMax = p => Math.max(0, p.stock - cartQty(p.id));

function buyCore(p, st) {
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
function buyHTML(p, st) {
  const live = wantsOn();
  return buyCore(p, st) + (p.stock > 0 && dealOn(CONFIG.deal) ? `<p class="deal-note"><b>${esc(dealName(CONFIG.deal))}.</b> In a cart of ${CONFIG.deal.buy + CONFIG.deal.free}, ${dealWords(CONFIG.deal)} free.</p>` : "") + `<div class="buy-extras">${p.stock <= 0 && live ? `<button type="button" class="btn btn-small btn-yellow" data-want="restock" data-id="${esc(p.id)}">Tell me when it's back</button>` : ""}<button type="button" class="link-btn save-link" data-save="${esc(p.id)}" aria-pressed="${isSaved(p.id)}">${heartIcon}Save for later</button>${live ? `<button type="button" class="link-btn" data-want="series" data-id="${esc(p.id)}">Follow ${esc(p.title)}</button>` : ""}</div>`;
}
function renderPageBuy() { if (pageBuyEl && byId[pageState.id]) pageBuyEl.innerHTML = buyHTML(byId[pageState.id], pageState); }

function renderQV() {
  const p = byId[qvState.id]; if (!p) return;
  $("qvBody").innerHTML = detailHTML(p, CATEGORIES, {
    imgBase: root, level: 2, headingId: "qvTitle", cover: { lazy: false, sizes: "220px" },
    before: `<button type="button" class="icon-btn qv-close" data-close aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`,
    buy: `<div class="qv-buy">${buyHTML(p, qvState)}</div>`,
    after: `<p class="hint"><a href="${comicUrl(p.id)}">Open the full page</a></p>`
  });
}
function openQuickView(id) {
  qvState = { id, qty: 1 };
  renderQV();
  if (!qv.open) qv.showModal();
  (qv.querySelector('[data-qv="add"]') || qv.querySelector("[data-close]"))?.focus();
}

/* ===================== cart drawer ===================== */
function renderLines() {
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
function renderCartUI() {
  const n = cartCount(), sub = cartSubtotal() - cartDeal().discount;
  $("cartCount").textContent = n;
  $("cartTotal").textContent = money(sub);
  $("cartBtn").setAttribute("aria-label", `Cart: ${n} ${n === 1 ? "item" : "items"}, ${money(sub)}`);
  $("checkoutBtn").disabled = n === 0;
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
function openDrawer() {
  if (qv.open) qv.close();
  renderLines();
  drawer.showModal();
}
function bumpCart() { const b = $("cartBtn"); b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }

/* ===================== checkout ===================== */
const form = $("coForm");
const F = { name: $("f-name"), phone: $("f-phone"), date: $("f-date"), address: $("f-address"), notes: $("f-notes") };
const getMethod = () => (form.querySelector('input[name="method"]:checked') || {}).value || "collect";
function totals() { const sub = cartSubtotal(), discount = cartDeal().discount, post = getMethod() === "post" ? CONFIG.postage : 0; return { sub, discount, post, total: sub - discount + post }; }
function renderSummary() {
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
function syncMethod() {
  const post = getMethod() === "post";
  $("collectPanel").hidden = post;
  $("postPanel").hidden = !post;
  renderSummary();
}
function setDateBounds() {
  const n = shopNow();
  const start = n.h >= CONFIG.closeHour ? ymdAdd(n, 1) : { y: n.y, m: n.m, d: n.d };
  const end = ymdAdd(start, CONFIG.collectDaysAhead);
  F.date.min = isoDate(start); F.date.max = isoDate(end);
  if (F.date.value && (F.date.value < F.date.min || F.date.value > F.date.max)) F.date.value = "";
  $("h-date").textContent = `Any day up to two weeks ahead. We're open ${hoursText(CONFIG)} every day.`;
}
function validate() {
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
function showErrors(errs) {
  ["name", "phone", "date", "address"].forEach(k => {
    const el = F[k], msg = $("e-" + k);
    if (errs[k]) { el.setAttribute("aria-invalid", "true"); msg.textContent = errs[k]; msg.hidden = false; }
    else { el.removeAttribute("aria-invalid"); msg.textContent = ""; msg.hidden = true; }
  });
  const first = ["name", "phone", "date", "address"].find(k => errs[k]);
  if (first) F[first].focus();
}
function buildOrder() {
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
function openCheckout() {
  if (!cartCount()) return;
  if (drawer.open) drawer.close();
  $("coFormView").hidden = false;
  $("coDoneView").hidden = true;
  $("coDoneView").innerHTML = "";
  $("testNote").hidden = !CONFIG.testMode;
  $("formError").textContent = "";
  setDateBounds();
  syncMethod();
  co.showModal();
  co.scrollTop = 0;
  F.name.focus();
}
async function placeOrder(ev) {
  ev.preventDefault();
  $("formError").textContent = "";
  const errs = validate();
  showErrors(errs);
  if (Object.keys(errs).length) return;
  const order = buildOrder();
  if (CONFIG.testMode || !CONFIG.orderApi) {
    cart = {}; saveCart(); renderCartUI();
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
    cart = {}; saveCart(); renderCartUI();
    btn.disabled = false;
    lastOrder = { id: placed.id, phone: placed.phone };
    showDone(placed);
  } catch (e) {
    $("formError").textContent = e.shown ? e.message : "We couldn't send your order. Check your connection and try again.";
    btn.disabled = false; btn.textContent = label; renderSummary();
  }
}
function discordPreview(o) {
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
function showDone(o) {
  const collect = o.method === "collect";
  $("coFormView").hidden = true;
  const view = $("coDoneView");
  view.hidden = false;
  view.innerHTML = `<div class="done">
    <div class="done-top">
      <p class="eyebrow">${o.test ? "Test order" : o.paid ? "Payment received" : "Order received"}</p>
      <h2 class="done-title" id="doneTitle" tabindex="-1">Thanks, ${esc(firstName(o.name))}. Order received.</h2>
      <p class="ticket">Order <strong>${esc(o.id)}</strong> <button type="button" class="link-btn" data-copy="${esc(o.id)}">Copy</button></p>
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
function resetCheckout() {
  form.reset();
  ["name", "phone", "date", "address"].forEach(k => { F[k].removeAttribute("aria-invalid"); $("e-" + k).hidden = true; });
  $("coFormView").hidden = false;
  $("coDoneView").hidden = true;
  $("coDoneView").innerHTML = "";
}
function handlePaymentReturn() {
  // Live mode only: the order service sends shoppers back to  ?order=FC-1234&status=paid  (or failed, or pending while Fleeca confirms).
  const unknown = takeParam("payment");
  if (unknown === "unknown") { toast("We couldn't find that payment. If you paid, check Track order with your order number and phone."); return; }
  const id = takeParam("order"), status = takeParam("status");
  if (!id || !status) return;
  const pending = store.get("flickers-pending-order", null);
  if (status === "paid" && pending && pending.id === id) {
    cart = {}; saveCart(); renderCartUI();
    store.set("flickers-pending-order", null);
    co.showModal();
    showDone({ ...pending, test: false, paid: true });
  } else if (status === "paid") {
    // paid, but this browser doesn't hold the order (a different device or cleared storage): the order is placed all the same
    toast(`Payment received. Thank you! Your order number is ${id}. You can follow it under Track order.`);
  } else if (status === "pending") {
    // The order is placed and its comics are held; Fleeca just hasn't confirmed yet. Don't tell a paying customer it failed.
    if (pending && pending.id === id) { cart = {}; saveCart(); renderCartUI(); store.set("flickers-pending-order", null); }
    toast(`We're confirming your payment with Fleeca. Check Track order in a minute with order number ${id}.`);
  } else {
    toast("Your payment didn't go through, so nothing was charged. Your cart is still here.");
  }
}

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

/* ===================== saved for later (wishlist) ===================== */
// Kept in this browser only. Remembers each comic's stock when it was saved, so a sold-out comic can be flagged "Back in stock".
const SAVED_KEY = "flickers-saved-v1";
let saved = {};
const sanitizeSaved = raw => {
  const out = {};
  if (raw && typeof raw === "object") for (const [id, v] of Object.entries(raw)) if (Object.hasOwn(byId, id)) out[id] = { s: Math.max(0, Math.floor(Number(v && v.s) || 0)) };
  return out;
};
const isSaved = id => Object.hasOwn(saved, id);
const persistSaved = () => store.set(SAVED_KEY, saved);
const backInStock = id => isSaved(id) && saved[id].s <= 0 && byId[id].stock > 0;
function toggleSave(id) {
  const p = byId[id]; if (!p) return;
  if (isSaved(id)) { delete saved[id]; toast(`Removed ${fullTitle(p)} from your saved list`); }
  else { saved[id] = { s: p.stock }; toast(`Saved ${fullTitle(p)}`, { label: "View saved", fn: openSaved }); }
  persistSaved(); syncSaved();
}
function syncSaved() {
  const ids = Object.keys(saved), news = ids.filter(backInStock).length;
  $("savedBtn").hidden = false;
  $("savedCount").textContent = ids.length;
  $("savedBtn").classList.toggle("has-news", news > 0);
  $("savedBtn").setAttribute("aria-label", `Saved for later: ${ids.length} ${ids.length === 1 ? "comic" : "comics"}${news ? `, ${news} back in stock` : ""}`);
  document.querySelectorAll("[data-save]").forEach(b => { b.hidden = false; b.setAttribute("aria-pressed", String(isSaved(b.dataset.save))); });
  if (savedDlg.open) renderSavedLines();
}
function renderSavedLines() {
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
function openSaved() {
  if (qv.open) qv.close();
  if (drawer.open) drawer.close();
  renderSavedLines();
  savedDlg.showModal();
}
function addAllSaved() {
  let n = 0;
  for (const id of Object.keys(saved)) if (addToCart(id, 1)) n++;
  if (n) { bumpCart(); toast(`Added ${plural(n, "saved comic")} to your cart`, { label: "View cart", fn: () => { savedDlg.close(); openDrawer(); } }); }
  else toast("Nothing available to add. Those are sold out or already in your cart.");
}
const wishLink = () => new URL(`${root}?wish=${Object.keys(saved).join(",")}`, location.href).href;
function loadSharedWish() {
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

/* ===================== wanted list: notify me, follow a series, request a comic ===================== */
const wForm = $("wantForm");
let wantCtx = null;
const WANT_COPY = {
  restock: p => ({ title: "Tell me when it's back", intro: `Leave your details and we'll let you know when ${fullTitle(p)} is back on the shelves.`, button: "Notify me", done: "You're on the list", msg: `We'll text you when ${fullTitle(p)} is back.` }),
  series: p => ({ title: `Follow ${p.title}`, intro: `Follow ${p.title} and we'll let you know when a new issue arrives, so you can have it set aside.`, button: "Follow this series", done: "You're following it", msg: `We'll text you when a new issue of ${p.title} comes in.` }),
  request: () => ({ title: "Request a comic", intro: "Can't find it on the shelves? Tell us what you're after and we'll see if we can get it in.", button: "Send request", done: "Request sent", msg: "We'll be in touch if we can get it in." })
};
function showWantButtons() { document.querySelectorAll("[data-want]").forEach(b => { b.hidden = !wantsOn(); }); document.querySelectorAll("[data-want-only]").forEach(e => { e.hidden = !wantsOn(); }); }
function openWant(kind, id, prefill = "") {
  const p = id ? byId[id] : null;
  if (!WANT_COPY[kind] || (kind !== "request" && !p)) return;
  wantCtx = { kind, id: p ? p.id : null };
  const c = WANT_COPY[kind](p);
  [qv, drawer, co, tr, savedDlg].forEach(d => { if (d.open) d.close(); });
  $("wantTitle").textContent = c.title; $("wantIntro").textContent = c.intro; $("wantBtn").textContent = c.button;
  $("wantTextField").hidden = kind !== "request";
  $("w-text").value = prefill; $("wantError").textContent = "";
  wForm.hidden = false; $("wantDone").hidden = true;
  wd.showModal(); wd.scrollTop = 0;
  (kind === "request" ? $("w-text") : $("w-name")).focus();
}
wForm.addEventListener("submit", async ev => {
  ev.preventDefault();
  const name = $("w-name").value.trim(), phone = $("w-phone").value.trim(), text = $("w-text").value.trim(), err = $("wantError"), btn = $("wantBtn");
  err.textContent = "";
  if (wantCtx.kind === "request" && text.length < 3) { err.textContent = "Tell us which comic you're after."; $("w-text").focus(); return; }
  if (name.length < 3) { err.textContent = "Enter your full name."; $("w-name").focus(); return; }
  if (!/^[\d\s()+\-#]+$/.test(phone) || phone.replace(/\D/g, "").length < 4) { err.textContent = "Enter your phone number using digits only."; $("w-phone").focus(); return; }
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Sending…";
  try {
    const { ok, data } = await postJson(apiBase() + "/wants", { kind: wantCtx.kind, productId: wantCtx.id || undefined, text: wantCtx.kind === "request" ? text : undefined, name, phone });
    if (!ok) { err.textContent = data.error || "We couldn't send that just now. Try again in a moment."; return; }
    const c = WANT_COPY[wantCtx.kind](wantCtx.id ? byId[wantCtx.id] : null);
    $("wantDoneTitle").textContent = data.already ? "You're already on the list" : c.done;
    $("wantDoneMsg").textContent = data.already ? "We have your details for this already, so there's nothing more to do." : c.msg;
    wForm.hidden = true; $("wantDone").hidden = false; $("wantDoneTitle").focus();
    $("w-text").value = "";
  } catch (e) { err.textContent = "We couldn't reach the shop just now. Check your connection and try again."; }
  finally { btn.disabled = false; btn.textContent = label; }
});

/* ===================== sharing a cart ===================== */
// A cart link looks like  /?cart=batman-14:2,flash-3:1  (comic id : quantity). Opening one adds those comics to the visitor's own cart.
const cartLink = () => new URL(`${root}?cart=${Object.entries(cart).map(([id, n]) => `${id}:${n}`).join(",")}`, location.href).href;
function copyText(text, ok, fail) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast(ok), () => toast(fail));
  else toast(fail);
}
function loadSharedCart() {
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

/* ===================== tracking an order ===================== */
const trForm = $("trackForm"), trResult = $("trackResult");
let lastOrder = null; // the order just placed in this visit, so its tracking page can open without retyping
const TRACK_TEXT = {
  new: () => "We've got your order and we're getting it ready. We'll text you as soon as it is.",
  ready: o => o.method === "collect"
    ? `It's ready. Come to the counter${o.collectDate ? " on " + fmtDate(o.collectDate) : ""} between ${hLabel(CONFIG.openHour)} and ${hLabel(CONFIG.closeHour)} and give your order number.`
    : "It's packed and will be posted to you shortly.",
  done: o => (o.method === "collect" ? "Collected. Thanks for shopping with Flickers Comics." : "Posted. It's on its way to you."),
  cancelled: () => "This order was cancelled. If that's a surprise, get in touch with the shop."
};
function trackHTML(o) {
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
function openTrack(pre = {}, auto = false) {
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
function enableTracking() {
  if (!CONFIG.orderApi || CONFIG.testMode) return;
  document.querySelectorAll("[data-track]").forEach(b => { b.hidden = false; });
  const asked = takeParam("track"); // a link like /?track=FC-7K3PQ2 opens the form with the number filled in
  if (asked) openTrack({ id: asked.slice(0, 20) });
}

/* ===================== toast ===================== */
const toastEl = $("toast");
let toastTimer = 0;
function hideToast() { toastEl.hidden = true; toastEl.innerHTML = ""; }
function toast(msg, action) {
  toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ""}`;
  if (action) toastEl.querySelector(".toast-btn").addEventListener("click", () => { hideToast(); action.fn(); });
  toastEl.hidden = false;
  toastEl.classList.remove("show"); void toastEl.offsetWidth; toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4500);
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
function buyAction(action, st, rerender, inDialog) {
  const p = byId[st.id]; if (!p) return;
  const scope = inDialog ? qv : pageBuyEl;
  if (action === "inc") { st.qty = Math.min(buyMax(p), st.qty + 1); rerender(); focusFirst(scope, '[data-qv="inc"]:not(:disabled)', '[data-qv="dec"]'); }
  else if (action === "dec") { st.qty = Math.max(1, st.qty - 1); rerender(); focusFirst(scope, '[data-qv="dec"]:not(:disabled)', '[data-qv="inc"]'); }
  else if (action === "add") {
    const n = st.qty;
    if (addToCart(p.id, n)) { if (inDialog) qv.close(); st.qty = 1; bumpCart(); toast(`Added ${n > 1 ? n + " × " : ""}${fullTitle(p)}`, { label: "View cart", fn: openDrawer }); renderPageBuy(); }
  } else if (action === "cart") { if (inDialog) qv.close(); openDrawer(); }
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
co.addEventListener("close", () => { if (!$("coDoneView").hidden) resetCheckout(); });
$("cartBtn").addEventListener("click", openDrawer);
$("savedBtn").addEventListener("click", openSaved);
$("savedAddAll").addEventListener("click", addAllSaved);
savedDlg.addEventListener("close", () => { // once they have seen that a comic is back, stop flagging it
  let changed = false;
  for (const id of Object.keys(saved)) if (backInStock(id)) { saved[id].s = byId[id].stock; changed = true; }
  if (changed) { persistSaved(); syncSaved(); }
});
$("checkoutBtn").addEventListener("click", openCheckout);
form.addEventListener("submit", placeOrder);
form.querySelectorAll('input[name="method"]').forEach(r => r.addEventListener("change", syncMethod));
["name", "phone", "date", "address"].forEach(k => F[k].addEventListener("input", () => {
  if (F[k].getAttribute("aria-invalid") === "true") { F[k].removeAttribute("aria-invalid"); $("e-" + k).hidden = true; }
}));
if ($("q")) {
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
window.addEventListener("storage", ev => {
  if (ev.key === CART_KEY) { cart = sanitizeCart(store.get(CART_KEY, {})); renderCartUI(); }
  if (ev.key === SAVED_KEY) { saved = sanitizeSaved(store.get(SAVED_KEY, {})); syncSaved(); }
});

/* ===================== start ===================== */
if (grid) { readUrlState(); setGroup(filters.group); }
try {
  const data = await statusReady;
  CONFIG = data.config; CATEGORIES = data.categories; PRODUCTS = data.products;
  PRODUCTS.forEach(p => { p.stock = Math.max(0, Math.floor(Number(p.stock) || 0)); p.price = Math.max(0, Number(p.price) || 0); });
  byId = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
  cart = sanitizeCart(store.get(CART_KEY, {}));
  renderHours();
  setInterval(renderHours, 60000);
  saved = sanitizeSaved(store.get(SAVED_KEY, {}));
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
