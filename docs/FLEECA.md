# Fleeca Payment Gateway (V2): reference for Flickers Comics

Read from banking.gta.world (Gateway Documentation, API Explorer and Merchant Center) on 12 October 2026. Use **V2** only. The old V1 gateway
(`/gateway_token/...`, `/api/v1/payouts`) is being retired. How the shop uses this: `worker/src/fleeca.js` (client, signature check) and
`worker/src/payments.js` (webhook, return page, abandoned-order sweep). Setup steps: `docs/SETUP.md`.

## The basics

| | |
|---|---|
| Base URL | `https://banking.gta.world/api` |
| Auth | `Authorization: Bearer <MERCHANT_API_KEY>` on every call |
| Money | Whole dollars as integers. Min 1, max 99,999,999 |
| Rate limit | **10 requests per minute per API key**, across all `/api/v2/*` calls (HTTP 429 over it) |
| Modes | `mode: 0` sandbox (fake, always succeeds, no money moves), `mode: 1` live |

The API key is a secret. It both calls the API **and signs webhooks**, so it lives only in the Worker (`wrangler secret put FLEECA_API_KEY`).
Sandbox uses the same key as live; there is no separate test key.

## Merchant Center (`https://banking.gta.world/merchant-center`)

Generate the key and set two addresses on it (changeable later without a new key):

- **Redirect URL**: where the customer's browser goes after paying. Fleeca adds only `?payment_id=<uuid>` (no status, no order number).
- **Callback URL**: where Fleeca POSTs the signed webhook.

## How a payment works

1. Customer checks out. The Worker calls `POST /v2/payment` and gets `payment_id` and `payment_link`.
2. The customer is sent to `payment_link` (they must be logged in to Fleeca banking and choose an account).
3. Fleeca POSTs a signed webhook to the Callback URL, and returns the browser to the Redirect URL with `?payment_id=`.
4. Optionally `GET /v2/payments/{payment_id}` confirms the status.

**Trust the webhook or the GET, never the browser return.** Anyone can type a URL with `?payment_id=` on it.

## Endpoints used

- `POST /v2/payment` body `{ "amount": 1250, "mode": 0, "description": "Flickers Comics order FC-ABC234" }` answers 201 with `payment_id` and `payment_link`.
  Errors: 401 bad key, 422 bad input, 429 rate limit.
- `GET /v2/payments/{payment_id}` answers `data` with `payment_id, amount, description, status, mode ("live"/"sandbox" as a word), payer_routing, payer_name, paid_at`.
- Not used: `/v2/balance`, `/v2/transactions`, `/v2/payments` (list).
- **Never used:** `/v2/transfers` (it sends real money out of the shop account). Refunds are done by hand.

## Statuses

`pending` (being processed), `payment_successful`, `payment_failed`. Before the customer acts a payment is simply awaiting payment.

## The webhook

Headers `Content-Type: application/json` and `X-Fleeca-Signature: sha256=<hex HMAC>`. Body: `payment_id, payment_url, mode ("sandbox"/"live"), amount,
payer_routing, payer_name, status, description, created_at, paid_at`.

Check: `"sha256=" + hex(HMAC-SHA256(key = API key, message = the raw request body))`, compared in constant time with the header. Wrong: reply 403 and ignore.
Use the raw body text exactly as received (do not re-serialise parsed JSON).

Rules: reply 200 quickly; the same webhook can arrive more than once (staff can "resend"), so handle repeats safely; check that `amount` matches the order and
`mode` matches what's expected (a sandbox payment must never mark a live order paid); a missed webhook can be resent from the Merchant Center (max 10 a minute)
or fetched with the GET.

## Other limits

Customer pressing Pay: 5 per minute per user. Resend callback: 10 per minute per merchant. Reveal API key: 20 per minute per merchant.
