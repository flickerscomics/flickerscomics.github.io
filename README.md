# Flickers Comics website

This is the website for **Flickers Comics**, an independent comic shop on GTA World.

**Live site:** https://flickerscomics.github.io/
**Staff area:** https://flickerscomics.github.io/admin/ (staff only, needs a username and password)

## What it is

An online shop window for the store. Customers can look through the comics we have in stock, order them, pay for them online, and then either
collect them at the counter or have them posted. Staff run the whole thing from a private staff area: no coding needed.

## What customers can do

- **Browse and search.** Every comic has its own page with a cover, description and price. Search suggests comics as you type and forgives typos,
  and you can narrow things down by type, publisher, price, or "in stock only". There's a "Newest arrivals" sort too.
- **Order.** Add comics to a cart, choose *collect in store* (free) or *post it to me* ($1,000), and pay through **Fleeca**, GTA World's bank.
  Buy two comics and get the cheapest of every three free.
- **Track an order.** Enter the order number and phone number to see if it's new, ready, or done.
- **Save comics for later**, share a cart with a friend by link, or **follow a series** so staff know to put new issues aside.
- **Ask for a comic we don't stock**, or ask to be told when a sold-out comic is back.

## What staff can do (in the staff area)

- **Stock:** add or edit comics, change prices and copies, drop in cover pictures, and update lots of comics at once. Nothing goes live until you press **Publish changes**.
- **Orders:** see every order, mark it ready, collected, posted, paid or cancelled, take phone and counter orders, and save a receipt as a picture.
- **Wanted:** see who's waiting for a comic or asked for something special, and who to contact.
- **Reorder:** see what's sold out or running low, and add comics back to the stock when a delivery arrives.
- **Sales:** see takings, best sellers and how busy the shop has been (owner only).
- **Discord:** every order, request and low-stock warning is posted to the shop's Discord. Each evening a **daily briefing** lists what needs doing.

## How it works, in plain words

There are three parts that work together:

1. **The website** is a set of ready-made pages that anyone can visit. It's hosted free on GitHub. Each time something changes, GitHub quickly rebuilds the
   pages, so the site updates within a minute or two.
2. **The back office** (a small online service on Cloudflare) does the things the public must not be able to touch: staff logins, taking orders, checking
   prices, keeping the stock right, talking to Fleeca and to Discord.
3. **Discord and Fleeca** are outside services. Discord tells staff what's happening. Fleeca takes the payment.

**What happens when someone orders:**

1. The customer fills in their details and presses pay. The back office double-checks the prices and sets the comics aside so nobody else can buy them.
2. The customer is sent to Fleeca to pay.
3. Fleeca tells the back office the payment went through. Only then does the order appear in Discord and count as a sale.
4. Staff get the order in Discord and in the staff area, get the comics ready, and mark it ready. The customer collects it or it's posted.
5. If nobody pays within 30 minutes, the order is cancelled and the comics go back on the shelf by themselves.

## Things that need looking after

- **The GitHub token** lets the back office update the stock. It **expires on 3 December 2026**. About two weeks before, the daily briefing in Discord will remind you.
  Renewing it is covered in `docs/SETUP.md`.
- **Secrets** (the Fleeca key, the Discord links, the staff login keys) live safely in Cloudflare, never in this folder. Don't paste them into chats or files.
- **Prices and hours** (postage, opening hours, the "buy 2 get 1 free" deal) are in `data/config.json`. Stock and prices for each comic are managed in the staff area.

## If something looks wrong

| What you see | What to check |
| --- | --- |
| The site isn't showing the latest stock | Wait a couple of minutes after publishing, then refresh. The **Actions** tab on GitHub shows if a rebuild failed. |
| An order seems stuck on "Awaiting payment" | Open it in the staff area and press **Check payment**. If you can see the money arrived in Fleeca, press **Mark paid (manual)**. |
| Orders aren't reaching Discord | See `docs/DISCORD.md`. |
| Stock stopped updating after an order | The GitHub token may have expired (see above). The order still arrives, flagged **Adjust stock**. |
| You can't sign in to the staff area | Too many wrong tries locks it for a while. Wait, or ask whoever looks after the back office to reset it. |

## For developers

The technical details have moved out of the way, so this page can stay simple:

- `docs/DEVELOPERS.md`: how the code is organised, the data format, building and testing.
- `docs/SETUP.md`: setting up the back office, the secrets, and renewing the GitHub token.
- `docs/DISCORD.md`: the Discord messages and how to reconnect them.
- `docs/FLEECA.md`: how online payment works.
- `qa/README.md`: the browser checks.
