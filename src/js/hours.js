/* Opening hours: the status strip, the week, and the shop's own clock (it can differ from the visitor's). */
import { hLabel, hoursShort, DAYS } from "../shared.mjs";
import { wd, CONFIG, $ } from "./core.js";

/* ===================== hours ===================== */
export function shopNow() {
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
export const ymdAdd = (o, n) => { const t = new Date(Date.UTC(o.y, o.m - 1, o.d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
export const isoDate = o => `${o.y}-${String(o.m).padStart(2, "0")}-${String(o.d).padStart(2, "0")}`;
export function fmtDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
export function hoursStatus() {
  const n = shopNow();
  if (n.h >= CONFIG.openHour && n.h < CONFIG.closeHour) return { open: true, text: `Open now · closes at ${hLabel(CONFIG.closeHour)}` };
  if (n.h < CONFIG.openHour) return { open: false, text: `Closed · opens today at ${hLabel(CONFIG.openHour)}` };
  return { open: false, text: `Closed · opens tomorrow at ${hLabel(CONFIG.openHour)}` };
}
export function renderHours() {
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
