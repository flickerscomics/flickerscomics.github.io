/* Staff area: order receipts as pictures. One till-roll receipt per order, drawn onto a canvas and saved as a PNG: 576 px wide (80 mm paper at 203 dpi,
   the printable 72 mm of it), monospaced type, dashed rules, prices lined up on the right. Several orders are stacked into one tall picture with a cut line between. */
import { hoursText, money } from "../shared.mjs";
import { download } from "./core.js";

const W = 576, SCALE = 2, MONO = '"Courier New","Lucida Console",Consolas,monospace';
const SHOP = "FLICKERS COMICS", GAP = 56;
const FONT = { base: `22px ${MONO}`, bold: `bold 22px ${MONO}`, small: `18px ${MONO}`, title: `bold 40px ${MONO}`, total: `bold 32px ${MONO}` };

const day = iso => {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return y ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))) : "";
};
const stamp = iso => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/* Words wrapped to a width, breaking a word that's too long on its own. */
function wrap(ctx, text, font, max) {
  ctx.font = font;
  const out = [];
  for (const para of String(text || "").split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (ctx.measureText(w).width > max) { // a single long word
        let n = w.length; while (n > 1 && ctx.measureText(w.slice(0, n)).width > max) n--;
        if (line) { out.push(line); line = ""; }
        out.push(w.slice(0, n)); w = w.slice(n);
      }
      const next = line ? line + " " + w : w;
      if (ctx.measureText(next).width <= max) line = next; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

/* Works out where everything on one receipt goes. Returns the drawing steps and the receipt's height. */
function layout(ctx, o, cfg) {
  const ops = [], LH = 30, side = 6;
  let y = 24;
  const rise = font => (font === FONT.title ? 34 : font === FONT.total ? 28 : font === FONT.small ? 17 : 21); // from the top of the line down to the baseline
  const text = (t, x, font, align = "left", extra = {}) => ops.push({ k: "text", t, x, y: y + rise(font), font, align, ...extra });
  const line = (t, font = FONT.base, align = "center", extra = {}) => { text(t, align === "center" ? W / 2 : align === "right" ? W - side : side, font, align, extra); y += LH; };
  const row = (l, r, lf = FONT.base, rf = FONT.base) => { text(l, side, lf); text(r, W - side, rf, "right"); y += LH; };
  const rule = (dashed = true, gap = 10) => { y += gap - 4; ops.push({ k: "rule", y, dashed }); y += gap + 2; };

  line(SHOP, FONT.title, "center", { space: 2 }); y += 14;
  line("Independent comic shop", FONT.small);
  rule();
  row("ORDER", o.id, FONT.bold);
  row("DATE", stamp(o.placedAt), FONT.bold);
  row("NAME", o.name, FONT.bold);
  if (o.phone) row("PHONE", o.phone, FONT.bold);
  if (o.method === "post") {
    line("POST TO", FONT.bold, "left");
    wrap(ctx, o.address, FONT.base, W - 2 * side).forEach(t => line(t, FONT.base, "left"));
  } else {
    row("COLLECT", day(o.collectDate), FONT.bold);
    if (cfg && cfg.openHour != null) row("Open", hoursText(cfg), FONT.small, FONT.small);
  }
  rule(false);
  for (const i of o.items) {
    const price = money(i.price * i.qty);
    ctx.font = FONT.base;
    const lines = wrap(ctx, `${i.qty} x ${i.title}`, FONT.base, W - 2 * side - ctx.measureText(price).width - 18);
    lines.forEach((t, n) => { text(t, side, FONT.base); if (n === 0) text(price, W - side, FONT.base, "right"); y += LH; });
    if (i.qty > 1) { text(`@ ${money(i.price)} each`, side + 26, FONT.small); y += 26; }
    y += 6;
  }
  rule();
  const units = o.items.reduce((n, i) => n + i.qty, 0);
  line(`${units} item${units === 1 ? "" : "s"}`, FONT.base, "left");
  row("Subtotal", money(o.subtotal));
  if (o.discount) row(o.deal || "Deal", "-" + money(o.discount));
  if (o.postage) row("Postage", money(o.postage));
  y += 4; ops.push({ k: "rule", y, dashed: false, thick: true }); y += 16;
  row("TOTAL", money(o.total), FONT.total, FONT.total); y += 18;
  const paid = o.paid ? (o.payment && o.payment.state === "paid" && !o.payment.sandbox ? "PAID VIA FLEECA" : "PAID") : o.payment && o.payment.state === "awaiting" ? "AWAITING PAYMENT" : "NOT PAID YET";
  ops.push({ k: "box", y, h: 40 }); y += 9; line(paid, FONT.bold, "center", { space: 3 }); y += 14;
  if (o.notes) {
    rule();
    wrap(ctx, "NOTE: " + o.notes, FONT.base, W - 2 * side).forEach(t => line(t, FONT.base, "left"));
  }
  rule();
  line(o.source === "staff" ? `Served by ${o.enteredBy}` : "Ordered online", FONT.small);
  y += 4; line("THANK YOU!", FONT.bold, "center", { space: 5 });
  line("See you again soon", FONT.small);
  return { ops, height: y + 24 };
}

function paint(ctx, ops, top) {
  for (const op of ops) {
    const y = top + op.y;
    if (op.k === "text") {
      ctx.font = op.font; ctx.textAlign = op.align; ctx.textBaseline = "alphabetic";
      if ("letterSpacing" in ctx) ctx.letterSpacing = (op.space || 0) + "px";
      ctx.fillText(op.t, op.x + (op.align === "center" && op.space ? op.space / 2 : 0), y);
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    } else if (op.k === "rule") {
      ctx.lineWidth = op.thick ? 3 : 2; ctx.setLineDash(op.dashed ? [8, 6] : []);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
    } else if (op.k === "box") {
      ctx.lineWidth = 3; ctx.strokeRect(2, y, W - 4, op.h);
    }
  }
}

/* One PNG (as a Blob) holding every order's receipt, top to bottom. */
export async function receiptImage(orders, cfg) {
  const measure = document.createElement("canvas").getContext("2d");
  const laid = orders.map(o => layout(measure, o, cfg));
  const total = laid.reduce((h, l) => h + l.height, 0) + GAP * (laid.length - 1);
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE; canvas.height = Math.ceil(total * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, total);
  ctx.fillStyle = "#000"; ctx.strokeStyle = "#000";
  let top = 0;
  laid.forEach((l, n) => {
    paint(ctx, l.ops, top);
    top += l.height;
    if (n < laid.length - 1) { // the line to cut along
      ctx.font = `16px ${MONO}`; ctx.textAlign = "center"; ctx.fillText("- - - - - - cut here - - - - - -", W / 2, top + GAP / 2 + 5);
      top += GAP;
    }
  });
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error("The picture couldn't be made."))), "image/png"));
}

/* Makes the picture and saves it. Returns the file name, or null if there was nothing to save. */
export async function saveReceipts(orders, cfg) {
  if (!orders.length) return null;
  const blob = await receiptImage(orders, cfg);
  const name = orders.length === 1 ? `flickers-receipt-${orders[0].id}.png` : `flickers-receipts-${new Date().toISOString().slice(0, 10)}.png`;
  download(name, blob, "image/png");
  return name;
}
