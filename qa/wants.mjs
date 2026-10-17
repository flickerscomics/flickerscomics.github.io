import { launch } from "./lib.mjs";
const BASE = "http://localhost:8080";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push(!!ok); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : "")); };
const SOLD = "the-deadman-5";
const shopNow = (await (await fetch(BASE + "/data/shop.json")).json()).products;
const FOLLOW = (shopNow.find(p => p.stock > 0 && shopNow.filter(q => q.title === p.title).length > 1) || shopNow.find(p => p.stock > 0)).id; // an in-stock comic from a series
const browser = await launch();
const errors = [];
const mk = async (w = 1280, h = 900) => { const p = await browser.newPage(); await p.setViewport({ width: w, height: h }); p.on("pageerror", e => errors.push(e.message)); p.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); return p; };
const typ = async (p, sel, text) => { await p.bringToFront(); await p.$eval(sel, e => { e.value = ""; }); await p.type(sel, text); };
const clk = (p, sel) => p.$eval(sel, e => e.click());

const shopper = await mk(390, 844);
await shopper.goto(BASE + "/", { waitUntil: "networkidle0" });
const btn = await shopper.$eval(`.card[data-id="${SOLD}"] .add`, b => ({ text: b.textContent, disabled: b.getAttribute("aria-disabled"), label: b.getAttribute("aria-label") }));
check("a sold-out card offers Notify me", btn.text === "Notify me" && btn.disabled === "false" && btn.label.startsWith("Notify me when it's back"), JSON.stringify(btn));
await clk(shopper, `.card[data-id="${SOLD}"] .add`); await sleep(300);
check("it opens the request dialog", await shopper.$eval("#want", d => d.open) && (await shopper.$eval("#wantTitle", e => e.textContent)).includes("back"));
check("no comic text box for a restock request", await shopper.$eval("#wantTextField", e => e.hidden));
await clk(shopper, "#wantBtn"); await sleep(200);
check("empty form says what's missing", (await shopper.$eval("#wantError", e => e.textContent)).includes("full name"));
await typ(shopper, "#w-name", "Wanda Waits"); await typ(shopper, "#w-phone", "555 0101");
await clk(shopper, "#wantBtn"); await sleep(900);
check("success message shown", !(await shopper.$eval("#wantDone", e => e.hidden)) && (await shopper.$eval("#wantDoneTitle", e => e.textContent)) === "You're on the list", await shopper.$eval("#wantDoneTitle", e => e.textContent));
await clk(shopper, `#want [data-close]`).catch(() => {});
await shopper.$eval("#want", d => d.close());
await clk(shopper, `.card[data-id="${SOLD}"] .add`); await sleep(300);
await typ(shopper, "#w-name", "Wanda Waits"); await typ(shopper, "#w-phone", "5550101");
await clk(shopper, "#wantBtn"); await sleep(900);
check("asking twice says you're already on the list", (await shopper.$eval("#wantDoneTitle", e => e.textContent)).includes("already"));
await shopper.$eval("#want", d => d.close());

// comic pages
await shopper.goto(`${BASE}/comic/${SOLD}/`, { waitUntil: "networkidle0" }); await sleep(300);
check("sold-out comic page: Tell me when it's back + Follow + Save", !!(await shopper.$('[data-buy] [data-want="restock"]')) && !!(await shopper.$('[data-buy] [data-want="series"]')) && !!(await shopper.$("[data-buy] .save-link")));
await shopper.goto(`${BASE}/comic/${FOLLOW}/`, { waitUntil: "networkidle0" }); await sleep(300);
check("in-stock comic page has no restock button but has Follow", !(await shopper.$('[data-buy] [data-want="restock"]')) && !!(await shopper.$('[data-buy] [data-want="series"]')));
const followLabel = (await shopper.$eval('[data-buy] [data-want="series"]', e => e.textContent)).trim();
await clk(shopper, '[data-buy] [data-want="series"]'); await sleep(300);
check("follow dialog names the series", (await shopper.$eval("#wantTitle", e => e.textContent)) === followLabel, followLabel);
await typ(shopper, "#w-name", "Pat Pullist"); await typ(shopper, "#w-phone", "5550202");
await clk(shopper, "#wantBtn"); await sleep(900);
check("following works", (await shopper.$eval("#wantDoneTitle", e => e.textContent)) === "You're following it");

// request a comic from an empty search
await shopper.goto(BASE + "/", { waitUntil: "networkidle0" });
await shopper.$eval("#q", el => { el.value = "absolutely nothing"; el.dispatchEvent(new Event("input", { bubbles: true })); }); await sleep(200);
check("empty search offers 'Ask us to find it'", !(await shopper.$eval("#empty .request-line", e => e.hidden)));
await clk(shopper, '#empty [data-want="request"]'); await sleep(300);
check("the request box is prefilled with what they searched", (await shopper.$eval("#w-text", e => e.value)) === "absolutely nothing" && !(await shopper.$eval("#wantTextField", e => e.hidden)));
await typ(shopper, "#w-text", "Absolute Wonder Woman #1, any cover");
await typ(shopper, "#w-name", "Rhea Quest"); await typ(shopper, "#w-phone", "5550303");
await clk(shopper, "#wantBtn"); await sleep(900);
check("request sent", (await shopper.$eval("#wantDoneTitle", e => e.textContent)) === "Request sent");
check("footer and shelf-end links exist", !!(await shopper.$('.site-footer [data-want="request"]')) && !!(await shopper.$(".request-end")));

// staff side
const staff = await mk(1280, 900);
await staff.goto(BASE + "/admin/", { waitUntil: "networkidle0" });
await typ(staff, "#u", "owner"); await typ(staff, "#pw", "owner-password-1");
await clk(staff, "#loginBtn"); await staff.waitForSelector("#panel .arow");
await clk(staff, '[data-tab="wanted"]'); await staff.waitForSelector(".want-h");
const heads = await staff.$$eval(".want-h", h => h.map(x => x.textContent.replace(/\s+/g, " ").trim()));
check("Wanted tab sections with counts", heads.join(" | ") === "Ready to contact 1 | Waiting 2 | Contacted 0", heads.join(" | "));
const text = await staff.$eval("#wantedList", e => e.textContent);
check("shows who, phone and what", text.includes("Wanda Waits") && text.includes("555 0101") && text.includes("The Deadman #5") && text.includes("Follows " + followLabel.replace(/^Follow /, "")) && text.includes("Absolute Wonder Woman"));
await clk(staff, '.want.is-action [data-wid]'); await sleep(700);
check("marking a request contacted moves it down", (await staff.$$eval(".want-h", h => h.map(x => x.textContent.replace(/\s+/g, " ").trim()).join(" | "))) === "Ready to contact 0 | Waiting 2 | Contacted 1");

// restock from the stock tab
await clk(staff, '[data-tab="stock"]'); await staff.waitForSelector("#panel .arow"); await sleep(300);
await staff.$eval(`[data-stock="${SOLD}"]`, el => { el.value = "5"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await clk(staff, "#aPublish"); await sleep(1500);
check("publish succeeded", (await staff.$eval("#aMsg", e => e.textContent)).startsWith("Published"));
await clk(staff, '[data-tab="wanted"]'); await staff.waitForSelector(".want-h"); await sleep(300);
const after = await staff.$eval("#wantedList", e => e.textContent);
check("restocked comic's requester is now ready to contact", (await staff.$$eval(".want-h", h => h[0].textContent.replace(/\s+/g, " ").trim())) === "Ready to contact 1" && after.includes("Back in stock since"), after.slice(0, 120));
await clk(staff, "[data-wdelete]"); await sleep(200);
check("remove asks first", (await staff.$eval("#aMsg", e => e.textContent)).includes("Remove"));
await clk(staff, "#aMsg .btn-danger"); await sleep(600);
check("and removes", (await staff.$$eval(".want", w => w.length)) === 2);
check("no script errors", errors.length === 0, errors.join(" | "));
await browser.close();
const bad = results.filter(x => !x).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
