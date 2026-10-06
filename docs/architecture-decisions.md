# KeyCard MVP decisions

Status: Phase 1 decisions recorded on 2026-10-07. This is a test-network MVP
plan; it is not a production payment recommendation.

## Application stack

- Keep the existing Vite and vanilla JavaScript landing page.
- Add a Node.js 24 + TypeScript + Express resource server. Use the official
  `@x402/express`, `@x402/core`, and `@x402/cardano` packages, pinned together
  at 2.26.0 for the initial integration because that is the compatibility
  target documented by the Cardano Foundation facilitator.
- Use PostgreSQL for listings, quotes, payment receipts, idempotency, and
  sponsor budget reservations. Those records need uniqueness and atomic
  updates as payment retries and sponsor redemptions are added.
- Use Docker Compose for the local application, database, and optional local
  facilitator. Choose a production hosting provider after the test-network
  flow works; this does not block local development.

## Cardano and x402

- Use Cardano Preprod (`cardano:preprod`) for all payment development.
- Implement x402 v2 `exact` with the `default` address-to-address transfer
  method. The first release accepts ADA, represented as `lovelace`; Masumi
  escrow and arbitrary script payments are outside this MVP.
- Use CIP-30 browser wallets for interactive signing. The payer signs the
  transaction in their wallet; KeyCard and the facilitator never receive the
  payer's private keys or mnemonic.
- Use the Cardano Foundation's hosted Preprod facilitator for the first local
  integration (`https://x402.preprod.dev.ecosyseng.cf-deployments.org`). Use
  Blockfrost Preprod for KeyCard's own protocol-parameter lookups; keep its
  project ID server-side as `BLOCKFROST_PROJECT_ID`. A self-hosted facilitator
  can reuse that provider configuration.
- Follow x402's Cardano authorization flow: verify the signed payment, run the
  protected operation, then settle through the facilitator. Require one L1
  confirmation before returning a successful paid response. Reconcile retries
  with the same signed payment and idempotency record.
- Cardano's minimum output value applies to ADA payments. The server must
  derive the live minimum from protocol parameters and reject or adjust any
  quote that cannot form a valid output. Transaction fees are paid by the
  payer and shown separately from the service price. Do not promise ADA
  micropayments below the live minimum.

## API and pricing MVP

- Use OpenWeather One Call API 4.0 as the first keyed upstream service, with a
  fixed-price current-conditions operation. Its current price page lists the
  first 1,000 calls per day as free and each additional call at USD 0.0015;
  using the pay-per-call product requires an enabled account. The provider
  supplies and controls the API key.
- Use FreeCryptoAPI's `/getConversion?from=ADA&to=USD&amount=1` endpoint
  for explicit ADA/USD conversion, authenticated with a server-side Bearer key
  (`FREECRYPTOAPI_API_KEY`). Cache the rate for at most 60 seconds, reject
  application-level errors even with HTTP 200, and fail closed when no fresh
  rate is available. Keep quote conversion in integer arithmetic and round
  conservatively so payments cannot undercharge.
- Set the default provider markup to 2% and the quote lifetime to five minutes.
  Lock the rate and amount into each quote; never recalculate an already-issued
  quote during payment verification.
- For the MVP, the agent pays the Cardano network fee and the quoted service
  amount goes directly to the provider's payout address. KeyCard takes no
  separate platform fee and does not custody provider proceeds.
- Store currency amounts as decimal strings and ADA amounts as integer
  lovelace strings. Use integer/decimal arithmetic; do not calculate payment
  amounts with binary floating point.

## Initial data contracts

The JSON Schema Draft 2020-12 files in `schemas/` define public API listings,
operations, quotes, payments, sponsorship offers, and adVault entries. Public
listing and discovery responses must never include upstream API credentials.
The x402 SDK owns protocol-level header and facilitator schemas; KeyCard's
schemas describe its application records and reference x402 v2 fields where
needed.

## Durable paid-call implementation (2026-10-07)

The proxy now owns the call lifecycle while using the pinned SDK for quote
requirements, header codecs, Cardano transaction identity, and facilitator calls.
Persist fixed quotes, signed payloads, results, and receipts in PostgreSQL. A
secret client idempotency key binds method/path/query/body; advisory locks serialize
calls across processes and global transaction claims prevent payment/refund replay.
Save the upstream result before settlement. Ambiguous settlement returns `202` and
resumes with the same transaction, using independent Blockfrost confirmation when
available. A crash during the upstream call requires provider review rather than
repeating an unknown mutation. Failed calls with independently confirmed payments
create full service refund obligations. Provider refunds are externally signed and
verified on-chain before recording; reusable credits and automated refunds are not
implemented. Provider payouts are the original direct transfers. See
[the paid-call contract](paid-calls.md) for live acceptance requirements and limits.

## External setup needed for live settlement

No external credentials are needed to build the application or run its local
checks. A live Preprod demonstration will need a provider-owned OpenWeather
API key enabled for One Call 4.0, a FreeCryptoAPI key, a testnet payout
address, a CIP-30 wallet funded with Preprod tADA, and a Blockfrost Preprod
project ID for protocol-parameter lookups. Never put these values in source
control.

## Primary references

- [x402 v2 Cardano exact scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md)
- [x402 v2 HTTP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md)
- [Cardano Foundation facilitator](https://github.com/cardano-foundation/cardano-x402-facilitator)
- [Cardano Foundation x402 guide](https://developers.cardano.org/x402/)
- [CIP-30 wallet guide](https://developers.cardano.org/docs/developers/curriculum/dapps/connect-a-wallet/)
- [Blockfrost API documentation](https://docs.blockfrost.io/)
- [FreeCryptoAPI documentation](https://freecryptoapi.com/documentation/)
- [OpenWeather One Call API 4.0 pricing](https://openweathermap.org/price)
- [OpenWeather API overview](https://openweathermap.org/api)
