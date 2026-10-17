/* Fleeca Payment Gateway V2 (GTA World's bank): a small client and the webhook signature check. See docs/FLEECA.md.

   Bindings:
     FLEECA_API_KEY   secret. Used to call the API and to sign webhooks. Never logged, returned or put in an error message.
     FLEECA_PAYMENTS  "true" to send online orders to Fleeca. Anything else keeps ordering exactly as it was (pay the shop directly).
     FLEECA_MODE      "0" sandbox (nothing moves, always succeeds) or "1" live

   Fleeca allows 10 API calls a minute per key, shared by every call the Worker makes. Only V2 payments are used here;
   the transfers endpoints send real money out and are never called. */
import { bad } from "./http.js";

const BASE = "https://banking.gta.world/api";
const enc = new TextEncoder();

export const payOn = env => String(env.FLEECA_PAYMENTS) === "true" && !!String(env.FLEECA_API_KEY || "").trim();
export const fleecaMode = env => (String(env.FLEECA_MODE) === "1" ? 1 : 0);

/* Fleeca says mode as 0/1 when we send it and as "sandbox"/"live" when it answers. */
export const modeNumber = m => (m === 1 || m === "1" || m === "live" ? 1 : m === 0 || m === "0" || m === "sandbox" ? 0 : null);

export class FleecaError extends Error {
  constructor(status, message) { super(message); this.status = status; this.detail = ""; /* a short, safe note from Fleeca's answer, for the log */ }
}

async function call(env, path, init = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { Accept: "application/json", Authorization: `Bearer ${String(env.FLEECA_API_KEY).trim()}`, ...(init.body ? { "Content-Type": "application/json" } : {}) }
    });
  } catch (e) { throw new FleecaError(0, "Fleeca couldn't be reached"); }
  let data = null, text = "";
  try { text = await res.text(); data = JSON.parse(text); } catch (e) { /* no body, or not JSON */ }
  if (!res.ok) { const e = new FleecaError(res.status, `Fleeca answered ${res.status}`); e.detail = `[${res.headers.get("content-type") || "?"}] ` + String((data && (data.message || data.error || JSON.stringify(data))) || text || "").replace(/[^ -~]/g, " ").slice(0, 300); throw e; } // the status and Fleeca's short message go to the logs only, never to customers
  return data || {};
}

/* Whole dollars, as Fleeca wants. Returns { id, link }. */
export async function createPayment(env, { amount, description }) {
  const d = await call(env, "/v2/payment", { method: "POST", body: JSON.stringify({ amount, mode: fleecaMode(env), description: String(description).slice(0, 255) }) });
  if (!d.payment_id || !/^https:\/\/banking\.gta\.world\//.test(String(d.payment_link || ""))) throw new FleecaError(502, "Fleeca gave an answer we couldn't use");
  return { id: String(d.payment_id), link: d.payment_link };
}

export async function getPayment(env, id) {
  const d = await call(env, `/v2/payments/${encodeURIComponent(id)}`);
  return d.data || null;
}

/* The customer-facing message for a failed attempt to create a payment. */
export const unavailable = e => bad(e instanceof FleecaError && e.status === 429 ? 503 : 502,
  e instanceof FleecaError && e.status === 429
    ? "Fleeca is busy right now. Wait a minute and try again. Nothing was charged."
    : "We couldn't connect to Fleeca just now. Try again in a moment. Nothing was charged.");

/* "sha256=<hex HMAC of the raw body, keyed with the API key>", compared in constant time. Returns the parsed body, or null if it doesn't check out. */
export async function verifySignature(raw, header, apiKey) {
  if (!apiKey || !header) return null;
  const key = await crypto.subtle.importKey("raw", enc.encode(String(apiKey).trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  const expected = enc.encode("sha256=" + [...sig].map(b => b.toString(16).padStart(2, "0")).join("")), given = enc.encode(String(header).trim().toLowerCase());
  let diff = expected.length ^ given.length;
  for (let i = 0; i < Math.max(expected.length, given.length); i++) diff |= (expected[i] ?? 0) ^ (given[i] ?? 0);
  if (diff !== 0) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
