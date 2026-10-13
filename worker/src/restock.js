/* Adding copies back to the shelf from the Reorder tab: "4 × Luther Strode #1 have arrived". Adds to what's in stock right now (read from
   GitHub, so orders that came in meanwhile aren't overwritten) and tells the wanted list about anything that's back. */
import { bad } from "./http.js";
import { adjustStock } from "./github.js";
import { announceRestocks } from "./wants.js";

const MAX_LINES = 100, MAX_QTY = 999, ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

export async function addStock(env, raw, user) {
  const items = Array.isArray(raw && raw.items) ? raw.items : [];
  if (!items.length) throw bad(400, "Tick at least one comic first.");
  if (items.length > MAX_LINES) throw bad(400, `Add up to ${MAX_LINES} comics at a time.`);
  const want = new Map();
  for (const i of items) {
    const id = String(i && i.id || ""), qty = Number(i && i.qty);
    if (!ID_RE.test(id)) throw bad(400, "One of those isn't a comic in the shop.");
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw bad(400, `Each number must be a whole number from 1 to ${MAX_QTY}.`);
    want.set(id, (want.get(id) || 0) + qty);
  }
  const total = [...want.values()].reduce((a, b) => a + b, 0);
  const r = await adjustStock(env, [...want], `Restock (${user.username}): ${total} cop${total === 1 ? "y" : "ies"} added`);
  await announceRestocks(env, r.before, r.products).catch(() => console.error("Couldn't post wanted-list alerts"));
  return { ok: true, added: total, comics: want.size, stock: Object.fromEntries([...want.keys()].map(id => [id, (r.products.find(p => p.id === id) || {}).stock])) };
}
