/* Staff area: the Stock tab. Editing, bulk changes, cover pictures, publishing. */
import { esc, money, fullTitle, metaLine, slug, coverHTML } from "../shared.mjs";
import { $, clone, canon, X, S, api, say } from "./core.js";

const CATEGORIES = [
  { key: "issues", label: "Single Issues", one: "Single issue" },
  { key: "graphic", label: "Graphic Novels", one: "Graphic novel" },
  { key: "tpb", label: "Trade Paperbacks", one: "Trade paperback" },
  { key: "omnibus", label: "Omnibus", one: "Omnibus" },
  { key: "manga", label: "Manga", one: "Manga" },
  { key: "funko", label: "Funko Pops", one: "Funko Pop" }
];
const GRADE_OPTIONS = ["NM+ 9.6", "NM 9.4", "NM− 9.2", "VF 8.0", "FN 6.0", "VG 4.0", "GD 2.0"];
const FIELD_ORDER = ["id", "cat", "title", "num", "vol", "subtitle", "variant", "collects", "pages", "grade", "publisher", "price", "stock", "blurb", "tagline", "badges", "staff", "image", "added"];

/* ---------- product helpers ---------- */
function cleanProduct(p) {
  const out = {};
  FIELD_ORDER.forEach(k => {
    let v = p[k];
    if (v === undefined || v === null || v === "") return;
    if (k === "badges" && (!Array.isArray(v) || !v.length)) return;
    if (k === "pages") { v = Math.floor(Number(v)); if (!v) return; }
    out[k] = v;
  });
  return out;
}
export function changeList() {
  const orig = new Map(S.orig.map(p => [p.id, canon(cleanProduct(p))]));
  const edited = new Set(), added = new Set(), seen = new Set();
  S.draft.forEach(p => {
    seen.add(p.id);
    if (!orig.has(p.id)) added.add(p.id);
    else if (orig.get(p.id) !== canon(cleanProduct(p))) edited.add(p.id);
  });
  const removed = [...orig.keys()].filter(id => !seen.has(id));
  const weekChanged = canon(S.origFeat.slice(0, 3)) !== canon(S.draftFeat.slice(0, 3));
  return { edited, added, removed, weekChanged, count: edited.size + added.size + removed.length + (weekChanged ? 1 : 0) };
}
const uniqueId = base => { let id = base, n = 2; while (S.draft.some(p => p.id === id)) id = `${base}-${n++}`; return id; };
const label = p => fullTitle(p);
function thumb(p) {
  const url = p.image && S.previews[p.image];
  if (url) return `<span class="cover${p.stock <= 0 ? " is-sold" : ""}"><img src="${esc(url)}" alt=""></span>`;
  return coverHTML(p, { imgBase: "../" });
}

export async function loadStock() {
  const s = await api("/stock");
  S.version = s.version;
  S.orig = clone(s.products); S.draft = clone(s.products);
  S.origFeat = s.featured.slice(); S.draftFeat = s.featured.slice();
  S.selected = new Set();
}

/* ---------- stock tab ---------- */
export function renderStock() {
  $("panel").innerHTML = `
    <div class="admin-bar">
      <label class="search"><span class="sr-only">Search stock</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="aQ" placeholder="Search stock" autocomplete="off"></label>
      <button type="button" class="btn btn-small" id="aAdd">+ Add item</button>
      <button type="button" class="btn btn-small" id="aReceive">Receive shipment</button>
      <div class="admin-publish">
        <span class="admin-changes" id="aChanges">No unpublished changes</span>
        <button type="button" class="link-btn" id="aDiscard" hidden>Discard</button>
        <button type="button" class="link-btn" id="aRefresh">Refresh stock</button>
        <button type="button" class="btn btn-yellow btn-small" id="aPublish" disabled>Publish changes</button>
      </div>
    </div>
    <div class="admin-msg" id="aMsg" role="status"></div>
    <div class="bulk-bar" id="bulkBar" role="region" aria-label="Edit the selected comics" hidden>
      <b id="bulkCount">0 selected</b>
      <button type="button" class="btn btn-small" data-bulk="price">Set price</button>
      <button type="button" class="btn btn-small" data-bulk="adjust">Raise or lower price</button>
      <button type="button" class="btn btn-small" data-bulk="stock">Set stock</button>
      <button type="button" class="btn btn-small" data-bulk="labels">Set labels</button>
      <button type="button" class="btn btn-small btn-danger" data-bulk="delete">Delete</button>
      <button type="button" class="link-btn" data-bulk="clear">Clear selection</button>
    </div>
    <div class="list-head">
      <label class="check"><input type="checkbox" id="selAll"><span id="selAllLabel">Select all</span></label>
      <label class="list-pick">Show <select id="aFilter" class="admin-select">
        <option value="all">Everything</option><option value="low">Low stock (1 or 2 left)</option><option value="sold">Sold out</option><option value="nocover">No cover picture</option><option value="changed">Unpublished changes</option>
      </select></label>
      <label class="list-pick">Sort <select id="aSort" class="admin-select">
        <option value="shop">Shop order</option><option value="title">Title A to Z</option><option value="price-asc">Price, low to high</option><option value="price-desc">Price, high to low</option><option value="stock-asc">Stock, fewest first</option>
      </select></label>
      <span class="hint" id="aShowing" aria-live="polite"></span>
    </div>
    <p class="hint list-tip">Tips: drop a picture onto a comic to give it a cover. Tick one comic, then hold Shift and tick another to select everything between.</p>
    <div id="aList"></div>`;
  $("aQ").addEventListener("input", renderList);
  $("aFilter").addEventListener("change", renderList);
  $("aSort").addEventListener("change", renderList);
  $("selAll").addEventListener("change", () => {
    const vis = visibleList();
    if ($("selAll").checked) vis.forEach(p => S.selected.add(p.id)); else vis.forEach(p => S.selected.delete(p.id));
    updateSelection();
  });
  $("bulkBar").addEventListener("click", ev => { const b = ev.target.closest("[data-bulk]"); if (b) openBulk(b.dataset.bulk); });
  $("aList").addEventListener("change", ev => {
    const t = ev.target, id = t.dataset.price || t.dataset.stock;
    if (!id) return;
    const p = S.draft.find(x => x.id === id); if (!p) return;
    const n = Number(t.value);
    if (t.value === "" || !Number.isFinite(n) || n < 0 || (t.dataset.stock && !Number.isInteger(n))) {
      t.value = t.dataset.price ? p.price : p.stock;
      say(t.dataset.price ? "Prices must be 0 or more." : "Stock must be a whole number, 0 or more.", "error");
      return;
    }
    if (t.dataset.price) p.price = n; else p.stock = n;
    say(""); updateCounts(); refreshRow(id);
  });
  let anchorId = null; // last ticked comic, for Shift-click ranges
  $("aList").addEventListener("click", ev => {
    const cb = ev.target.closest("[data-sel]");
    if (cb) {
      const id = cb.dataset.sel, on = cb.checked;
      if (ev.shiftKey && anchorId && anchorId !== id) {
        const ids = visibleList().map(p => p.id), a = ids.indexOf(anchorId), z = ids.indexOf(id);
        if (a >= 0 && z >= 0) ids.slice(Math.min(a, z), Math.max(a, z) + 1).forEach(i => (on ? S.selected.add(i) : S.selected.delete(i)));
      } else if (on) S.selected.add(id); else S.selected.delete(id);
      anchorId = id;
      updateSelection();
      return;
    }
    const b = ev.target.closest("[data-edit]"); if (b) openEditor(b.dataset.edit);
  });
  $("aAdd").addEventListener("click", () => openEditor(null));
  $("aReceive").addEventListener("click", async () => {
    if (changeList().count === 0) { try { await loadStock(); renderList(); } catch (e) { /* use what's on screen */ } } // start from the latest numbers (orders may have used some)
    const { openReceive } = await import("./receive.js");
    openReceive({
      products: S.draft,
      onApply: ({ lines, markNew }) => {
        let comics = 0, copies = 0;
        for (const [id, qty] of lines) {
          const p = S.draft.find(x => x.id === id); if (!p) continue;
          p.stock += qty; comics++; copies += qty;
          if (markNew && !(p.badges || []).includes("new")) p.badges = [...(p.badges || []), "new"];
        }
        renderList();
        say(`Added ${copies} cop${copies === 1 ? "y" : "ies"} to ${comics} comic${comics === 1 ? "" : "s"}. Click “Publish changes” when you're ready for customers to see them.`, "ok");
      }
    });
  });
  $("aDiscard").addEventListener("click", () => say("Throw away all unpublished changes?", "error", [
    { label: "Discard changes", danger: true, fn: () => { S.draft = clone(S.orig); S.draftFeat = S.origFeat.slice(); S.selected.clear(); renderList(); say("Changes discarded.", "ok"); } },
    { label: "Keep them", fn: () => say("") }
  ]));
  $("aPublish").addEventListener("click", publish);
  $("aRefresh").addEventListener("click", async () => {
    try { await loadStock(); renderList(); say("Stock refreshed. Orders take comics off the shelf automatically.", "ok"); } catch (e) { say(e.message, "error"); }
  });
  initRowDrops($("aList"));
  renderList();
}
function updateCounts() {
  const c = changeList();
  if (!$("aChanges")) return c;
  $("aChanges").textContent = c.count ? `${c.count} unpublished change${c.count === 1 ? "" : "s"}` : "No unpublished changes";
  $("aChanges").classList.toggle("has", c.count > 0);
  $("aPublish").disabled = c.count === 0 || S.busy;
  $("aDiscard").hidden = c.count === 0;
  if ($("aRefresh")) $("aRefresh").hidden = c.count > 0; // refreshing would throw away unpublished edits
  return c;
}
function rowPills(p, c) {
  const pills = [];
  if (c.added.has(p.id)) pills.push(`<span class="pill pill-added">Added</span>`);
  else if (c.edited.has(p.id)) pills.push(`<span class="pill pill-edit">Edited</span>`);
  if (S.draftFeat.slice(0, 3).includes(p.id)) pills.push(`<span class="pill pill-week">New this week</span>`);
  for (const b of p.badges || []) pills.push(`<span class="pill">${b === "new" ? "New" : b === "variant" ? "Variant" : "Exclusive"}</span>`);
  if (p.stock <= 0) pills.push(`<span class="pill">Sold out</span>`);
  if (!p.image) pills.push(`<span class="pill pill-void">No cover</span>`);
  return pills.join("");
}
const STOCK_SORTS = {
  title: (a, b) => label(a).localeCompare(label(b), "en", { numeric: true, sensitivity: "base" }),
  "price-asc": (a, b) => a.price - b.price || label(a).localeCompare(label(b)),
  "price-desc": (a, b) => b.price - a.price || label(a).localeCompare(label(b)),
  "stock-asc": (a, b) => a.stock - b.stock || label(a).localeCompare(label(b))
};
function visibleList() {
  const q = ($("aQ").value || "").trim().toLowerCase(), filter = $("aFilter").value;
  const c = filter === "changed" ? changeList() : null;
  const list = S.draft.filter(p => {
    if (q && ![label(p), p.publisher].join(" ").toLowerCase().includes(q)) return false;
    if (filter === "low") return p.stock >= 1 && p.stock <= 2;
    if (filter === "sold") return p.stock <= 0;
    if (filter === "nocover") return !p.image;
    if (filter === "changed") return c.edited.has(p.id) || c.added.has(p.id);
    return true;
  });
  const sorter = STOCK_SORTS[$("aSort").value];
  return sorter ? list.sort(sorter) : list;
}
function renderList() {
  const c = updateCounts();
  const list = visibleList();
  $("aList").innerHTML = list.length ? list.map(p => {
    const t = label(p);
    return `<div class="arow${S.selected.has(p.id) ? " is-selected" : ""}" data-row="${esc(p.id)}">
      <input type="checkbox" class="arow-sel" data-sel="${esc(p.id)}" aria-label="Select ${esc(t)}"${S.selected.has(p.id) ? " checked" : ""}>
      <div class="arow-thumb">${thumb(p)}</div>
      <div class="arow-info"><p class="arow-title">${esc(t)}</p><p class="arow-meta"><span>${esc(metaLine(p, CATEGORIES))}</span><span class="arow-pills">${rowPills(p, c)}</span></p></div>
      <label class="arow-field arow-price">Price ($)<input type="number" min="0" step="1" inputmode="numeric" data-price="${esc(p.id)}" value="${esc(p.price)}" aria-label="Price of ${esc(t)}"></label>
      <label class="arow-field arow-stock">Stock<input type="number" min="0" step="1" inputmode="numeric" data-stock="${esc(p.id)}" value="${esc(p.stock)}" aria-label="Copies of ${esc(t)} in stock"></label>
      <button type="button" class="btn btn-small arow-edit" data-edit="${esc(p.id)}" aria-label="Edit ${esc(t)}">Edit</button>
    </div>`;
  }).join("") : `<p class="admin-empty">${S.draft.length ? "Nothing matches that search or filter." : "No stock yet. Click “+ Add item” to add the first one."}</p>`;
  const narrowed = list.length !== S.draft.length;
  $("aShowing").textContent = S.draft.length ? (narrowed ? `Showing ${list.length} of ${S.draft.length}` : `${S.draft.length} in stock list`) : "";
  updateSelection();
}

/* ---------- selecting several comics, and editing them together ---------- */
function updateSelection() {
  const have = new Set(S.draft.map(p => p.id));
  S.selected.forEach(id => { if (!have.has(id)) S.selected.delete(id); });
  const vis = visibleList(), ticked = vis.filter(p => S.selected.has(p.id)).length;
  const all = $("selAll");
  all.checked = vis.length > 0 && ticked === vis.length;
  all.indeterminate = ticked > 0 && ticked < vis.length;
  all.disabled = vis.length === 0;
  const narrowed = ($("aQ").value || "").trim() !== "" || $("aFilter").value !== "all";
  $("selAllLabel").textContent = narrowed ? `Select all ${vis.length} matching` : `Select all ${vis.length}`;
  const n = S.selected.size;
  $("bulkBar").hidden = n === 0;
  $("bulkCount").textContent = `${n} selected`;
  $("aList").querySelectorAll(".arow").forEach(row => {
    const on = S.selected.has(row.dataset.row);
    row.classList.toggle("is-selected", on);
    row.querySelector("[data-sel]").checked = on;
  });
}
const selectedItems = () => S.draft.filter(p => S.selected.has(p.id));
const plural = n => `${n} comic${n === 1 ? "" : "s"}`;
const roundPrice = n => Math.max(0, Math.round(n));

function openBulk(mode) {
  if (mode === "clear") { S.selected.clear(); updateSelection(); return; }
  const items = selectedItems(), n = items.length;
  if (!n) return;
  const dlg = $("bulkDlg");
  const head = title => `<div class="co-head"><h2 class="dialog-title" id="bulkTitle">${title}</h2><button type="button" class="icon-btn on-dark" data-close aria-label="Close">${X}</button></div>`;
  const foot = (label, danger) => `<p class="form-error" id="bulkError" role="alert"></p><button type="submit" class="btn ${danger ? "btn-danger" : "btn-yellow"} btn-small">${label}</button>`;
  let html, apply;

  if (mode === "price") {
    html = `${head("Set price")}<div class="adm-card-body"><p>Give all <b>${plural(n)}</b> the same price.</p>
      <div class="field"><label for="b-price">New price ($)</label><input id="b-price" type="number" min="0" step="1" inputmode="numeric"></div>${foot("Set price")}</div>`;
    apply = () => {
      const v = Number($("b-price").value);
      if ($("b-price").value === "" || !Number.isFinite(v) || v < 0 || v > 10000000) return { error: "Enter a price of 0 or more." };
      items.forEach(p => { p.price = roundPrice(v); });
      return { done: `Set the price of ${plural(n)} to ${money(roundPrice(v))}.` };
    };
  } else if (mode === "adjust") {
    html = `${head("Raise or lower price")}<div class="adm-card-body"><p>Change the price of <b>${plural(n)}</b>. Results are rounded to whole dollars.</p>
      <div class="two"><div class="field"><label for="b-dir">Change</label><select id="b-dir"><option value="up">Raise by</option><option value="down">Lower by</option></select></div>
      <div class="field"><label for="b-amt">Amount</label><input id="b-amt" type="number" min="0" step="any" inputmode="decimal"></div></div>
      <div class="field"><label for="b-unit">In</label><select id="b-unit"><option value="pct">Percent (%)</option><option value="usd">Dollars ($)</option></select></div>
      <p class="hint" id="b-preview" aria-live="polite"></p>${foot("Change prices")}</div>`;
    const next = p => {
      const a = Number($("b-amt").value) || 0, sign = $("b-dir").value === "up" ? 1 : -1;
      return roundPrice($("b-unit").value === "pct" ? p.price * (1 + sign * a / 100) : p.price + sign * a);
    };
    const preview = () => {
      const p = items[0], a = $("b-amt").value;
      $("b-preview").textContent = a === "" ? "" : `For example, ${label(p)}: ${money(p.price)} → ${money(next(p))}`;
    };
    apply = () => {
      const a = Number($("b-amt").value);
      if ($("b-amt").value === "" || !Number.isFinite(a) || a < 0) return { error: "Enter an amount of 0 or more." };
      if ($("b-unit").value === "pct" && $("b-dir").value === "down" && a > 100) return { error: "You can't lower prices by more than 100%." };
      items.forEach(p => { p.price = next(p); });
      return { done: `${$("b-dir").value === "up" ? "Raised" : "Lowered"} the price of ${plural(n)} by ${$("b-unit").value === "pct" ? a + "%" : money(a)}.` };
    };
    dlg.oninput = preview;
  } else if (mode === "stock") {
    html = `${head("Set stock")}<div class="adm-card-body"><p>Set the copies in stock for all <b>${plural(n)}</b>. Use 0 to mark them sold out.</p>
      <div class="field"><label for="b-stock">Copies in stock</label><input id="b-stock" type="number" min="0" step="1" inputmode="numeric"></div>${foot("Set stock")}</div>`;
    apply = () => {
      const v = Number($("b-stock").value);
      if ($("b-stock").value === "" || !Number.isInteger(v) || v < 0 || v > 100000) return { error: "Enter a whole number of copies, 0 or more." };
      items.forEach(p => { p.stock = v; });
      return { done: `Set stock to ${v} for ${plural(n)}.` };
    };
  } else if (mode === "labels") {
    const LABELS = [["new", "New"], ["variant", "Variant"], ["exclusive", "Exclusive"], ["week", "Show in “New this week”"]];
    const row = ([k, name]) => `<div class="field"><label for="b-l-${k}">${name}</label><select id="b-l-${k}"><option value="">Leave as it is</option><option value="add">Add to all ${n}</option><option value="remove">Remove from all ${n}</option></select></div>`;
    html = `${head("Set labels")}<div class="adm-card-body"><p>Change the labels on <b>${plural(n)}</b>. Anything left as it is stays untouched.</p>
      <div class="two">${LABELS.slice(0, 3).map(row).join("")}</div>${row(LABELS[3])}
      <p class="hint">Only three comics show in “New this week”. Adding more puts these first, and the first three of them show.</p>${foot("Apply labels")}</div>`;
    apply = () => {
      const pick = k => $("b-l-" + k).value;
      if (!LABELS.some(([k]) => pick(k))) return { error: "Choose something to add or remove." };
      const done = [];
      for (const [k, name] of LABELS.slice(0, 3)) {
        const v = pick(k); if (!v) continue;
        items.forEach(p => { const has = (p.badges || []).filter(b => b !== k); p.badges = v === "add" ? [...has, k] : has; if (!p.badges.length) delete p.badges; });
        done.push(`${v === "add" ? "added" : "removed"} “${name}”`);
      }
      const w = pick("week");
      if (w === "add") { const ids = items.map(p => p.id), set = new Set(ids); S.draftFeat = [...ids, ...S.draftFeat.filter(id => !set.has(id))]; done.push(n > 3 ? "added them to “New this week” (only the first three show)" : "added them to “New this week”"); }
      if (w === "remove") { const set = new Set(items.map(p => p.id)); S.draftFeat = S.draftFeat.filter(id => !set.has(id)); done.push("removed them from “New this week”"); }
      return { done: `For ${plural(n)}: ${done.join(", ")}.` };
    };
  } else if (mode === "delete") {
    const names = items.slice(0, 5).map(p => `<li>${esc(label(p))}</li>`).join("");
    html = `${head(`Delete ${plural(n)}?`)}<div class="adm-card-body"><p>These will leave the shop when you publish. You can still discard the change before then.</p>
      <ul class="bulk-names">${names}${n > 5 ? `<li>…and ${n - 5} more</li>` : ""}</ul>${foot(`Delete ${plural(n)}`, true)}</div>`;
    apply = () => {
      const gone = new Set(S.selected);
      S.draft = S.draft.filter(p => !gone.has(p.id));
      S.draftFeat = S.draftFeat.filter(id => !gone.has(id));
      S.selected.clear();
      return { done: `Deleted ${plural(n)}. They leave the shop when you publish.` };
    };
  } else return;

  dlg.innerHTML = `<form id="bulkForm" novalidate>${html}</form>`;
  if (mode !== "adjust") dlg.oninput = null;
  dlg.onclick = ev => { if (ev.target === dlg || ev.target.closest("[data-close]")) dlg.close(); };
  $("bulkForm").addEventListener("submit", ev => {
    ev.preventDefault();
    const result = apply();
    if (result.error) { $("bulkError").textContent = result.error; return; }
    dlg.close();
    renderList();
    say(`${result.done} Click “Publish changes” when you're ready for customers to see it.`, "ok");
  });
  dlg.showModal();
  const first = dlg.querySelector("input, select");
  if (first) first.focus(); else dlg.querySelector('button[type="submit"]').focus();
}
function refreshRow(id) {
  const row = $("aList").querySelector(`[data-row="${CSS.escape(id)}"]`);
  const p = S.draft.find(x => x.id === id);
  if (!row || !p) return;
  row.querySelector(".arow-pills").innerHTML = rowPills(p, changeList());
  row.querySelector(".arow-thumb").innerHTML = thumb(p);
}

/* ---------- item editor ---------- */
const ED = { id: null, isNew: false, image: "", newUpload: null };
const F = n => $("ed-" + n);
function editorHTML() {
  return `<form id="edForm" novalidate>
    <div class="co-head"><h2 class="dialog-title" id="edTitle">Edit item</h2><button type="button" class="icon-btn on-dark" data-close aria-label="Close without saving">${X}</button></div>
    <div class="ed-grid">
      <div class="ed-cover">
        <div class="ed-drop" id="edDrop"><div class="ed-preview" id="edPreview"></div><p class="ed-drop-tip" aria-hidden="true">Drop an image here</p></div>
        <div class="ed-cover-btns">
          <label class="btn btn-small file-btn">Choose a file<input type="file" accept="image/*" id="edFile" class="sr-only"></label>
          <button type="button" class="btn btn-small" id="edPaste">Paste image</button>
        </div>
        <button type="button" class="link-btn" id="edRemoveImg" hidden>Remove the photo</button>
        <p class="ed-cover-msg" id="edCoverMsg" role="status"></p>
        <p class="hint">Drag a picture onto the cover, or copy one (right-click, Copy image) and press <kbd>Ctrl</kbd> + <kbd>V</kbd>. Photos are resized to 600px wide before they're saved. Without a photo, the shop shows a plain cover with the title.</p>
      </div>
      <div class="ed-fields">
        <div class="two">
          <div class="field"><label for="ed-cat">Category</label><select id="ed-cat">${CATEGORIES.map(c => `<option value="${esc(c.key)}">${esc(c.label)}</option>`).join("")}</select></div>
          <div class="field"><label for="ed-publisher">Publisher</label><input id="ed-publisher" autocomplete="off"></div>
        </div>
        <div class="field"><label for="ed-title">Title</label><input id="ed-title" autocomplete="off" placeholder="e.g. Captain Senora"><p class="error" id="e-ed-title" hidden></p></div>
        <div class="three">
          <div class="field" data-for="issues funko"><label for="ed-num" id="ed-num-label">Issue number</label><input id="ed-num" autocomplete="off" placeholder="#1"></div>
          <div class="field" data-for="tpb manga"><label for="ed-vol">Volume</label><input id="ed-vol" autocomplete="off" placeholder="Vol. 1"></div>
          <div class="field" data-for="issues"><label for="ed-grade">Condition</label><input id="ed-grade" list="ed-grades" autocomplete="off" placeholder="NM 9.4"><datalist id="ed-grades">${GRADE_OPTIONS.map(g => `<option value="${g}"></option>`).join("")}</datalist></div>
          <div class="field" data-for="graphic tpb omnibus"><label for="ed-pages">Pages</label><input id="ed-pages" type="number" min="0" step="1" inputmode="numeric"></div>
        </div>
        <div class="two">
          <div class="field" data-for="tpb omnibus"><label for="ed-subtitle">Subtitle</label><input id="ed-subtitle" autocomplete="off" placeholder="e.g. Omnibus Vol. 1"></div>
          <div class="field" data-for="tpb omnibus"><label for="ed-collects">Collects</label><textarea id="ed-collects" rows="3" maxlength="2000" autocomplete="off" placeholder="Collects #1–6"></textarea></div>
          <div class="field" data-for="issues funko"><label for="ed-variant" id="ed-variant-label">Variant</label><input id="ed-variant" autocomplete="off" placeholder="e.g. Variant cover"></div>
        </div>
        <div class="two">
          <div class="field"><label for="ed-price">Price ($)</label><input id="ed-price" type="number" min="0" step="1" inputmode="numeric"><p class="error" id="e-ed-price" hidden></p></div>
          <div class="field"><label for="ed-stock">Copies in stock</label><input id="ed-stock" type="number" min="0" step="1" inputmode="numeric"><p class="error" id="e-ed-stock" hidden></p></div>
        </div>
        <div class="field"><label for="ed-blurb">Description</label><textarea id="ed-blurb" rows="3" placeholder="One or two sentences shown on the comic's page"></textarea></div>
        <div class="field"><label for="ed-staff">Staff pick note <span class="opt">(optional)</span></label><input id="ed-staff" autocomplete="off" placeholder="Leave empty if it isn't a staff pick"></div>
        <p class="group-label">Labels</p>
        <div class="checks">
          <label class="check"><input type="checkbox" id="ed-b-new"> New</label>
          <label class="check"><input type="checkbox" id="ed-b-variant"> Variant</label>
          <label class="check"><input type="checkbox" id="ed-b-exclusive"> Exclusive</label>
          <label class="check"><input type="checkbox" id="ed-week"> Show in “New this week”</label>
        </div>
        <p class="hint">The first three items marked for “New this week” appear at the top of the shop.</p>
      </div>
    </div>
    <div class="co-foot ed-foot">
      <div id="edDeleteWrap"></div>
      <p class="form-error" id="edError" role="alert"></p>
      <div class="ed-actions"><button type="button" class="btn btn-small" data-close>Cancel</button><button type="submit" class="btn btn-yellow btn-small">Save item</button></div>
    </div>
  </form>`;
}
function fieldVisibility() {
  const cat = F("cat").value;
  $("editDlg").querySelectorAll("[data-for]").forEach(el => { el.hidden = !el.dataset.for.split(" ").includes(cat); });
  $("ed-num-label").textContent = cat === "funko" ? "Figure number" : "Issue number";
  F("num").placeholder = cat === "funko" ? "No. 01" : "#1";
  $("ed-variant-label").textContent = cat === "funko" ? "Finish" : "Variant";
}
function formProduct() {
  const vis = k => !F(k).closest("[data-for]") || !F(k).closest("[data-for]").hidden;
  const val = k => (vis(k) ? F(k).value.trim() : "");
  const base = ED.isNew ? {} : clone(S.draft.find(p => p.id === ED.id) || {});
  return Object.assign(base, {
    id: ED.id || "preview-item", cat: F("cat").value, title: F("title").value.trim(),
    num: val("num"), vol: val("vol"), subtitle: val("subtitle"), variant: val("variant"), collects: val("collects"),
    pages: val("pages") ? Number(val("pages")) : "", grade: val("grade"), publisher: F("publisher").value.trim(),
    price: F("price").value === "" ? NaN : Number(F("price").value), stock: F("stock").value === "" ? NaN : Number(F("stock").value),
    blurb: F("blurb").value.trim(), badges: ["new", "variant", "exclusive"].filter(b => $("ed-b-" + b).checked), staff: F("staff").value.trim(),
    image: ED.image || ""
  });
}
function updatePreview() {
  const p = formProduct();
  const shown = Object.assign({}, p, { title: p.title || "Untitled", stock: Number.isFinite(p.stock) ? p.stock : 1 });
  $("edPreview").innerHTML = thumb(shown);
  $("edRemoveImg").hidden = !ED.image;
}
function openEditor(id) {
  const dlg = $("editDlg");
  dlg.innerHTML = editorHTML();
  const p = id ? S.draft.find(x => x.id === id) : null;
  ED.id = p ? p.id : null; ED.isNew = !p; ED.image = p && p.image ? p.image : ""; ED.newUpload = null;
  $("edTitle").textContent = p ? "Edit item" : "Add item";
  F("cat").value = p ? p.cat : "issues";
  ["publisher", "title", "num", "vol", "grade", "pages", "subtitle", "collects", "variant", "blurb", "staff"].forEach(k => { F(k).value = p && p[k] != null ? p[k] : ""; });
  F("price").value = p ? p.price : "";
  F("stock").value = p ? p.stock : 1;
  ["new", "variant", "exclusive"].forEach(b => { $("ed-b-" + b).checked = !!(p && (p.badges || []).includes(b)); });
  F("week").checked = !!(p && S.draftFeat.includes(p.id));
  $("edDeleteWrap").hidden = !p;
  resetDelete();
  fieldVisibility();
  updatePreview();

  F("cat").addEventListener("change", () => { fieldVisibility(); updatePreview(); });
  $("edRemoveImg").addEventListener("click", () => { ED.image = ""; ED.newUpload = null; $("edFile").value = ""; coverNote(""); updatePreview(); });
  $("edFile").addEventListener("change", () => { const f = $("edFile").files[0]; if (f) setEditorCover(f); });
  $("edPaste").addEventListener("click", pasteFromClipboard);
  $("edForm").addEventListener("submit", saveItem);
  dlg.showModal();
  F("title").focus();
}

/* ---------- cover images: drag and drop, paste, or choose a file ---------- */
const hasFiles = dt => !!dt && [...(dt.types || [])].includes("Files");
const looksDraggable = ev => hasFiles(ev.dataTransfer) || (!ev.target.closest("input,textarea") && [...(ev.dataTransfer?.types || [])].includes("text/uri-list"));
const imageIn = dt => {
  if (!dt) return null;
  const f = [...(dt.files || [])].find(x => /^image\//.test(x.type));
  if (f) return f;
  const it = [...(dt.items || [])].find(x => x.kind === "file" && /^image\//.test(x.type));
  return it ? it.getAsFile() : null;
};
const FROM_SITE = "That picture came from another website, which the browser won't pass on. Right-click it, choose Copy image, then press Ctrl+V here.";
let coverSeq = 0;
async function makeCover(file, title) {
  const url = await shrinkImage(file);
  return { path: `assets/covers/${slug(title || "cover")}-${Date.now().toString(36)}${(++coverSeq).toString(36)}.jpg`, b64: url.split(",")[1], url };
}
function coverNote(text, bad) { const el = $("edCoverMsg"); if (el) { el.textContent = text; el.classList.toggle("is-bad", !!bad); } }
async function setEditorCover(file) {
  $("edError").textContent = ""; coverNote("Resizing…");
  try {
    const c = await makeCover(file, F("title").value);
    ED.image = c.path; ED.newUpload = c; S.previews[c.path] = c.url;
    updatePreview(); coverNote(`Cover added (${Math.round(c.b64.length * 0.75 / 1024)} KB). Save the item to keep it.`);
  } catch (e) { coverNote(e.message, true); }
}
async function setRowCover(id, file) {
  const p = S.draft.find(x => x.id === id); if (!p) return;
  try {
    const c = await makeCover(file, p.title);
    S.uploads[c.path] = c.b64; S.previews[c.path] = c.url; p.image = c.path;
    updateCounts(); refreshRow(id);
    say(`New cover for ${label(p)}. Click “Publish changes” when you're ready for customers to see it.`, "ok");
  } catch (e) { say(e.message, "error"); }
}
async function pasteFromClipboard() {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find(t => /^image\//.test(t));
      if (type) { await setEditorCover(new File([await item.getType(type)], "pasted", { type })); return; }
    }
    coverNote("There's no image on the clipboard. Right-click a picture and choose Copy image first.", true);
  } catch (e) { coverNote("Your browser needs you to press Ctrl+V instead.", true); }
}
export function initCoverDrops() {
  const over = (el, on) => el && el.classList.toggle("is-over", on);
  const edit = $("editDlg");
  edit.addEventListener("dragover", ev => { if (!looksDraggable(ev)) return; ev.preventDefault(); over($("edDrop"), true); });
  edit.addEventListener("dragleave", ev => { if (!edit.contains(ev.relatedTarget)) over($("edDrop"), false); });
  edit.addEventListener("drop", ev => {
    if (!looksDraggable(ev)) return;
    ev.preventDefault(); over($("edDrop"), false);
    const f = imageIn(ev.dataTransfer);
    if (f) setEditorCover(f); else coverNote(hasFiles(ev.dataTransfer) ? "That file isn't an image. Use a JPG, PNG or WebP." : FROM_SITE, true);
  });
  edit.addEventListener("click", ev => { if (ev.target.closest("[data-close]")) edit.close(); });
  edit.addEventListener("input", ev => { if (ev.target.id !== "edFile") updatePreview(); });
}
function initRowDrops(list) {
  const over = (el, on) => el.classList.toggle("is-over", on);
  const rowOf = ev => ev.target.closest(".arow");
  list.addEventListener("dragover", ev => { const r = rowOf(ev); if (!r || !looksDraggable(ev)) return; ev.preventDefault(); over(r, true); });
  list.addEventListener("dragleave", ev => { const r = rowOf(ev); if (r && !r.contains(ev.relatedTarget)) over(r, false); });
  list.addEventListener("drop", ev => {
    const r = rowOf(ev); if (!r) return;
    ev.preventDefault(); over(r, false);
    const f = imageIn(ev.dataTransfer);
    if (f) setRowCover(r.dataset.row, f); else say(hasFiles(ev.dataTransfer) ? "That file isn't an image. Use a JPG, PNG or WebP." : FROM_SITE, "error");
  });
}
/* Ctrl+V with an image on the clipboard, while the editor is open, sets the cover; pasting text still works normally. */
document.addEventListener("paste", ev => {
  const dlg = $("editDlg"); if (!dlg || !dlg.open) return;
  const f = imageIn(ev.clipboardData);
  if (f) { ev.preventDefault(); setEditorCover(f); }
});
/* A file dropped anywhere else shouldn't make the browser open it and leave the staff area. */
["dragover", "drop"].forEach(t => window.addEventListener(t, ev => { if (hasFiles(ev.dataTransfer)) ev.preventDefault(); }));
function resetDelete() {
  const wrap = $("edDeleteWrap"); if (!wrap) return;
  wrap.innerHTML = `<button type="button" class="link-btn danger-link" id="edDelete">Delete item</button>`;
  $("edDelete").addEventListener("click", () => {
    const p = S.draft.find(x => x.id === ED.id);
    wrap.innerHTML = `<span class="inline-confirm">Delete ${esc(p ? label(p) : "this item")}?<button type="button" class="btn btn-small btn-danger" id="edDeleteYes">Delete</button><button type="button" class="btn btn-small" id="edDeleteNo">Keep</button></span>`;
    $("edDeleteYes").addEventListener("click", () => {
      S.draft = S.draft.filter(x => x.id !== ED.id);
      S.draftFeat = S.draftFeat.filter(x => x !== ED.id);
      $("editDlg").close();
      renderList();
      say(`Deleted ${p ? label(p) : "the item"}. It leaves the shop when you publish.`, "ok");
    });
    $("edDeleteNo").addEventListener("click", () => { resetDelete(); $("edDelete").focus(); });
    $("edDeleteNo").focus();
  });
}
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new Error("That file isn't an image. Choose a JPG, PNG or WebP photo.")); return; }
    if (file.size > 20 * 1024 * 1024) { reject(new Error("That photo is over 20 MB. Choose a smaller one.")); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 600 / img.naturalWidth, 900 / img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let q = 0.85, out = c.toDataURL("image/jpeg", q);
      while (out.length > 340000 && q > 0.45) out = c.toDataURL("image/jpeg", q -= 0.1); // very detailed art: trade a little quality to stay under the upload limit
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That photo couldn't be opened. Try a JPG or PNG.")); };
    img.src = url;
  });
}
function saveItem(ev) {
  ev.preventDefault();
  const p = formProduct(), errs = {};
  if (!p.title) errs.title = "Give the item a title.";
  if (!Number.isFinite(p.price) || p.price < 0) errs.price = "Enter a price of 0 or more.";
  if (!Number.isInteger(p.stock) || p.stock < 0) errs.stock = "Enter a whole number of copies, 0 or more.";
  ["title", "price", "stock"].forEach(k => {
    const e = $("e-ed-" + k);
    if (errs[k]) { e.textContent = errs[k]; e.hidden = false; F(k).setAttribute("aria-invalid", "true"); }
    else { e.hidden = true; F(k).removeAttribute("aria-invalid"); }
  });
  const first = ["title", "price", "stock"].find(k => errs[k]);
  if (first) { F(first).focus(); return; }
  if (ED.newUpload) S.uploads[ED.newUpload.path] = ED.newUpload.b64;
  if (ED.isNew) {
    p.id = uniqueId(slug([p.title, p.num || p.vol].filter(Boolean).join(" ")));
    S.draft.unshift(p);
  } else {
    S.draft[S.draft.findIndex(x => x.id === ED.id)] = p;
  }
  const inWeek = S.draftFeat.includes(p.id);
  if (F("week").checked && !inWeek) S.draftFeat.push(p.id);
  if (!F("week").checked && inWeek) S.draftFeat = S.draftFeat.filter(x => x !== p.id);
  $("editDlg").close();
  renderList();
  const extra = F("week").checked && S.draftFeat.indexOf(p.id) > 2 ? " Three other items are already in “New this week”, so untick one of those for it to show." : "";
  say(`${ED.isNew ? "Added" : "Saved"} ${label(p)}. Click “Publish changes” when you're ready for customers to see it.${extra}`, "ok");
  const row = $("aList").querySelector(`[data-row="${CSS.escape(p.id)}"] [data-edit]`);
  if (row) row.focus();
}

/* ---------- publish ---------- */
async function publish() {
  if (S.busy) return;
  const changes = changeList();
  if (!changes.count) return;
  S.busy = true; updateCounts();
  const btn = $("aPublish"); btn.textContent = "Publishing…";
  say("Saving…");
  try {
    const products = clone(S.draft).map(cleanProduct);
    const used = new Set(products.map(p => p.image).filter(Boolean));
    const uploads = {};
    Object.keys(S.uploads).forEach(path => { if (used.has(path)) uploads[path] = S.uploads[path]; });
    const r = await api("/publish", { method: "POST", body: { version: S.version, base: S.orig.map(cleanProduct), products, featured: S.draftFeat.slice(0, 3), uploads } });
    S.version = r.version;
    if (r.merged) { S.draft = clone(r.products); S.orig = clone(r.products); } // orders took stock off the shelf since this was loaded
    else S.orig = clone(S.draft);
    S.origFeat = S.draftFeat.slice(); S.uploads = {};
    S.busy = false;
    if ($("aList")) renderList();
    say(r.merged ? "Published. New orders had changed some stock since you loaded it, so those numbers are updated on screen. The shop updates in a minute or two." : "Published. The shop updates in a minute or two, once the site has rebuilt.", "ok");
  } catch (e) {
    S.busy = false; updateCounts();
    const actions = e.status === 409 ? [{ label: "Reload stock", danger: true, fn: async () => { try { await loadStock(); renderList(); say("Stock reloaded.", "ok"); } catch (err) { say(err.message, "error"); } } }] : [];
    say(e.message, "error", actions);
  }
  if ($("aPublish")) $("aPublish").textContent = "Publish changes";
}
