// Makes qa/fixture/: a fixed set of comics (a snapshot of real ones) with small covers, so the browser checks don't depend on what the shop stocks today.
// Run it again only if the fixture needs to change:  node qa/make-fixture.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ROOT } from "./lib.mjs";

const OUT = path.join(ROOT, "qa", "fixture");
const real = JSON.parse(fs.readFileSync(path.join(ROOT, "data/products.json"), "utf8"));
const byId = new Map(real.map(p => [p.id, p]));

// A mix that exercises everything: a long numbered series (natural order #2 before #10), single series with 2-3 issues, a variant, new labels, an omnibus with a long
// Contents list, trades, manga, several publishers, comics down to their last copies, and a spread of prices.
const IDS = [
  "batman-by-jeph-loeb-and-tim-sale", "it-s-lonely-at-the-centre-of-the-earth", "the-karman-blade-2", "the-karman-blade-1",
  "the-smart-division-1-2", "the-smart-division-2", "the-smart-division-1", "x-men-39",
  ...Array.from({ length: 13 }, (_, i) => `batman-2025-${13 - i}`), "batman-14", "batman-423",
  "berserk-deluxe-edition-vol-2", "berserk-deluxe-edition-vol-1", "gotham-central-book-2-jokers-and-madmen-vol-2", "gotham-central-book-1-in-the-line-of-duty",
  "the-deadman-5", "absolute-green-lantern-19", "jsa-24", "luther-strode-1-2", "luther-strode-1", "midnight-x-men-1", "red-sonja-she-devil-with-a-sword-6",
  "supernatural-sam-winchester-1", "witness-point-3", "something-is-killing-the-children-50", "sabrina-the-teenage-witch-1", "z-men-39", "the-amazing-spooder-man-1001"
];
const STOCK = { "jsa-24": 1, "witness-point-3": 2, "supernatural-sam-winchester-1": 2 }; // the last copies
const products = IDS.map(id => { const p = byId.get(id); if (!p) throw new Error("not in the shop any more: " + id); return { ...p, stock: STOCK[id] ?? Math.max(3, p.stock) }; });

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "covers"), { recursive: true });
for (const p of products) {
  if (!p.image) continue;
  const name = path.basename(p.image);
  await sharp(path.join(ROOT, p.image)).resize({ width: 360 }).jpeg({ quality: 68, mozjpeg: true }).toFile(path.join(OUT, "covers", name));
}
fs.writeFileSync(path.join(OUT, "products.json"), "[\n" + products.map(p => " " + JSON.stringify(p)).join(",\n") + "\n]\n");
fs.writeFileSync(path.join(OUT, "featured.json"), JSON.stringify(["z-men-39", "the-amazing-spooder-man-1001", "the-karman-blade-2"], null, 2) + "\n");
console.log(`${products.length} comics, ${fs.readdirSync(path.join(OUT, "covers")).length} covers -> ${path.relative(ROOT, OUT)}`);
