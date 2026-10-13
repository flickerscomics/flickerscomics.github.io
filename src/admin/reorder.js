/* Staff area: the Reorder tab. What's sold out or nearly gone, who is waiting for it, what has been selling, and what customers have asked
   for that the shop doesn't stock, with a suggested number to buy. Download the list as a spreadsheet for the supplier, or add what has arrived back into the stock. */
import { esc, fullTitle, reorderRows, REORDER_LOW } from "../shared.mjs";
import { $, api, say, csvCell, download } from "./core.js";

const LOW = REORDER_LOW;

export async function renderReorder() {
  $("panel").innerHTML = `<div class="admin-msg" id="aMsg" role="status"></div><p class="hint">Loading…</p>`;
  let stock, data;
  try { [stock, data] = await Promise.all([api("/stock"), api("/reorder")]); } catch (e) { say(e.message, "error"); return; }
  const rows = reorderRows(stock.products, data), qty = new Map(rows.map(r => [r.p.id, r.suggested])), skip = new Set(rows.filter(r => !r.suggested).map(r => r.p.id));

  const picked = () => rows.filter(r => !skip.has(r.p.id) && qty.get(r.p.id) > 0);
  const summary = () => { const n = picked(), copies = n.reduce((a, r) => a + qty.get(r.p.id), 0); return n.length ? `${copies} cop${copies === 1 ? "y" : "ies"} across ${n.length} comic${n.length === 1 ? "" : "s"} on the list.` : "Nothing is ticked yet. Type a number beside a comic to add it to the list."; };
  const requests = data.requests.length ? `<h2 class="want-h">Customers asked for these <span class="pill">${data.requests.length}</span></h2>
    <ul class="wants">${data.requests.map(q => `<li class="want"><div class="want-main"><p class="want-target"><b>${esc(q.text)}</b></p><p class="want-line">${q.people} ${q.people === 1 ? "person" : "people"} asked. They're not on the shelves, so they're not in the list above.</p></div></li>`).join("")}</ul>` : "";

  $("panel").innerHTML = `<div class="admin-msg" id="aMsg" role="status"></div>
    <div class="orders-top"><p class="hint">Comics that are sold out, down to their last ${LOW}, or wanted by more people than you have copies. “Suggested” covers the people waiting plus about two weeks of sales (from the last ${data.weeks} weeks), less what's on the shelf. Change a number or untick a row, then add what has arrived to the stock, or download the list for your supplier.</p></div>
    ${rows.length ? `<div class="reorder-bar"><button type="button" class="btn btn-yellow btn-small" id="rAdd">Add to stock</button><button type="button" class="btn btn-small" id="rCsv">Download as spreadsheet (CSV)</button><span class="hint" id="rSum" aria-live="polite">${summary()}</span></div>
    <table class="sales-table reorder-table"><caption class="sr-only">Comics to reorder</caption>
      <thead><tr><th scope="col"><span class="sr-only">Include</span></th><th scope="col">Comic</th><th scope="col">On shelf</th><th scope="col">Waiting</th><th scope="col">Sold (${data.weeks} wks)</th><th scope="col">Order</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td><input type="checkbox" data-pick="${esc(r.p.id)}" aria-label="Include ${esc(fullTitle(r.p))}"${skip.has(r.p.id) ? "" : " checked"}></td>
        <th scope="row">${esc(fullTitle(r.p))}${r.p.publisher ? `<br><span class="hint">${esc(r.p.publisher)}</span>` : ""}</th>
        <td data-label="On shelf">${r.stock <= 0 ? '<span class="pill">Sold out</span>' : r.stock}</td><td data-label="Waiting">${r.waiting || "–"}</td><td data-label="Sold (${data.weeks} wks)">${r.sold || "–"}</td>
        <td data-label="Order"><input class="reorder-qty" type="number" min="0" max="999" step="1" inputmode="numeric" value="${r.suggested}" data-qty="${esc(r.p.id)}" aria-label="Copies of ${esc(fullTitle(r.p))} to order"></td></tr>`).join("")}</tbody></table>`
    : `<p class="admin-empty">Nothing needs reordering right now. Everything has more than ${LOW} copies and nobody is waiting.</p>`}
    ${requests}`;
  if (!rows.length) return;

  $("panel").addEventListener("change", ev => {
    const q = ev.target.dataset && ev.target.dataset.qty, p = ev.target.dataset && ev.target.dataset.pick;
    if (q) { const n = Math.max(0, Math.min(999, Math.floor(Number(ev.target.value)) || 0)); qty.set(q, n); ev.target.value = n; const box = $("panel").querySelector(`[data-pick="${CSS.escape(q)}"]`); if (n === 0) skip.add(q); else skip.delete(q); box.checked = n > 0; } // a number above 0 ticks the row, 0 unticks it
    if (p) { if (ev.target.checked) skip.delete(p); else skip.add(p); }
    $("rSum").textContent = summary();
  });
  $("rAdd").addEventListener("click", () => {
    const list = picked();
    if (!list.length) { say("Tick at least one comic first.", "error"); return; }
    const copies = list.reduce((a, r) => a + qty.get(r.p.id), 0), what = `${copies} cop${copies === 1 ? "y" : "ies"} of ${list.length} comic${list.length === 1 ? "" : "s"}`;
    say(`Add ${what} to the stock? They go on the shelf straight away, and anyone waiting for a comic that's back is flagged in Discord.`, "error", [
      { label: `Add ${copies} to stock`, fn: async () => {
        $("rAdd").disabled = true;
        try {
          const r = await api("/stock/add", { method: "POST", body: { items: list.map(r => ({ id: r.p.id, qty: qty.get(r.p.id) })) } });
          await renderReorder(); // the shelf has changed, so the list is worked out again
          say(`Added ${r.added} cop${r.added === 1 ? "y" : "ies"} to the stock. They're on the shelf now.`, "ok");
        } catch (e) { $("rAdd").disabled = false; say(e.message, "error"); }
      } },
      { label: "Not yet", fn: () => say("") }
    ]);
  });
  $("rCsv").addEventListener("click", () => {
    const list = picked();
    if (!list.length) { say("Tick at least one comic first.", "error"); return; }
    const head = ["Comic", "Publisher", "Order", "On shelf", "People waiting", `Sold (${data.weeks} weeks)`];
    const text = "﻿" + [head, ...list.map(r => [fullTitle(r.p), r.p.publisher || "", qty.get(r.p.id), r.stock, r.waiting, r.sold])].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    download(`flickers-reorder-${new Date().toISOString().slice(0, 10)}.csv`, text, "text/csv;charset=utf-8");
  });
}
