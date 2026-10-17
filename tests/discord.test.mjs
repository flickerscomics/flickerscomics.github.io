/* Posting to Discord: the paths that only happen when Discord misbehaves. */
import test from "node:test";
import assert from "node:assert/strict";
import { webhook } from "../worker/src/discord.js";

const HOOK = "https://discord.test/api/webhooks/1/secret-token";
const env = { DISCORD_WEBHOOK_URL: HOOK };
const payload = { content: "hi" };

test("with no webhook set, or a broken address, nothing is sent and it says why", async () => {
  assert.deepEqual(await webhook({}, { payload }), { ok: false, reason: "not configured" });
  const r = await webhook({ DISCORD_WEBHOOK_URL: "not a url" }, { payload });
  assert.equal(r.ok, false); assert.match(r.reason, /isn't valid/);
});

test("when Discord says slow down, it waits and tries once more", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return calls === 1 ? new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 }) : new Response(JSON.stringify({ id: "42" }), { status: 200 }); };
  const r = await webhook(env, { payload, wait: true });
  assert.deepEqual(r, { ok: true, id: "42" });
  assert.equal(calls, 2);
});

test("if Discord can't be reached twice, it gives up with a plain reason, and never puts the address in the log", async () => {
  let calls = 0; const logged = [];
  globalThis.fetch = async () => { calls++; throw new Error("network down: " + HOOK); };
  const real = console.error; console.error = (...a) => logged.push(a.join(" "));
  try { const r = await webhook(env, { payload }); assert.deepEqual(r, { ok: false, reason: "Discord didn't answer" }); } finally { console.error = real; }
  assert.equal(calls, 2);
  assert.ok(!logged.join(" ").includes("secret-token"), "the secret address is never logged");
});

test("an error from Discord is reported by status only, and editing a message goes to that message's address", async () => {
  const seen = [];
  globalThis.fetch = async (url, opts) => { seen.push({ url: String(url), method: opts.method }); return new Response("{}", { status: 404 }); };
  const r = await webhook(env, { method: "PATCH", messageId: "m 1", payload });
  assert.deepEqual(r, { ok: false, reason: "Discord answered 404" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "PATCH");
  assert.ok(seen[0].url.endsWith("/messages/m%201"), seen[0].url);
});
