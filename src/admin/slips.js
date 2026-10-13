/* Staff area: printable slips. One till-roll receipt per order (what to gather, who it's for, how it goes out, what it costs). */
import { esc, escLines, money, hoursText } from "../shared.mjs";

const day = iso => {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return y ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))) : "";
};

/* One order as the till would print it: a narrow roll of paper (80 mm), monospaced type, dashed rules, prices lined up on the right. */
const SHOP = "FLICKERS COMICS";
const stamp = iso => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function slipHTML(o, cfg) {
  const rows = o.items.map(i => `<li><span class="rc-l">${i.qty} x ${esc(i.title)}</span><span class="rc-r">${money(i.price * i.qty)}</span>${i.qty > 1 ? `<span class="rc-sub">@ ${money(i.price)} each</span>` : ""}</li>`).join("");
  const how = o.method === "post" ? `<p class="rc-row"><b>POST TO</b></p><p class="rc-block">${escLines(o.address)}</p>` : `<p class="rc-row"><b>COLLECT</b><span>${esc(day(o.collectDate))}</span></p>${cfg && cfg.openHour != null ? `<p class="rc-row rc-dim">Open<span>${esc(hoursText(cfg))}</span></p>` : ""}`;
  const paid = o.paid ? (o.payment && o.payment.state === "paid" && !o.payment.sandbox ? "PAID VIA FLEECA" : "PAID") : o.payment && o.payment.state === "awaiting" ? "AWAITING PAYMENT" : "NOT PAID YET";
  const units = o.items.reduce((n, i) => n + i.qty, 0);
  return `<article class="slip">
    <header class="rc-head"><h2>${SHOP}</h2><p>Independent comic shop</p></header>
    <hr class="rc-rule">
    <p class="rc-row"><b>ORDER</b><span>${esc(o.id)}</span></p>
    <p class="rc-row"><b>DATE</b><span>${esc(stamp(o.placedAt))}</span></p>
    <p class="rc-row"><b>NAME</b><span>${esc(o.name)}</span></p>
    ${o.phone ? `<p class="rc-row"><b>PHONE</b><span>${esc(o.phone)}</span></p>` : ""}
    ${how}
    <hr class="rc-rule rc-solid">
    <ul class="rc-items">${rows}</ul>
    <hr class="rc-rule">
    <p class="rc-row"><span>${units} item${units === 1 ? "" : "s"}</span></p>
    <p class="rc-row">Subtotal<span>${money(o.subtotal)}</span></p>
    ${o.discount ? `<p class="rc-row">${esc(o.deal || "Deal")}<span>-${money(o.discount)}</span></p>` : ""}
    ${o.postage ? `<p class="rc-row">Postage<span>${money(o.postage)}</span></p>` : ""}
    <p class="rc-row rc-total"><b>TOTAL</b><b>${money(o.total)}</b></p>
    <p class="rc-pay">${esc(paid)}</p>
    ${o.notes ? `<hr class="rc-rule"><p class="rc-block"><b>NOTE:</b> ${escLines(o.notes)}</p>` : ""}
    <hr class="rc-rule">
    <footer class="rc-foot"><p>${o.source === "staff" ? `Served by ${esc(o.enteredBy)}` : "Ordered online"}</p><p>THANK YOU!</p><p>See you again soon</p></footer>
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
