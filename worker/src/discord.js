/* Posting to Discord through the shop's webhook. The webhook address is a secret: it's never logged or returned. */

export const escMd = s => String(s).replace(/([\\*_~`|>])/g, "\\$1").replace(/</g, "\\<").replace(/@/g, "@\u200b");
export const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export const pingRole = env => (/^\d{5,25}$/.test(String(env.DISCORD_PING_ROLE || "")) ? String(env.DISCORD_PING_ROLE) : null);

/** One call to the webhook, with a single retry if Discord says slow down.
   @param {any} env
   @param {{ method?: string, messageId?: string, wait?: boolean, payload: any }} opts */
export async function webhook(env, { method = "POST", messageId, wait = false, payload }) {
  const raw = String(env.DISCORD_WEBHOOK_URL || "").trim(); // a pasted secret can pick up a stray space or line break
  if (!raw) return { ok: false, reason: "not configured" };
  let url;
  try { url = new URL(raw); } catch (e) { return { ok: false, reason: "the webhook address isn't valid" }; }
  if (messageId) url.pathname = url.pathname.replace(/\/+$/, "") + "/messages/" + encodeURIComponent(messageId);
  if (wait) url.searchParams.set("wait", "true");
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try { res = await fetch(url.toString(), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
    catch (e) { console.error("Discord unreachable"); continue; }
    if (res.ok) { let data = {}; try { data = await res.json(); } catch (e) { /* no body */ } return { ok: true, id: data && data.id }; }
    if (res.status === 429) {
      let seconds = 1;
      try { seconds = Math.min(3, Number((await res.json()).retry_after) || 1); } catch (e) { /* default */ }
      await new Promise(r => setTimeout(r, seconds * 1000));
      continue;
    }
    console.error("Discord answered", res.status); // the status only
    return { ok: false, reason: `Discord answered ${res.status}` };
  }
  return { ok: false, reason: "Discord didn't answer" };
}
