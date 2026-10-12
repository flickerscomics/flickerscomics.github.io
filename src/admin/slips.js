/* Staff area: printable pick slips. One page per order, listing what to gather, who it's for and how it goes out. */
import { esc, escLines, money, hoursText } from "../shared.mjs";

const day = iso => {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return y ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))) : "";
};

function slipHTML(o, cfg) {
  const rows = o.items.map(i => `<tr><td class="slip-box" aria-hidden="true">☐</td><td class="slip-qty">${i.qty} ×</td><td>${esc(i.title)}</td><td class="slip-price">${money(i.price * i.qty)}</td></tr>`).join("");
  const how = o.method === "post" ? `<b>POST</b> to:<br>${escLines(o.address)}` : `<b>COLLECT</b> ${esc(day(o.collectDate))}${cfg && cfg.openHour != null ? ` · open ${esc(hoursText(cfg))}` : ""}`;
  return `<article class="slip">
    <header class="slip-head"><span class="slip-id">${esc(o.id)}</span><span class="slip-status">${esc(o.paid ? "PAID" : o.payment && o.payment.state === "awaiting" ? "AWAITING PAYMENT" : "NOT PAID")}</span></header>
    <p class="slip-who"><b>${esc(o.name)}</b>${o.phone ? ` · ${esc(o.phone)}` : ""}</p>
    <p class="slip-how">${how}</p>
    <table class="slip-items"><tbody>${rows}</tbody></table>
    <dl class="slip-sums">
      <dt>Subtotal</dt><dd>${money(o.subtotal)}</dd>
      ${o.discount ? `<dt>${esc(o.deal || "Deal")}</dt><dd>−${money(o.discount)}</dd>` : ""}
      ${o.postage ? `<dt>Postage</dt><dd>${money(o.postage)}</dd>` : ""}
      <dt><b>Total</b></dt><dd><b>${money(o.total)}</b></dd>
    </dl>
    ${o.notes ? `<p class="slip-notes"><b>Notes:</b> ${escLines(o.notes)}</p>` : ""}
    <p class="slip-foot">${o.source === "staff" ? `Entered by ${esc(o.enteredBy)}` : "Ordered online"} · ${new Date(o.placedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
  </article>`;
}

/* Builds the slips, hands them to the browser's print dialog, and tidies up afterwards. The page's own CSS hides everything but the slips while printing. */
export function printSlips(orders, cfg) {
  if (!orders.length) return false;
  document.querySelectorAll(".slips").forEach(e => e.remove());
  const sheet = document.createElement("div");
  sheet.className = "slips";
  sheet.innerHTML = orders.map(o => slipHTML(o, cfg)).join("");
  document.body.appendChild(sheet);
  document.body.classList.add("printing-slips");
  const cleanup = () => { document.body.classList.remove("printing-slips"); sheet.remove(); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  window.print();
  return true;
}
