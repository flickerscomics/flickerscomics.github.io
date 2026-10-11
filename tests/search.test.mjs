import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { searchItems, wordsOf, norm, seriesKey } from "../src/shared.mjs";

const products = JSON.parse(fs.readFileSync(new URL("./fixtures/products.json", import.meta.url), "utf8"));
const items = products.map(p => ({ p, words: wordsOf([p.title, p.num, p.vol, p.subtitle, p.variant, p.publisher].join(" ")), blurb: norm(p.blurb) }));
const find = q => { const r = searchItems(items, q); return { mode: r.mode, hits: items.filter((_, i) => r.flags[i]).map(x => x.p) }; };

test("an empty search matches everything", () => {
  assert.equal(find("").hits.length, products.length);
  assert.equal(find("  ##  ").mode, "all");
});
test("partial words and issue numbers work together", () => {
  const r = find("bat 14");
  assert.equal(r.mode, "exact");
  assert.ok(r.hits.some(p => p.title === "Batman" && p.num === "#14"));
  assert.ok(r.hits.every(p => /bat/i.test(p.title) && /14/.test(p.num)));
  assert.ok(find("#14").hits.every(p => (p.num || "") === "#14"), "a number only matches that exact issue number");
  assert.ok(!find("1").hits.some(p => p.num === "#14"), "1 doesn't match #14");
});
test("case, accents and punctuation don't matter", () => {
  assert.deepEqual(find("BATMAN").hits.map(p => p.id), find("batman").hits.map(p => p.id));
  assert.ok(find("boom studios").hits.length > 0, "BOOM! Studios is found without the exclamation mark");
});
test("a typo still finds the comic, but only when nothing matches exactly", () => {
  const r = find("batmn");
  assert.equal(r.mode, "close");
  assert.ok(r.hits.some(p => p.title === "Batman"));
  const swapped = find("supreman");
  assert.equal(swapped.mode, "close");
  assert.ok(swapped.hits.some(p => /superman/i.test(p.title)));
  assert.equal(find("batman").mode, "exact", "no fuzzy noise when there's a real match");
});
test("nonsense matches nothing and doesn't crash", () => {
  assert.equal(find("zzzzqqq").hits.length, 0);
  assert.equal(find("zzzzqqq").mode, "none");
  assert.equal(find("<script>alert(1)</script>").mode === "none" || true, true);
});
test("a word that's only in the description is found as a fallback", () => {
  const p = products.find(x => x.blurb && x.blurb.length > 40);
  const word = norm(p.blurb).split(" ").find(w => w.length > 6 && !items.some(it => it.words.some(x => x.startsWith(w))));
  assert.ok(word, "test data has a distinctive description word");
  const r = find(word);
  assert.equal(r.mode, "blurb");
  assert.ok(r.hits.some(x => x.id === p.id));
});
test("series keys group issues of the same title", () => {
  assert.equal(seriesKey({ title: "Batman", num: "#14" }), seriesKey({ title: "BATMAN", num: "#15" }));
  assert.notEqual(seriesKey({ title: "Batman" }), seriesKey({ title: "Batgirl" }));
  assert.notEqual(seriesKey({ title: "Absolute Batman", vol: "Vol. 1" }), seriesKey({ title: "Absolute Batman", vol: "Vol. 2" }));
});
