# Cardano paid calls

Implemented for x402 v2 exact ADA on Cardano Preprod. A live-chain demonstration
is still required. Local integration tests use a real PostgreSQL database and
HTTP requests with simulated facilitator/chain responses; chain-evidence tests
exercise real Cardano CBOR decoding against Blockfrost response fixtures.

## Configuration and wallet

Start PostgreSQL with `docker compose up -d postgres`. Fill `.env` using
`.env.example`, including the dashboard/session/encryption secrets,
`KEYCARD_PAY_TO` (a provider-controlled Preprod address) and
`BLOCKFROST_PROJECT_ID`. Listing prices and quotes use canonical integer lovelace
amounts without an exchange-rate dependency. Start the server with `npm run dev:api`; startup applies
additive schema changes. Register a provider listing and check its preview before
paying. Current quotes use a configured 1.5 ADA output floor by default; the wallet
SDK uses live protocol parameters and refuses outputs below the chain minimum.

Create a dedicated wallet with explicit budgets (amounts include service + fees):

```sh
npm run agent:wallet -- init 3000000 15000000
npm run agent:wallet -- info
```

The mnemonic, limits, and payment journal live in ignored `.keycard-agent/` with
owner-only permissions. Override the location using `KEYCARD_AGENT_WALLET_DIR`.
Wallet `info` reports the Preprod address and reads the balance when Blockfrost is
configured. Funding is optional for setup, but paid calls require sufficient
Preprod ADA for the service amount and fee. The reference client uses a local
mnemonic signer; interactive CIP-30 support remains a separate integration.

Generate and keep a request ID, then make a call:

```sh
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
npm run agent:wallet -- call 'http://127.0.0.1:4020/api/proxy/LISTING/OPERATION?city=Singapore' REQUEST_ID
# POST example (use the operation's actual input schema)
npm run agent:wallet -- call 'http://127.0.0.1:4020/api/proxy/LISTING/OPERATION' REQUEST_ID POST '{"city":"Singapore"}'
```

Choose one command for each new operation; rerun its identical URL, method, body,
and ID on retry. The CLI saves signed bytes and reserves the service amount plus
actual transaction fee **before** sending payment. It polls pending calls for a
bounded period. A later invocation resumes from the journal without signing again.
Limits are cumulative across journal history, rather than reset per process.
Conservative reservations remain after failures/refunds; only change limits after
reviewing receipts. Never delete the journal or use a second wallet to bypass the
budget. A crashed CLI may leave `wallet.lock`; inspect its recorded PID and confirm
no wallet process remains before removing that stale lock. Keep the journal.

## HTTP contract and durable state

`/api/proxy/:listingId/:operationId` requires a secret random `Idempotency-Key`
containing 32–128 URL-safe characters, including on the initial unpaid request.
The key is a bearer capability for the cached result. Store it privately and reuse
it with the identical request. Changing request inputs produces `409`.

| Response | Meaning and action |
| --- | --- |
| `402` + `PAYMENT-REQUIRED` | Fixed, five-minute quote; build and sign once. |
| `200` + `PAYMENT-RESPONSE` | Payment confirmed; API result and KeyCard receipt returned. |
| `202` + `Retry-After` | Payment or another worker is in progress; retry same key and request. |
| `503` during verification | Retry the same key/payment; no settlement requested yet. |
| `410` while still quoted | Quote expired before verification; start a fresh unpaid call. |
| `400` / `409` | Invalid evidence, changed inputs, replacement payment, or replay; do not pay again. |
| Upstream failure or provider review | Result is retained; inspect the receipt and reconcile. |

Lifecycle: `quoted → verified → executing → result_ready → settling → completed`.
The server verifies, performs the upstream operation, durably saves its result,
then requests settlement. It returns that result only after confirmation. The
same transaction resumes settlement and skips verification of now-spent inputs.
Independent Blockfrost evidence checks canonical hash, successful ledger inclusion,
one newer block, recipient, asset, and amount. A timeout or unrecognized settlement
error stays pending and never becomes a fresh payment challenge.

Session-level PostgreSQL advisory locks serialize a call across server processes.
Transaction claims, response/receipt updates, and accounting commit atomically;
a canonical transaction can satisfy only one payment or refund. Responses and
claims must be retained to preserve replay protection. Do not purge these records
without a replacement permanent transaction ledger.

If a worker crashes during an upstream operation, its outcome may be ambiguous.
The next retry enters `review` instead of repeating a potentially mutating API
call. If chain evidence subsequently confirms payment, a full service refund is
due. Recovery after settlement never reruns an already saved upstream result.

## Failure, refund, and payout policy

Normal upstream failures occur before settlement: KeyCard does not broadcast or
charge the signed transaction. If the payer independently broadcasts, or a crash
leaves a confirmed transfer with a failed/ambiguous resource outcome, authenticated
chain reconciliation records `refundStatus: due`. Providers must return the full
quoted service amount to the facilitator-verified payer address. Chain fees remain
with the network. This release uses provider-issued refunds rather than reusable
account credit or automatic custody/signing of refunds.

The provider dashboard displays received amount, earnings from completed calls,
pending calls, review calls, refunds due, and refunded amount. Payouts happen
**directly to the provider's quote address**; there is no second platform transfer
or platform fee. Every receipt includes the actual transaction and payout address.
The latest 100 receipts are shown; summary totals include the full history.

Provider endpoints require the provider session; POST also requires same origin:

- `GET /api/provider/earnings`
- `GET /api/provider/payments`
- `POST /api/provider/payments/:receiptId/reconcile`: read chain evidence, update
  pending/failed/review records; never initiate another payment or upstream call.
- `POST /api/provider/payments/:receiptId/refund` with `{ "transaction": "HASH" }`:
  verify a full, confirmed Preprod transfer to the payer, at or after the original
  payment, then record it once. The dashboard offers this after refund is due.

Reconciliation currently runs on client retries or the provider's explicit check.
There is no unattended reconciliation worker. Ambiguous settlement with no chain
record remains pending for investigation; do not create a replacement payment.
Receipts from calls made before this durable ledger was introduced require manual
reconciliation using the original signed payload/request and confirmed transaction.
The old middleware did not store a recoverable API response.

## Verification and live acceptance

```sh
npm test
npm run test:payments
npm run build
```

`test:payments` uses local PostgreSQL on port 5433 by default, creates a random test
schema, and removes only that schema afterwards. Alternatively run the full suite
with `KEYCARD_TEST_DATABASE_URL` set to a dedicated PostgreSQL URL. It covers fixed
quotes, success, timeout recovery, post-expiry pending recovery, invalid evidence,
insufficient funds, request mismatches, global transaction replay, concurrent
retries, upstream failure, crash review, and refund transaction reuse. Wallet tests
exercise actual local address derivation, journal persistence, locking, and limits.
They do not submit funded transactions to Preprod.

Live acceptance still requires funded Preprod UTXOs, working quote/chain keys,
a provider payout address, and a valid upstream credential. Make one real call,
record the receipt and result, verify its explorer transaction, and repeat the same
command to confirm the receipt/result stay identical and only one transfer exists.
Reconcile the earlier confirmed-but-402 payment separately; do not charge again.

References: [Cardano exact scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md) and
[Blockfrost API](https://docs.blockfrost.io/).
