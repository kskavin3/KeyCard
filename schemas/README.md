# KeyCard MVP schemas

These JSON Schema Draft 2020-12 files define the planned public registry and MVP records:

- `api-listing.schema.json` and `operation.schema.json`: public discovery records and operation contracts.
- `quote.schema.json`: KeyCard quote fields plus the x402 v2 exact-scheme payment requirements.
- `receipt.schema.json`: implemented public paid-call receipt, transaction, payout, and refund state.
- `payment.schema.json`: one quote-bound payment record with evidence from an x402 `PAYMENT-SIGNATURE` header or a facilitator verification.
- `advault-entry.schema.json`: local campaign-context storage, content hash, and signed receipt.
- `common.schema.json`: shared IDs, timestamps, Preprod network, Cardano address, lovelace amount, hash, and URL definitions.

## Assumptions

- The v1 deployment is fixed to Cardano Preprod (`cardano:preprod`), x402 v2, the `exact` scheme, direct ADA (`asset: "lovelace"`), and `assetTransferMethod: "default"`.
- All listing and payment values are positive integer strings in lovelace. Decimal ADA is accepted only by user interfaces.
- A quote's `requestHash` is SHA-256 over a canonicalized method, proxy path, and request body. Quote expiry ordering and equality checks are enforced by application logic; JSON Schema validates timestamp syntax only.
- The public listing schema intentionally has no upstream URL, credential, or secret field. Provider credentials belong in a separate private server-side model.
- Each public operation includes its stable `proxyId` and complete `proxyUrl`; the identifier is routing metadata, while x402 remains the authorization boundary.
- x402 transport headers carry base64-encoded protocol objects; `payment.schema.json` stores the submitted `PAYMENT-SIGNATURE` value as evidence. A facilitator record is a KeyCard audit envelope, not a standardized x402 facilitator response schema.
- Local-vault canonicalization and HMAC receipts are implemented by the packaged skill. Cardano address validation beyond a basic Bech32-like shape remains an implementation choice.

The x402 header names and v2 transport placement follow the [x402 HTTP v2 transport specification](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md). These schemas are application contracts and do not by themselves establish compatibility with a Cardano facilitator or x402 client.
