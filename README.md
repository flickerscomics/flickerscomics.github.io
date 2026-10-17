# Flickers Comics

Website for Flickers Comics, an independent comic shop on GTA World, live at https://flickerscomics.github.io/.
It's a static site hosted free on GitHub Pages. Every comic has its own page, and staff manage stock from a password-protected staff area.

## How it fits together

| Part | What it does |
| --- | --- |
| `data/` | The shop's content: `products.json` (stock), `featured.json` ("new this week"), `config.json` (postage, hours, categories, addresses). |
| `build/` | A small script that turns `data/` and `assets/` into the finished site in `dist/`: one page per comic, resized WebP covers, minified CSS and JavaScript, self-hosted fonts, sitemap. |
| `src/` | The site's CSS and JavaScript (`js/` is the storefront, one file per job: `site.js` starts it and handles clicks, `core.js` holds the shared state, then `cart`, `shelves` (search and filters), `buy`, `checkout`, `saved`, `wants`, `track` and `hours`; `admin/` is the staff area, one file per tab; `shared.mjs` is used by both and by the build). |
| `tests/` | Automated checks: the build, valid HTML, the staff service, the order pipeline and the wanted list. The deploy stops if any fail. |
| `qa/` | Browser checks (a real Edge or Chrome) for the shop and staff area. Run by hand, not part of the deploy. |
| `worker/` | The staff service (Cloudflare Worker): logins, publishing, and the order log with Discord. See `docs/SETUP.md` and `docs/DISCORD.md`. |
| `.github/workflows/deploy.yml` | Tests, builds and publishes the site on every push to `main`. |
| `assets/` | Logo, icons and the original cover photos (`assets/covers/`). |

## Changing stock

**In the staff area** (`/admin/`): sign in with your username and password, change prices and stock,
add or edit comics, then **Publish changes**. The site updates in a minute or two.

**Covers:** no need to save a picture to your computer first. In a comic's editor, drag a picture onto the cover, or copy one
(right-click it in the browser, **Copy image**) and press <kbd>Ctrl</kbd> + <kbd>V</kbd> (or click **Paste image**). You can also drop a picture
straight onto a comic's row in the stock list to replace its cover. Pictures are resized to 600px wide in your browser before they're saved,
and a cover nothing uses any more is removed when you publish.

To change many comics at once, tick them (or tick **Select all**, which respects your search; hold Shift to
select a range), then use the yellow bar to set a price, raise or lower prices by a percentage or an amount,
set stock, **set labels** (add or remove New, Variant, Exclusive and "New this week" on all of them at once; only three comics show in New this week, so adding more puts the selected ones first), or delete them. Nothing goes live until you publish, and **Discard** undoes everything.
If your session ends while you have unpublished changes, you are asked to sign in again and your changes are kept.

Above the list you can **Show** only low stock (1 or 2 left), sold-out comics, or comics you've changed but not yet published,
and **Sort** by title, price or stock. Select all then applies to whatever you're looking at.

**Orders** (staff area → **Orders**): every order is listed (newest first, 40 at a time; **Show older orders** loads more) with its customer, items and notes. Open an order and mark it
**ready**, **collected** (or **posted**), **paid**, or **cancelled**; each change is recorded with who made it and the order's
Discord post is updated to match. Finished orders move to the **Archive** and are deleted 14 days later.
**Download as spreadsheet (CSV)** keeps your own records.

Orders **take comics off the shelf automatically** (and cancelling puts them back), so stock stays right without anyone editing it.
Publishing from an out-of-date screen is safe: your edits are merged with what orders have changed since.
If the stock can't be updated (for example the GitHub token has expired) the order is still taken but flagged **Adjust stock**.

Customers can use **Track order** in the menu with their order number and phone number to see where their order is.

**By hand:** edit `data/products.json` on GitHub. One comic per line:

```json
{"id":"batman-423","cat":"issues","title":"Batman","num":"#423","variant":"Facsimile Edition","publisher":"DC Comics","price":400,"stock":11,"blurb":"…","badges":["new"],"image":"assets/covers/batman-423.jpg"}
```

- Required: `id` (lowercase letters, numbers, dashes; becomes the page address), `cat`, `title`, `price`, `stock`, `blurb`.
- Optional: `num`, `vol`, `subtitle`, `variant`, `collects`, `pages`, `grade`, `publisher`, `tagline`, `badges` (`new`, `variant`, `exclusive`), `staff` (a staff pick note), `image`, `added` (the day it was first published, set automatically; it drives "Newest arrivals").
- `cat` is one of `issues`, `graphic`, `tpb`, `omnibus`, `manga`, `funko`.
- Without `image`, the comic gets a plain typographic cover. Add the photo to `assets/covers/` and set `image` to use it.
- `data/featured.json` lists up to three ids shown at the top of the home page.
- If something is wrong, the build stops and says what; the live site stays as it was.

Opening hours, postage and the time zone used for the "Open now" badge are in `data/config.json`.

## Orders and payment

Online ordering is on (`testMode: false` in `data/config.json`, `ORDERS_ENABLED = "true"` in `worker/wrangler.toml`).
Every order is re-priced from the real catalog by the staff service, saved (staff area → **Orders**), and logged to a
Discord channel. Until online payment is switched on, orders are "payment pending" and the shop settles up with
the customer. Online payment through Fleeca (GTA World's bank) is built and switched off: see **Online payment with Fleeca** below
and `docs/FLEECA.md`. See `docs/DISCORD.md` to reconnect Discord or switch ordering off.

### Online payment with Fleeca

With it on, a customer order is saved and its comics held, then the customer is sent to Fleeca to pay. The order only reaches Discord
(and the sales report) once Fleeca confirms the payment. Fleeca tells the Worker with a signed webhook (`POST /fleeca/callback`) and sends the
customer's browser back to `GET /fleeca/return`, which sends them on to the shop (`/?order=FC-XXXXXX&status=paid|failed|pending`). Nothing the
browser says is trusted. Orders unpaid after 30 minutes are cancelled and their comics put back (a cron runs every 15 minutes). Orders staff key in
themselves never go through Fleeca. If a customer pays after their order was cancelled, the order is reopened if the comics are still there, otherwise
staff are told in Discord to refund them. Refunds are done by hand; the Worker never sends money (`/v2/transfers` is not used).

To turn it on, see **Online payment** in `docs/SETUP.md`. Everything works as before while it is off or the key isn't set.

**Shareable carts:** the cart has a "Copy a link to this cart" button. Opening such a link (`/?cart=batman-14:2,flash-3:1`, comic id
and quantity) adds those comics to the visitor's own cart, skipping anything sold out. Handy for setting a stack aside for a customer
over the phone: build the cart, copy the link, send it.

**Smart search and filters:** search understands partial words and issue numbers ("bat 14" finds Batman #14), ignores case and
punctuation, and forgives typos when nothing matches exactly. Chips narrow the shelves to In stock, Hide variants, Last copies
(1 or 2 left) and a price limit; they're saved in the address so a filtered shelf can be shared.

**Saved for later:** every comic has a heart. Saved comics live in the visitor's browser (nothing is sent to the shop), show up under
**Saved** in the header, can be added to the cart in one go, shared with a link, and are flagged **Back in stock** if they sold out
after being saved.

**The wanted list** (staff area → **Wanted**): customers can leave a name and phone number to
- be told when a **sold-out comic is back** (*Notify me*),
- **follow a series** so staff know to set aside each new issue (a pull list), or
- **request a comic** the shop doesn't stock.

New requests post to the orders Discord channel. When you restock a sold-out comic (or a cancelled order frees one), or add a new
issue of a followed series, Discord lists exactly who to contact and the Wanted tab flags them "Ready to contact". Mark them contacted
or remove them there. Nobody is texted automatically; staff make the call. Requests are deleted after 120 days.

Customers can share a shelf with a link: `/?shelf=DC+Comics&sort=price-asc`. Pressing <kbd>/</kbd> jumps to the search box.

**Buy two, get one free:** every comic counts. Lined up from dearest to cheapest and taken three at a time, the cheapest of each three
is free (so 6 comics make 2 free ones). The cart nudges ("Add 1 more comic and the cheapest one is free"), checkout and the
confirmation show the saving, and the Worker works the discount out itself, so a browser can't change it. The Discord post, the
staff Orders list, the spreadsheet and the customer's tracking page all show it. Change or switch it off in `data/config.json`:

```json
"deal": { "enabled": true, "buy": 2, "free": 1 }
```

**Low-stock alerts:** when an order leaves a comic with its last copy, or none, a message goes to the orders Discord channel
(pinging the staff role if one is set) so you can reorder before it's gone.

**Series pages:** a title with two or more issues on the shelves gets a page listing every issue in number order (`/series/batman/`),
a "Series" link in the menu, a list of all series, a "See the whole series" link from each issue, and a Follow button. They appear
on their own as you add issues; nothing to set up.

**Sales** (staff area → **Sales**, owner only): takings, orders, copies sold, average order, how much the deal gave away, best sellers,
takings by week and how long orders take to hand over, for the last 4 weeks up to a year. It's built from a small record kept for each
order (what was bought and when, never who by) that outlives the order itself, so the history lasts after finished orders are deleted.

## Staff tools

- **Daily briefing** (Discord): at 19:00 UTC (8 PM UTC+1) the Worker posts "Tyler here, here's today's briefing" with what needs doing (open orders, collections due, orders to post, payments to check, comics back in stock with people waiting, nearly gone, sold out), pinging the Staff role. Orders that go overdue get one ping each in the orders channel. Details in `docs/DISCORD.md`.

- **Take an order** (Orders tab → **+ Take an order**): for phone orders and people at the counter. Search for the comics, add them, enter a name
  (a phone number is optional), and choose *Counter sale: handed over now*, *Collect later* or *Post it*. It becomes a normal order: the shelf is
  updated from the real stock, the deal applies, it's posted to Discord (without pinging the staff role, since staff keyed it in), it counts in
  the Sales tab, and it shows who entered it. A counter sale goes straight to the Archive as collected (and paid, if ticked).
- **Finding and working orders** (Orders tab): search by order number, name or phone number (any way it's written); narrow to *Not paid*, *Due today*
  or *To post*; a strip at the top counts today's collections and any earlier ones not picked up. **Copy message** gives a ready-to-send text for
  the order's stage ("Your order FC-… is ready to collect on Mon 5 Oct…"); the Wanted tab has the same for people waiting on a comic.
  **Save receipt** (one order) or **Save receipts** (everything shown) draws each order as a picture of a till receipt and saves it as a PNG in your Downloads
  folder: 576 px wide (an 80 mm roll at 203 dpi), monospaced type, dashed rules, the shop name, order number, customer, how it goes out, the comics with prices
  lined up on the right, the deal, postage, total, and whether it's paid. Several orders are stacked into one tall picture with a cut line between them. Open the
  picture to print it, or send it on. Code: `src/admin/receipt.js`.
- **Reorder** (Reorder tab): comics that are sold out, down to their last two, or wanted by more people than there are copies, with who's waiting,
  what sold over the last eight weeks, and a suggested number (enough for the people waiting plus about two weeks of sales, less what's on the shelf).
  Change numbers, untick rows, then **Add to stock** to put what has arrived back on the shelf (it adds to the live stock, and anyone waiting for a comic that's back is flagged in Discord), or download the list as a spreadsheet for your supplier. Things customers requested that you don't stock are listed below.
- **Receive shipment** (Stock tab): tap +1 or +5 on a search result, or paste a list. One comic per line with the number that arrived works however
  it's written (`Batman #14, 5`, `Flash #2 x3`, `5 x Saga #1`, `batman-14<TAB>5`) as do a spreadsheet's rows with a Title and Quantity column. Lines that
  match more than one comic ask which; lines that match nothing are flagged. Applying adds the copies to the stock list as ordinary unpublished
  changes (with an option to mark them New), ready to publish.

## Working on the site

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm test            # checks the build, the HTML, the staff service and orders (about 10 seconds)
npm run build       # writes dist/
npm run serve       # preview at http://localhost:8080
```

The first build encodes every cover (a minute or so); later builds reuse the results kept in `.cache/` and take seconds.
The browser checks in `qa/` (see its README) exercise the shop and staff area in a real browser.

To try the staff area locally without Cloudflare, see the last section of `docs/SETUP.md`.
