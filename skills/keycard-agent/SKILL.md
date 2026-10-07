---
name: keycard-agent
description: Set up a dedicated Cardano Preprod wallet, discover KeyCard APIs, enforce a spending budget, and retry paid calls without signing or charging twice.
---

# KeyCard paid API access

Use this skill from a KeyCard checkout with dependencies installed. Read
`docs/paid-calls.md` for configuration and response meanings.

1. Use Cardano Preprod only. Never use a mainnet wallet or expose a mnemonic in
   chat, logs, a command argument, or source control. The reference CLI creates a
   dedicated local signer; a separately integrated CIP-30/hardware signer can
   implement the same `ClientCardanoSigner` interface.
2. Obtain the user's service-plus-fee per-call and cumulative limits. Convert ADA
   to integer lovelace (1 ADA = 1,000,000 lovelace). Create a wallet only when one
   is needed: `npm run agent:wallet -- init MAX_CALL_LOVELACE MAX_TOTAL_LOVELACE`.
   Run `npm run agent:wallet -- info` to report its address, network, balance, and
   configured limits. Back up the owner-only mnemonic file locally.
3. Funding is optional until a paid request is needed. An unfunded wallet cannot
   pay. Provide the receiving Preprod address; obtain test ADA using the Cardano
   testnet faucet or a test wallet. Do not send funds automatically. Sponsorship
   is a concept demo, so do not promise free sponsored access to the real proxy.
4. Search `/api/registry/services?query=...&limit=20`, or use `capability=...` for an
   exact capability match. Inspect ranked items, operation methods, and input and
   output schemas; exclude unsuitable providers. Compare service prices using
   `pricing.effectivePriceLovelace` across suitable listings rather than blindly
   choosing the relevance rank. The final ADA quote includes the minimum output
   floor; include the actual transaction fee when assessing total cost.
   Use the cheapest suitable option that fits the user's budget. Explain the
   selection; do not silently raise the limits or change wallets.
5. Generate a new secret random request ID for a new operation, e.g.
   `node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"`.
   Store it with the task. It is an authorization capability; do not publish it.
6. Execute `npm run agent:wallet -- call URL REQUEST_ID [METHOD] [JSON_BODY]`.
   GET/DELETE inputs go in the URL query; POST/PUT/PATCH inputs use a JSON body.
   The client checks the quote, signs locally, checks amount plus the computed
   network fee, persists a budget reservation and signed bytes, then submits the
   payment header to KeyCard. Never broadcast separately.
7. For pending responses or network failures, rerun the **identical command**
   with the **same ID**. Never sign a replacement payment or create a new ID to
   retry an ambiguous paid call. The journal reuses the transaction. Concurrent
   wallet use is blocked to avoid UTXO and spending races.
8. Expired, still-unpaid quotes require a new ID after verifying no signed
   transaction was submitted. A signed/possibly submitted call must keep its
   original ID even after expiry. A provider-review response requires human
   reconciliation; do not rerun the upstream mutation or make a new payment.
9. Report the API result, receipt transaction, service amount, and total reserved
   spend. On failure, report refund status. Provider refunds return the full
   service amount; network fees are not refunded. The client conservatively
   retains spending reservations for failed/ambiguous payments until manually
   reconciled; do not clear the journal to bypass spending limits.
