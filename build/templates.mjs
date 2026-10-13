/* HTML templates for the pre-rendered site. Everything here runs at build time. */
import { esc, money, fullTitle, metaLine, coverHTML, hoursText, hoursShort, DAYS, isVariant, heartSprite, heartIcon, stickerHTML, detailHTML, dealOn, dealName } from "../src/shared.mjs";

const X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const SITE_NAME = "Flickers Comics";
const BUILD_ID = Date.now().toString(36);
export const DEFAULT_DESC = "Independent comic shop. Order online, then collect at the counter or have it posted to you.";

/* ---------- page shell ---------- */
export function page({ title, desc, root = "", canonical, ogImage, ogType = "website", body, jsonld, cfg, css = ["css/styles.css"], script = "js/site.js", noindex = false, extraHead = "", csp, fontPreload = [], fontCss = "" }) {
  const orderOrigin = cfg.orderApi ? ` ${new URL(cfg.orderApi).origin}` : "";
  const policy = csp || `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'${orderOrigin}; base-uri 'self'; form-action 'self'${orderOrigin}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${esc(policy)}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0E1211">
<meta name="color-scheme" content="light dark">
${noindex ? '<meta name="robots" content="noindex">' : ""}${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ""}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${esc(ogImage)}">` : ""}
<link rel="icon" type="image/png" href="${root}assets/favicon.png">
<link rel="apple-touch-icon" href="${root}assets/apple-touch-icon.png">
${fontPreload.map(f => `<link rel="preload" href="${root}${f}" as="font" type="font/woff2" crossorigin>`).join("\n")}
${fontCss ? `<style>${fontCss.split("__ROOT__").join(root)}</style>` : ""}
${script === "js/site.js" ? `<noscript><style>.add,.cart-btn,.qv-buy,.tools,.dividers{display:none!important}</style></noscript>` : ""}
${css.map(c => `<link rel="stylesheet" href="${root}${c}">`).join("\n")}
${script === "js/site.js" ? `<link rel="preload" href="${root}data/shop.json?v=${BUILD_ID}" as="fetch" crossorigin>` : ""}
${extraHead}
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
</head>
<body data-root="${root}" data-build="${BUILD_ID}">
${script === "js/site.js" ? `<noscript><p class="page-note">JavaScript is off, so you can browse but not order. Turn it on to add comics to a cart.</p></noscript>` : ""}
${script === "js/site.js" ? heartSprite : ""}${script === "js/site.js" ? heartSprite : ""}${body}
${script ? `<script type="module" src="${root}${script}"></script>` : ""}
</body>
</html>
`;
}

/* ---------- chrome ---------- */
/* The bold strip under the hero. Decorative (it only repeats facts that are already on the page), so it's hidden from screen readers. */
function ticker(cfg, hasNew) {
  const items = [hasNew ? "New this week" : "Fresh on the shelves", "Collect in store for free", dealOn(cfg.deal) ? dealName(cfg.deal) : "", cfg.payOnline ? "Pay with Fleeca" : "", "Open every day"].filter(Boolean);
  return `<span class="ticker-set">${items.map(t => `<span>${esc(t)}</span>`).join("")}</span>`;
}

function topStrip(cfg) {
  return `<section class="topstrip" aria-label="Opening hours and postage">
  <div class="wrap topstrip-in">
    <span class="status" id="stripStatus"><span class="status-dot" aria-hidden="true"></span><span id="stripStatusText">Open every day, ${hoursText(cfg)}</span></span>
    <span class="strip-extra"><span>Collect in store for free</span><span>Postage ${money(cfg.postage)}</span>${cfg.payOnline ? "<span>Pay with Fleeca</span>" : ""}${dealOn(cfg.deal) ? `<span class="strip-deal">${esc(dealName(cfg.deal))}</span>` : ""}</span>
  </div>
</section>`;
}

export function header(root, { logo = "assets/flickers-logo.png", series = false } = {}) {
  const seriesLink = series ? `<a href="${root}series/">Series</a>` : "";
  return `<header class="site-header">
  <div class="wrap header-in">
    <a class="logo-link" href="${root || "./"}"><img class="logo" src="${root}${logo}" alt="Flickers Comics" width="640" height="104"></a>
    <div class="header-actions">
      <nav class="nav" aria-label="Main"><a href="${root}#shop">Shop</a>${seriesLink}<a href="${root}#how">How ordering works</a><a href="${root}#hours">Hours</a><button type="button" data-track hidden>Track order</button></nav>
      <button type="button" class="saved-btn" id="savedBtn" aria-haspopup="dialog" hidden>
        ${heartIcon}
        <span class="saved-word">Saved</span>
        <span class="saved-count" id="savedCount">0</span>
      </button>
      <button type="button" class="cart-btn" id="cartBtn" aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>
        <span class="cart-word">Cart</span>
        <span class="cart-count" id="cartCount">0</span>
        <span class="cart-total" id="cartTotal">$0</span>
      </button>
    </div>
  </div>
</header>
<nav class="subnav" aria-label="Main (small screens)"><a href="${root}#shop">Shop</a>${seriesLink}<a href="${root}#how">How it works</a><a href="${root}#hours">Hours</a><button type="button" data-track hidden>Track order</button></nav>`;
}

export function footer(root, cfg) {
  return `<footer class="site-footer">
  <div class="wrap footer-in">
    <img class="footer-logo" src="${root}assets/flickers-logo.png" alt="Flickers Comics" width="640" height="104" loading="lazy">
    <div class="footer-cols">
      <div><h2>Hours</h2><p>Every day, ${hoursText(cfg)}</p></div>
      <div><h2>Orders</h2><p>Collect in store: free<br>Postage: ${money(cfg.postage)}</p><p class="footer-track"><button type="button" class="link-btn" data-track hidden>Track an order</button><button type="button" class="link-btn" data-want="request" hidden>Request a comic</button></p></div>
      <div><h2>Payment</h2><p>${cfg.payOnline ? "Pay from your bank account<br>through Fleeca" : "Online payment through<br>Fleeca is coming soon"}</p></div>
    </div>
    <p class="fine">© Flickers Comics. All prices in dollars. <a class="footer-link" href="${root}admin/">Staff login</a></p>
  </div>
</footer>`;
}

/* Quick view, cart drawer, checkout and toast. Filled in by js/site.js. */
function dialogs(cfg) {
  return `<dialog class="qv" id="qv" aria-labelledby="qvTitle"><div id="qvBody"></div></dialog>

<dialog class="drawer" id="drawer" aria-labelledby="drawerTitle">
  <div class="drawer-head">
    <h2 class="dialog-title" id="drawerTitle">Your cart</h2>
    <button type="button" class="icon-btn on-dark" data-close aria-label="Close cart">${X}</button>
  </div>
  <div class="drawer-body">
    <ul class="lines" id="lines"></ul>
    <div class="cart-empty" id="cartEmpty" hidden>
      <p class="empty-title">Your cart is empty</p>
      <p class="hint">Add something from the shelves and it shows up here.</p>
      <button type="button" class="btn btn-yellow" data-close data-goto="shop">Browse the shelves</button>
    </div>
  </div>
  <div class="drawer-foot" id="drawerFoot">
    <div class="r-line"><span>Subtotal</span><strong id="drawerSub">$0</strong></div>
    <div class="r-line deal-line" id="drawerDealLine" hidden><span id="drawerDealName">Deal</span><strong id="drawerDeal">−$0</strong></div>
    <p class="deal-nudge" id="drawerNudge" hidden></p>
    <p class="hint">Choose collection or postage at checkout.</p>
    <p class="share-cart"><button type="button" class="link-btn" data-share-cart>Copy a link to this cart</button> <span class="hint">Send it to a friend and they get the same comics in their cart.</span></p>
    <button type="button" class="btn btn-yellow btn-block" id="checkoutBtn">Checkout</button>
  </div>
</dialog>

<dialog class="drawer saved" id="saved" aria-labelledby="savedTitle">
  <div class="drawer-head">
    <h2 class="dialog-title" id="savedTitle">Saved for later</h2>
    <button type="button" class="icon-btn on-dark" data-close aria-label="Close saved list">${X}</button>
  </div>
  <div class="drawer-body">
    <ul class="lines" id="savedLines"></ul>
    <div class="cart-empty" id="savedEmpty" hidden>
      <p class="empty-title">Nothing saved yet</p>
      <p class="hint">Tap the heart on a comic to keep it here. If it's sold out we'll flag it when it comes back.</p>
      <button type="button" class="btn btn-yellow" data-close data-goto="shop">Browse the shelves</button>
    </div>
  </div>
  <div class="drawer-foot" id="savedFoot">
    <button type="button" class="btn btn-yellow btn-block" id="savedAddAll">Add all available to cart</button>
    <p class="share-cart"><button type="button" class="link-btn" data-share-saved>Copy a link to this list</button> <span class="hint">Send it to a friend and they can save the same comics.</span></p>
  </div>
</dialog>

<dialog class="checkout" id="co" aria-labelledby="coTitle">
  <div class="co-head">
    <h2 class="dialog-title" id="coTitle">Checkout</h2>
    <button type="button" class="icon-btn on-dark" data-close aria-label="Close checkout">${X}</button>
  </div>
  <div id="coFormView">
    <p class="test-note" id="testNote"><strong>Test mode.</strong> Payments aren't connected yet, so test orders aren't charged and the shop isn't notified.</p>
    <form id="coForm" novalidate>
      <div class="co-grid">
        <div class="co-fields">
          <fieldset>
            <legend>Your details</legend>
            <div class="two">
              <div class="field">
                <label for="f-name">Full name</label>
                <input type="text" id="f-name" name="name" autocomplete="name" placeholder="e.g. Jamie Reyes" aria-describedby="e-name">
                <p class="error" id="e-name" hidden></p>
              </div>
              <div class="field">
                <label for="f-phone">Phone number</label>
                <input type="text" id="f-phone" name="phone" inputmode="tel" autocomplete="tel" placeholder="e.g. 5550142" aria-describedby="h-phone e-phone">
                <p class="hint" id="h-phone">So we can text you about your order.</p>
                <p class="error" id="e-phone" hidden></p>
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend>How do you want it?</legend>
            <div class="methods">
              <label class="method"><input type="radio" name="method" value="collect" id="m-collect" checked>
                <span class="method-text"><span class="method-name">Collect in store</span><span class="method-price">Free</span><span class="hint">Pick it up at the counter.</span></span></label>
              <label class="method"><input type="radio" name="method" value="post" id="m-post">
                <span class="method-text"><span class="method-name">Post it to me</span><span class="method-price">${money(cfg.postage)}</span><span class="hint">Sent to your address.</span></span></label>
            </div>
            <div class="field" id="collectPanel">
              <label for="f-date">When can you collect?</label>
              <input type="date" id="f-date" name="date" aria-describedby="h-date e-date">
              <p class="hint" id="h-date">We're open ${hoursText(cfg)} every day.</p>
              <p class="error" id="e-date" hidden></p>
            </div>
            <div class="field" id="postPanel" hidden>
              <label for="f-address">Delivery address</label>
              <textarea id="f-address" name="address" rows="3" autocomplete="street-address" placeholder="House or apartment number, street, area" aria-describedby="e-address"></textarea>
              <p class="error" id="e-address" hidden></p>
            </div>
          </fieldset>
          <div class="field">
            <label for="f-notes">Notes <span class="opt">(optional)</span></label>
            <textarea id="f-notes" name="notes" rows="2" placeholder="Anything we should know?"></textarea>
          </div>
        </div>
        <aside class="receipt" aria-labelledby="sumTitle">
          <h3 id="sumTitle">Order summary</h3>
          <ul class="sum-list" id="sumList"></ul>
          <div class="r-line"><span>Subtotal</span><span id="sumSub">$0</span></div>
          <div class="r-line deal-line" id="sumDealLine" hidden><span id="sumDealName">Deal</span><span id="sumDeal">−$0</span></div>
          <div class="r-line"><span id="sumShipLabel">Collection</span><span id="sumShip">Free</span></div>
          <div class="r-line r-total"><span>Total</span><span id="sumTotal">$0</span></div>
        </aside>
      </div>
      <div class="co-foot">
        <div class="foot-total"><span>Total</span><strong id="footTotal">$0</strong><span class="hint" id="payHint"></span></div>
        <p class="form-error" id="formError" role="alert"></p>
        <button type="submit" class="btn btn-yellow" id="payBtn">Place test order</button>
      </div>
    </form>
  </div>
  <div id="coDoneView" hidden></div>
</dialog>

<dialog class="checkout track" id="track" aria-labelledby="trackTitle">
  <div class="co-head">
    <h2 class="dialog-title" id="trackTitle">Track your order</h2>
    <button type="button" class="icon-btn on-dark" data-close aria-label="Close order tracking">${X}</button>
  </div>
  <div class="track-body">
    <form id="trackForm" novalidate>
      <p class="hint track-intro">Enter the order number from your confirmation and the phone number you gave when you ordered.</p>
      <div class="two">
        <div class="field"><label for="t-id">Order number</label><input type="text" id="t-id" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. FC-7K3PQ2"></div>
        <div class="field"><label for="t-phone">Phone number</label><input type="text" id="t-phone" inputmode="tel" autocomplete="tel" placeholder="e.g. 5550142"></div>
      </div>
      <p class="form-error" id="trackError" role="alert"></p>
      <button type="submit" class="btn btn-yellow" id="trackBtn">Check my order</button>
    </form>
    <div id="trackResult" hidden></div>
  </div>
</dialog>

<dialog class="checkout track want" id="want" aria-labelledby="wantTitle">
  <div class="co-head">
    <h2 class="dialog-title" id="wantTitle">Request</h2>
    <button type="button" class="icon-btn on-dark" data-close aria-label="Close">${X}</button>
  </div>
  <div class="track-body">
    <form id="wantForm" novalidate>
      <p class="hint track-intro" id="wantIntro"></p>
      <div class="field" id="wantTextField" hidden><label for="w-text">Which comic?</label><textarea id="w-text" rows="3" maxlength="300" placeholder="Title, issue number, and cover or variant if it matters"></textarea></div>
      <div class="two">
        <div class="field"><label for="w-name">Full name</label><input type="text" id="w-name" autocomplete="name" placeholder="e.g. Jamie Reyes"></div>
        <div class="field"><label for="w-phone">Phone number</label><input type="text" id="w-phone" inputmode="tel" autocomplete="tel" placeholder="e.g. 5550142"></div>
      </div>
      <p class="hint want-fine">We only use your details to get in touch about this, and delete them after a few months.</p>
      <p class="form-error" id="wantError" role="alert"></p>
      <button type="submit" class="btn btn-yellow" id="wantBtn">Send</button>
    </form>
    <div id="wantDone" hidden>
      <p class="eyebrow">All set</p>
      <h3 class="track-status" id="wantDoneTitle" tabindex="-1">You're on the list</h3>
      <p class="track-msg" id="wantDoneMsg"></p>
      <p><button type="button" class="btn btn-yellow" data-close>Back to the shop</button></p>
    </div>
  </div>
</dialog>

<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<button type="button" class="to-top" id="toTop" aria-label="Back to the top" hidden><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
}



/* ---------- product pieces ---------- */
/* the save-for-later heart: hidden until the script switches it on */
const heartButton = (p, t, cls = "heart") => `<button type="button" class="${cls}" data-save="${esc(p.id)}" aria-pressed="false" aria-label="Save ${esc(t)} for later" hidden>${heartIcon}</button>`;
export const comicUrl = (root, p) => `${root}comic/${p.id}/`;

function cardHTML(p, ctx, i) {
  const { root, cats, groupKey } = ctx;
  const t = fullTitle(p), url = comicUrl(root, p);
  const extras = [];
  if ((p.badges || []).includes("new") && p.stock > 0) extras.push("new");
  if (p.staff) extras.push("staff pick");
  if (p.stock <= 0) extras.push("sold out");
  const low = p.stock <= 0 ? `<span class="low">Sold out</span>` : p.stock <= 2 ? `<span class="low">Only ${p.stock} left</span>` : "";
  const soldOff = p.stock <= 0;
  return `<article class="card" data-id="${esc(p.id)}" data-group="${esc(groupKey(p))}" data-index="${i}">
    <a class="cover-btn" href="${url}" data-open="${esc(p.id)}" aria-label="${esc(t)}${extras.length ? ", " + extras.join(", ") : ""}. View details">
      ${coverHTML(p, { imgBase: root })}${stickerHTML(p)}${p.staff ? `<span class="talker" aria-hidden="true">Staff pick!</span>` : ""}
    </a>
    ${heartButton(p, t)}
    <div class="card-body">
      <p class="meta">${esc(metaLine(p, cats))}</p>
      <h3 class="title"><a href="${url}" data-open="${esc(p.id)}"><span class="clamp">${esc(t)}</span></a></h3>
      <p class="stock">${low}</p>
      <div class="buy">
        <span class="price-tag">${money(p.price)}</span>
        <button type="button" class="add" data-add="${esc(p.id)}" aria-disabled="${soldOff}" aria-label="${soldOff ? "Sold out: " : "Add to cart: "}${esc(t)}">${soldOff ? "Sold out" : "Add"}</button>
      </div>
    </div>
  </article>`;
}

/* ---------- pages ---------- */
export function homePage(ctx) {
  const { cfg, products, featured, groups, root = "" } = ctx;
  const byId = new Map(products.map(p => [p.id, p]));
  const hero = featured.map(id => byId.get(id)).filter(Boolean).slice(0, 3);
  const fan = hero.map((p, i) => `<a class="fan fan-${i + 1}" href="${comicUrl(root, p)}" data-open="${esc(p.id)}" aria-label="${esc(fullTitle(p))}. View details">${coverHTML(p, { imgBase: root, priority: i === 1, lazy: false, sizes: "(min-width: 860px) 200px, 40vw" })}</a>`).join("");
  const burst = `<svg class="burst" viewBox="-100 -100 200 200" aria-hidden="true"><polygon points="${burstPoints(0, 0, 66, 100, 22)}" fill="currentColor"/></svg>`;
  const total = products.length;
  const dividers = groups.length > 1
    ? `<button type="button" class="divider" data-group="all" aria-pressed="true">Everything<span class="n">${total}</span></button>` + groups.map(g => `<button type="button" class="divider" data-group="${esc(g.key)}" aria-pressed="false">${esc(g.label)}<span class="n">${g.count}</span></button>`).join("")
    : "";
  const cards = products.map((p, i) => cardHTML(p, ctx, i)).join("\n");
  return `<a class="skip" href="#shop">Skip to the shelves</a>
${topStrip(cfg)}
${header(root, { series: ctx.hasSeries })}
<main id="top">
  <section class="hero" aria-labelledby="heroTitle">
    <div class="wrap hero-in">
      <div class="hero-copy">
        <p class="eyebrow">Independent comic shop</p>
        <h1 id="heroTitle"><span class="mark">Comics</span> on the shelves now</h1>
        <p class="lede">Single issues in stock now. Order online, then collect at the counter or have it posted to you.</p>
        <div class="hero-actions">
          <a class="btn btn-yellow" href="#shop">Browse the shelves</a>
          <a class="btn btn-plain" href="#how">How ordering works</a>
        </div>
        <ul class="hero-facts">
          <li><strong>Open every day</strong> ${hoursText(cfg)}</li>
          <li><strong>Collect in store</strong> free</li>
          <li><strong>Postage</strong> ${money(cfg.postage)}</li>
          ${cfg.payOnline ? "<li><strong>Pay online</strong> with Fleeca</li>" : ""}
          ${dealOn(cfg.deal) ? `<li><strong>${esc(dealName(cfg.deal))}</strong> cheapest one's on us</li>` : ""}
        </ul>
      </div>
      ${hero.length ? `<div class="rack" id="rack" role="group" aria-label="New this week">${burst}${fan}<span class="rack-sticker" aria-hidden="true">New this week!</span></div>` : ""}
    </div>
  </section>

  <div class="ticker" aria-hidden="true"><div class="ticker-track">${ticker(cfg, hero.length > 0).repeat(2)}</div></div>

  <section class="shop" id="shop" aria-labelledby="shopTitle">
    <div class="wrap">
      <div class="section-head">
        <div>
          <h2 class="section-title" id="shopTitle">The shelves</h2>
          <p class="section-sub">Tap any cover for details.</p>
        </div>
        <div class="tools">
          <label class="search">
            <span class="sr-only">Search the shelves</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input type="search" id="q" placeholder="Search titles, issues, publishers" autocomplete="off" aria-keyshortcuts="/">
          </label>
          <label class="sort"><span>Sort</span>
            <select id="sort">
              <option value="featured">Featured</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="title">Title A–Z</option>
            </select>
          </label>
        </div>
      </div>
      ${filterChips(products)}
      ${dividers ? `<div class="dividers" id="dividers" role="group" aria-label="Filter by ${ctx.groupBy === "cat" ? "category" : "publisher"}">${dividers}</div>` : ""}
      <p class="results" id="results" aria-live="polite">${total} ${total === 1 ? "item" : "items"}</p>
      <div class="grid" id="grid">
${cards}
      </div>
      <div class="empty" id="empty" hidden>
        <p class="empty-title">Nothing matches that</p>
        <p>Try a different word, or <button type="button" class="link-btn" id="clearSearch">clear the search and filters</button>.</p>
        <p class="request-line" data-want-only hidden>Looking for something we don't stock? <button type="button" class="link-btn" data-want="request">Ask us to find it</button>.</p>
      </div>
      <p class="request-line request-end" data-want-only hidden>Can't find what you're after? <button type="button" class="link-btn" data-want="request">Request a comic</button> and we'll see if we can get it in.</p>
    </div>
  </section>

  ${howSection(cfg)}
  ${hoursSection(cfg)}
</main>
${footer(root, cfg)}
${dialogs(cfg)}`;
}

/* a handful of round price limits taken from what's actually on the shelves */
function priceSteps(products) {
  const all = products.map(p => p.price).sort((a, b) => a - b), top = all[all.length - 1];
  const distinct = [...new Set(all)].filter(x => x < top);
  if (distinct.length <= 5) return distinct;
  // limits at roughly the 20th, 40th, 60th, 80th and 90th percentile of what's on the shelves
  return [...new Set([0.2, 0.4, 0.6, 0.8, 0.9].map(q => all[Math.floor(q * (all.length - 1))]))].filter(x => x < top);
}
function filterChips(products) {
  const steps = priceSteps(products);
  return `<div class="chips" id="chips" role="group" aria-label="Narrow the shelves">
        <button type="button" class="chip" data-chip="instock" aria-pressed="false">In stock</button>
        ${products.some(isVariant) ? `<button type="button" class="chip" data-chip="novar" aria-pressed="false">Hide variants</button>` : ""}
        <button type="button" class="chip" data-chip="last" aria-pressed="false">Last copies</button>
        ${steps.length ? `<label class="chip chip-select"><span>Up to</span><select id="maxPrice" aria-label="Maximum price"><option value="0">Any price</option>${steps.map(s => `<option value="${s}">${money(s)}</option>`).join("")}</select></label>` : ""}
        <button type="button" class="link-btn" id="clearFilters" hidden>Clear filters</button>
      </div>`;
}

function howSection(cfg) {
  return `<section class="how" id="how" aria-labelledby="howTitle">
    <div class="wrap">
      <h2 class="section-title" id="howTitle">How ordering works</h2>
      <p class="section-sub">Four steps from the shelf to your hands.</p>
      <ol class="panels">
        <li class="panel"><span class="panel-n" aria-hidden="true">1</span><h3>Fill your cart</h3><p>Add what you want from the shelves. Each title shows when stock is running low.</p></li>
        <li class="panel"><span class="panel-n" aria-hidden="true">2</span><h3>Collect or post</h3><p>Pick a day to collect at the counter for free, or have it posted to you for ${money(cfg.postage)}.</p></li>
        ${cfg.payOnline
          ? `<li class="panel"><span class="panel-n" aria-hidden="true">3</span><h3>Pay from your bank</h3><p>Checkout takes you to Fleeca to pay from your bank account.</p></li>
        <li class="panel"><span class="panel-n" aria-hidden="true">4</span><h3>We get in touch</h3><p>We text you when your order is ready to collect or on its way.</p></li>`
          : `<li class="panel"><span class="panel-n" aria-hidden="true">3</span><h3>The shop gets it</h3><p>Your order reaches the shop straight away, with your details and what you chose.</p></li>
        <li class="panel"><span class="panel-n" aria-hidden="true">4</span><h3>We get in touch</h3><p>We text you about your order, including when it's ready to collect or on its way.</p></li>`}
      </ol>
    </div>
  </section>`;
}

function hoursSection(cfg) {
  const week = DAYS.map(d => `<li class="day"><b>${d}</b><span>${hoursShort(cfg)}</span></li>`).join("");
  return `<section class="hours" id="hours" aria-labelledby="hoursTitle">
    <div class="wrap hours-in">
      <div>
        <h2 class="section-title" id="hoursTitle">Opening hours</h2>
        <p class="big-hours">${hoursText(cfg)}</p>
        <p class="hours-note">Every day of the week. Collections happen during opening hours.</p>
        <p class="status-pill" id="hoursStatus"><span class="status-dot" aria-hidden="true"></span><span id="hoursStatusText">Open every day</span></p>
      </div>
      <ol class="week" id="week" aria-label="This week">${week}</ol>
    </div>
  </section>`;
}

export function comicPage(p, ctx, related) {
  const { cfg, cats, root } = ctx;
  const t = fullTitle(p);
  return `<a class="skip" href="#item">Skip to the comic</a>
${topStrip(cfg)}
${header(root, { series: ctx.hasSeries })}
<main id="item" class="item-page">
  <div class="wrap">
    <nav aria-label="Breadcrumb"><ol class="crumbs"><li><a href="${root}">Home</a></li><li><a href="${root}#shop">The shelves</a></li><li aria-current="page">${esc(t)}</li></ol></nav>
    ${detailHTML(p, cats, { imgBase: root, cover: { priority: true, sizes: "(min-width: 640px) 340px, 260px" }, buy: `<div class="qv-buy" data-buy="${esc(p.id)}">${p.stock <= 0 ? `<p class="qv-limit">This one is sold out.</p>` : ""}</div>` })}
  ${ctx.seriesOf && ctx.seriesOf[p.id] ? `<p class="series-link">One of ${plural(ctx.seriesOf[p.id].items.length, "issue")} of <b>${esc(ctx.seriesOf[p.id].title)}</b> in the shop. <a href="${seriesUrl(root, ctx.seriesOf[p.id])}">See the whole series</a></p>` : ""}
  </div>
</main>
${related.length ? `<section class="more" aria-labelledby="moreTitle"><div class="wrap">
  <h2 class="section-title" id="moreTitle">More from ${esc(p.publisher || "the shelves")}</h2>
  <div class="grid">${related.map((r, i) => cardHTML(r, ctx, i)).join("\n")}</div>
</div></section>` : ""}
${footer(root, cfg)}
${dialogs(cfg)}`;
}

/* ---------- series: every issue of a title on one page ---------- */
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const seriesUrl = (root, s) => `${root}series/${s.slug}/`;
function seriesFacts(s) {
  const inStock = s.items.filter(p => p.stock > 0), from = Math.min(...s.items.map(p => p.price));
  return `${plural(s.items.length, "issue")} · ${inStock.length ? `${inStock.length} in stock` : "all sold out"} · from ${money(from)}`;
}

export function seriesPage(s, ctx) {
  const { cfg, root } = ctx;
  return `<a class="skip" href="#series">Skip to the issues</a>
${topStrip(cfg)}
${header(root, { series: true })}
<main id="series" class="item-page">
  <div class="wrap">
    <nav aria-label="Breadcrumb"><ol class="crumbs"><li><a href="${root}">Home</a></li><li><a href="${root}series/">Series</a></li><li aria-current="page">${esc(s.title)}</li></ol></nav>
    <div class="series-head">
      <p class="eyebrow">Series</p>
      <h1 class="section-title">${esc(s.title)}</h1>
      <p class="section-sub">${esc(seriesFacts(s))}</p>
      <p class="series-follow"><button type="button" class="btn btn-small" data-want="series" data-id="${esc(s.items[0].id)}" hidden>Follow ${esc(s.title)}</button> <span class="hint" data-want-only hidden>We'll let you know when a new issue arrives.</span></p>
    </div>
    <h2 class="sr-only">The issues</h2>
    <div class="grid">${s.items.map((p, i) => cardHTML(p, ctx, i)).join("\n")}</div>
  </div>
</main>
${footer(root, cfg)}
${dialogs(cfg)}`;
}

export function seriesIndexPage(list, ctx) {
  const { cfg, root } = ctx;
  const tiles = list.map(s => {
    const lead = s.items.find(p => p.image) || s.items[0], t = `${s.title}, ${plural(s.items.length, "issue")}`;
    return `<article class="card">
    <a class="cover-btn" href="${seriesUrl(root, s)}" aria-label="${esc(t)}. See the series">${coverHTML(lead, { imgBase: root })}</a>
    <div class="card-body">
      <p class="meta">${esc(plural(s.items.length, "issue"))}</p>
      <h2 class="title"><a href="${seriesUrl(root, s)}"><span class="clamp">${esc(s.title)}</span></a></h2>
      <p class="stock">${esc(seriesFacts(s).split(" · ").slice(1).join(" · "))}</p>
    </div>
  </article>`;
  }).join("\n");
  return `<a class="skip" href="#series">Skip to the series</a>
${topStrip(cfg)}
${header(root, { series: true })}
<main id="series" class="item-page">
  <div class="wrap">
    <nav aria-label="Breadcrumb"><ol class="crumbs"><li><a href="${root}">Home</a></li><li aria-current="page">Series</li></ol></nav>
    <div class="series-head">
      <h1 class="section-title">Series</h1>
      <p class="section-sub">Titles with more than one issue on the shelves, all in one place.</p>
    </div>
    <div class="grid">${tiles}</div>
  </div>
</main>
${footer(root, cfg)}
${dialogs(cfg)}`;
}

export function notFoundPage(ctx) {
  const { cfg, root } = ctx;
  return `${topStrip(cfg)}
${header(root, { series: ctx.hasSeries })}
<main>
  <div class="wrap lost">
    <p class="eyebrow">Error 404</p>
    <h1>Not on the shelves</h1>
    <p class="lede">That page isn't here. The comic may have sold out and been taken down, or the link is wrong.</p>
    <a class="btn btn-yellow" href="${root}#shop">Browse the shelves</a>
  </div>
</main>
${footer(root, cfg)}
${dialogs(cfg)}`;
}

/* ---------- helpers ---------- */
function burstPoints(cx, cy, rIn, rOut, n, rot = 0) {
  const r1 = v => Math.round(v * 10) / 10, p = [];
  for (let i = 0; i < n * 2; i++) { const a = rot + Math.PI * i / n, R = i % 2 ? rIn : rOut; p.push(`${r1(cx + R * Math.cos(a))},${r1(cy + R * Math.sin(a))}`); }
  return p.join(" ");
}
