# Logging orders to Discord

Every order is posted to a Discord channel you choose, as a message like this:

> **Order FC-7K3PQ2 · $1,400**
> New order to **collect** in store.
> Customer, phone, collection day (or postal address), the comics and quantities, totals, notes.

The post is **edited as staff work the order**: its title, colour and payment line change as it goes New, Ready,
Collected (or Posted) or Cancelled and Paid. When an order is marked **Ready**, a short follow-up message is also posted
(pinging the staff role if you've set one) so someone remembers to contact the customer.

Orders are also saved and listed in the staff area under **Orders**, so nothing is lost if Discord
has a bad day. The message is sent by a **webhook**: a private address that lets the shop post into one channel.
No bot needs hosting or keeping online.

Customers can't order online until you switch it on (step 4). Until then everything below can be set up and tested safely.

## 1. Make the webhook (2 minutes, in Discord)

1. Open your server, then the channel where orders should appear (make it private to staff).
2. Click the **gear** next to the channel name → **Integrations** → **Webhooks** → **New Webhook**.
3. Name it `Flickers Orders`, make sure the right channel is selected, and click **Copy Webhook URL**.

**Treat that URL like a password.** Anyone who has it can post into the channel. If it ever leaks, delete the webhook
in the same screen and make a new one.

## 2. Give it to the Worker

In PowerShell, in the `worker` folder:

```powershell
npx.cmd wrangler secret put DISCORD_WEBHOOK_URL
```

Paste the URL when it asks. The paste is hidden, and it goes straight to Cloudflare, not into the repository.

## 3. Test it

Sign in to the staff area, open **Orders**, and click **Send a test message to Discord**. A message marked **TEST**
should appear in your channel straight away. If it says it couldn't post, the webhook URL was copied wrongly or was deleted.

*Optional:* to ping your staff role on every real order, add its id to `worker/wrangler.toml`
(`DISCORD_PING_ROLE = "..."`; in Discord turn on Developer Mode, then right-click the role → Copy Role ID) and run `npx.cmd wrangler deploy`.
Test messages never ping anyone.

## 4. Switch on online ordering (when you're ready)

This makes checkout real for customers. Do both:

1. In `worker/wrangler.toml` change `ORDERS_ENABLED = "false"` to `"true"` and run `npx.cmd wrangler deploy` in the `worker` folder.
2. In `data/config.json` change `"testMode": true` to `false` and commit. The site rebuilds in a minute or two.

Then checkout says **Place order** (not "Place test order"), the shop gets every order in Discord, and the
confirmation page tells the customer "The shop has your order." To switch back, reverse both changes.

Until Fleeca is connected, orders are logged as **Payment pending**: the shop and customer sort out payment themselves.
With Fleeca payments on (`docs/SETUP.md` → Online payment), a customer's order is **not posted here until it's paid**. The post then says
"Paid via Fleeca by <name>". Staff also get a message here if a payment looks wrong (wrong amount or mode) or arrives for a comic that has since sold.

## Posting commits to a channel

Every push to `main` (staff stock publishes, the automatic stock commits from orders, and code changes) can be posted to a
Discord channel by `.github/workflows/discord-commits.yml`. Use a **staff-only** channel: commit messages include order
numbers and staff usernames.

1. In Discord make a webhook for that channel (channel gear → Integrations → Webhooks → New Webhook → Copy Webhook URL).
2. In GitHub open the repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
   Name it `DISCORD_COMMITS_WEBHOOK` and paste the URL as the value. It's stored encrypted and never appears in the code or logs.
3. Open the **Actions** tab → **Commits to Discord** → **Run workflow** to send a "Connected" test message.

Without the secret the workflow does nothing. To stop the posts, delete the secret.

## What the Worker checks

- Prices, titles and stock come from the shop's own published data. The browser only says which comics and how many,
  so a customer can't change a price.
- Orders for sold-out, missing or over-stock comics are refused with a clear message.
- Phone, name, collection day (within the allowed window) and address are checked.
- One connection can place 5 orders every 10 minutes.
- Customer text can't ping `@everyone`, other people or roles, and Discord formatting in it is neutralised.
- The webhook URL is never sent to a browser or written to a log.

## Good to know

- **Stock goes down automatically.** When an order is placed, the Worker takes those comics off the shelf by committing to
  `data/products.json` (the commit message names the order number only, never the customer). The check uses the real stock in
  GitHub, so two customers can't both buy the last copy. **Cancelling an order puts the comics back**; reopening a cancelled
  order takes them off again (and is refused if they've since sold out). The public site catches up when it rebuilds, a minute or two later.
- **If the GitHub token expires** (or GitHub is down), orders are still accepted so you don't lose sales, but they're flagged
  "Adjust stock" in the staff area and on the Discord post, and you change the stock by hand under **Stock**.
- **Publishing while orders arrive is safe.** If an order changed the stock after you loaded it, your edits are merged onto the
  latest stock instead of overwriting it.
- **Working through orders:** in the staff area's **Orders** tab, mark an order ready, collected or posted, paid, or cancelled.
  Each change is kept in the order's history (who and when) and updates the Discord post.
- **The Archive:** finished orders (collected, posted or cancelled) move from **Open** to **Archive** and are **deleted 14 days
  after they finished**. Reopen one to move it back. Open orders are kept for up to 90 days.
- **Customers can track an order** from the *Track order* link in the site's menu, with the order number and the phone number
  they gave. They see its stage (Received, Ready, Collected or Posted), the items, total and payment, nothing else.
  A link like `/?track=FC-7K3PQ2` opens the form with the number filled in. Lookups are limited to 12 per 10 minutes per connection.
- **The wanted list** (Notify me, Follow a series, Request a comic) posts to this same channel, quietly (no role ping) when a
  customer asks. It pings the staff role, if set, only when there's someone to contact: a sold-out comic is back, or a new issue
  of a followed series was added. Names and phone numbers are kept 120 days, or until removed in the staff area's **Wanted** tab.
- **Low-stock alerts** come to this same channel: "Stock running out" when an order leaves a comic with one copy, "Sold out" when it
  leaves none. They ping the staff role, if set. Only customer orders trigger them (not your own edits in the Stock tab).
- **The deal** (buy two, get one free) shows on each order's post as its own line, e.g. "Buy 2, get 1 free: −$300".
- **Lists load a page at a time.** The Orders and Wanted tabs show the newest 40 and a **Show older** button, so they stay quick (and inside Cloudflare's free-plan limits) however many have built up.
- **Customer details are stored** (name, phone, address) while the order is kept. Delete a Discord message by hand if you want it gone there.
- **Trying it locally without Discord:** `npm run dev:api` prints each order's Discord message in the terminal instead of sending it.
  Build the site with `ORDERS_LIVE=1 ORDER_API=http://localhost:8787/orders ADMIN_API=http://localhost:8787 npm run build`, then `npm run serve`.

## The daily briefing

Every day at **19:00 UTC (8 PM UTC+1)** the Worker posts one "Daily briefing" message to the same channel: open orders (new and ready, and the oldest),
collections due or overdue, orders to post, orders not paid yet, payments to check, comics that are back in stock with people waiting, comics nearly gone,
how many are sold out, special requests, and online orders waiting on Fleeca. It posts even on a quiet day. If `DISCORD_PING_ROLE` is set it pings
the role only when something is due, needs checking, or has people waiting. The time is the cron in `worker/wrangler.toml` (`0 19 * * *`, always UTC,
so after the clocks go back it is 7 PM in London); change it there and deploy. Code: `worker/src/briefing.js`. It reads the newest 30 orders, so on a very busy day the footer says so.
