/* The wanted list: notify me when it's back, follow a series, request a comic. */
import { fullTitle } from "../shared.mjs";
import { qv, drawer, co, tr, savedDlg, wd, byId, $, postJson, apiBase, wantsOn } from "./core.js";

/* ===================== wanted list: notify me, follow a series, request a comic ===================== */
export const wForm = $("wantForm");
export let wantCtx = null;
export const WANT_COPY = {
  restock: p => ({ title: "Tell me when it's back", intro: `Leave your details and we'll let you know when ${fullTitle(p)} is back on the shelves.`, button: "Notify me", done: "You're on the list", msg: `We'll text you when ${fullTitle(p)} is back.` }),
  series: p => ({ title: `Follow ${p.title}`, intro: `Follow ${p.title} and we'll let you know when a new issue arrives, so you can have it set aside.`, button: "Follow this series", done: "You're following it", msg: `We'll text you when a new issue of ${p.title} comes in.` }),
  request: () => ({ title: "Request a comic", intro: "Can't find it on the shelves? Tell us what you're after and we'll see if we can get it in.", button: "Send request", done: "Request sent", msg: "We'll be in touch if we can get it in." })
};
export function showWantButtons() { document.querySelectorAll("[data-want]").forEach(b => { b.hidden = !wantsOn(); }); document.querySelectorAll("[data-want-only]").forEach(e => { e.hidden = !wantsOn(); }); }
export function openWant(kind, id, prefill = "") {
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
