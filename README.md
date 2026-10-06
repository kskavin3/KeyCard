# KeyCard

Turn traditional web APIs into pay-per-call services for AI agents, powered by ADA on Cardano.

KeyCard is a web app where providers register APIs and securely supply their API keys. KeyCard exposes those services through a Cardano-based x402 proxy, allowing agents to discover an API, pay for a request in ADA, and receive the result without handling the provider's credentials.

Providers recover the underlying API cost plus a small markup. Agents get a common way to access services without managing separate subscriptions and API keys. Sponsors can cover calls for agents with no funds in exchange for relevant sponsored content delivered through an **adVault**.

Built at TOKEN2049 Origins.

## Project status

This repository currently contains the product description and implementation roadmap. The web app, proxy, Cardano payment integration, agent skill, and sponsorship system described below are planned features.

The payment flow will follow the [x402 HTTP payment model](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md). The Cardano payment adapter and adVault sponsorship flow require implementation and validation; this README does not imply compatibility with existing x402 clients yet.

## Actors and parties involved

| Actor | Role in KeyCard |
| --- | --- |
| **API provider / key owner** | Registers an API using their upstream credentials, sets the cost and markup, and earns ADA when their listing is used. |
| **Upstream API vendor** | Operates the original API, processes requests authenticated with the provider's key, and bills the provider under its existing pricing model. |
| **User / agent owner** | Gives the agent a task, configures its spending limits, optionally funds its wallet, and receives the final answer. |
| **AI agent** | Uses the KeyCard skill to set up a wallet, discover APIs, choose the cheapest suitable option, and request paid or sponsored access. |
| **KeyCard platform** | Runs the provider dashboard, API registry, pricing, x402 proxy, payment verification, sponsor matching, and payout accounting. |
| **Sponsor / advertiser** | Funds campaigns and supplies sponsored content and targeting criteria to cover relevant API calls. |
| **Cardano network** | Processes the ADA transactions used for payments and payouts; KeyCard checks their settlement state through its payment adapter. |
| **adVault** | Stores sponsored entries and provides hashes, storage verification, and retrieval for agents. |

The API provider and upstream vendor may be the same organization, but their roles are distinct: the provider supplies access through KeyCard, while the vendor runs the original service. Cardano and adVault are technical participants; adVault's operator and hosting model are still to be decided.

## How it works

### 1. API provider: register and publish a service

1. **API provider → KeyCard:** Submit the API's name, description, upstream URL, supported operations, and request/response schemas.
2. **API provider → KeyCard:** Supply the upstream API key, cost per operation, markup, and Cardano payout address.
3. **KeyCard:** Store the credentials securely on the server and configure how authorized requests will be forwarded.
4. **KeyCard → AI agents:** Publish a searchable listing and a proxy endpoint with the operation details and pricing.

The **API provider** remains responsible for the upstream account and its charges. The **upstream API vendor** continues serving its existing API; agents access it through KeyCard.

For the first version, focus on APIs with a predictable fixed cost per request. Usage-based billing, such as per-token charges, needs a separate quoting and reconciliation policy.

### 2. User and AI agent: set up access and discover an API

1. **User → AI agent:** Provide a task and configure the agent's spending limits.
2. **AI agent:** Follow the KeyCard skill to connect or create a Cardano wallet and select the network. Signing keys stay with the agent's local wallet or signer.
3. **User → Agent wallet, optionally:** Add funds for paid calls. Funding can be skipped when pursuing sponsorship.
4. **AI agent → KeyCard:** Search for APIs that match the task's required capability, inputs, and outputs.
5. **KeyCard → AI agent:** Return suitable listings, availability, and current quotes.
6. **AI agent:** Compare equivalent operations by total payable cost and choose the cheapest available match. Proceed with paid access or request sponsorship if funds are insufficient.

### 3. Paid access: agent, KeyCard, Cardano, and upstream vendor

| Step | Acting party | Action and handoff |
| --- | --- | --- |
| 1 | **AI agent → KeyCard** | Call the selected API's proxy endpoint. |
| 2 | **KeyCard → AI agent** | Return `HTTP 402 Payment Required` with the amount, payment destination, network, and quote expiry. |
| 3 | **AI agent → Cardano** | Check the spending limit and authorize the ADA payment through its wallet and the chosen adapter. |
| 4 | **Cardano network** | Process the payment transaction and make its settlement state available for verification. |
| 5 | **AI agent → KeyCard** | Retry the request with payment evidence tied to the quote and request. |
| 6 | **KeyCard → Upstream API vendor** | Verify the payment and required settlement state, then forward the request with the provider's API key. |
| 7 | **Upstream API vendor → KeyCard** | Process the request, return the result, and account for usage against the provider's upstream account. |
| 8 | **KeyCard → AI agent** | Return the API result and receipt, and record the provider's earnings for the selected payout model. |
| 9 | **AI agent → User** | Use the API result to complete the user's task. |

The **agent wallet** pays for this path. The **API provider** earns the service price in ADA under the chosen payout model and pays the **upstream vendor** through their existing account. KeyCard's fee allocation and payout timing remain MVP design decisions.

Payment verification, request identifiers, and retry handling must prevent a payment from unlocking multiple unrelated calls or charging twice for the same retry.

### 4. Sponsored access: sponsor, agent, KeyCard, and adVault

The **sponsor** funds the call in exchange for the agent storing a small sponsored context snippet in adVault for a relevant user-facing placement.

| Step | Acting party | Action and handoff |
| --- | --- | --- |
| 1 | **Sponsor → KeyCard** | Fund a campaign and provide sponsored text or a service listing, relevance criteria, and a budget. |
| 2 | **AI agent → KeyCard** | Call a paid endpoint and receive the price and sponsorship availability in the paywall response. |
| 3 | **AI agent → KeyCard** | Request sponsorship using the quote/request identifier and the minimum task context needed for matching. |
| 4 | **KeyCard → AI agent** | Find an eligible, relevant sponsor with enough budget; reserve the full call cost and return an offer with the snippet, campaign ID, covered amount, expiry, and a one-time request challenge. |
| 5 | **AI agent → adVault** | Store the sponsored content and offer details as an entry tied to the request. |
| 6 | **adVault → AI agent** | Return the entry's content hash and a verifiable storage receipt. |
| 7 | **AI agent → KeyCard** | Submit the hash and receipt against the sponsorship offer. |
| 8 | **KeyCard → Upstream API vendor** | Verify the entry and offer, consume the offer once, charge the reserved sponsor budget, and forward the authorized API request with the provider's key. |
| 9 | **Upstream API vendor → KeyCard → AI agent** | Return the API result; KeyCard records the provider's earnings and the sponsorship receipt. |
| 10 | **AI agent ↔ adVault; AI agent → User** | Retrieve the sponsored entry and integrate it naturally into a relevant response, with a clear sponsored label. |

The **sponsor budget** covers the service price and any required transaction fees, so the **agent wallet** can have zero ADA. KeyCard handles sponsor funding and settlement through the selected payment model; adVault verifies stored content. If no sponsor qualifies, the agent reports the funding requirement so the user can fund the wallet or stop the request.

### 5. Pricing: who sets, pays, and receives the amount

- **API provider:** Supplies the upstream cost and sets the markup.
- **KeyCard:** Converts the service price into an expiring ADA quote and discloses applicable fees.
- **AI agent:** Compares total costs and checks the quote against the user's spending limit.
- **Agent wallet or sponsor budget:** Covers the quoted call cost, depending on the access path.
- **API provider:** Receives the service proceeds under the selected payout model and remains responsible for upstream charges.

The intended pricing model is:

```text
service price in USD = upstream cost in USD × (1 + markup rate)
service price in ADA = service price in USD ÷ quoted USD price per ADA
total payer cost     = service price in ADA + any separately charged fees
```

For example, an API request costing the provider **$1.00** with an illustrative **2% markup** would be quoted at the ADA equivalent of **$1.02**, plus any disclosed fees. The actual markup is configurable; the exchange-rate source, quote lifetime, and fee policy still need to be selected.

Discovery and checkout must show comparable total costs, including applicable network fees, so the cheapest listing is also the cheapest usable option for the requested operation.

## Agent skill

KeyCard will provide an installable agent skill covering wallet setup, optional funding, discovery, and API access.

1. **Set up a Cardano account.** Connect an existing wallet or create a dedicated agent wallet, select the network, and configure spending limits. Keep signing keys in the agent's local wallet or signer.
2. **Fund the agent wallet, optionally.** Show the receiving address and balance, and guide the user through funding. An unfunded agent can attempt the sponsorship flow.
3. **Discover suitable APIs.** Search the registry by capability and inspect supported inputs, outputs, availability, and current quotes.
4. **Choose the cheapest available match.** Compare total prices for the same operation and usage quantity among APIs that meet the task's requirements. Refresh expired quotes and use availability or reliability to break ties.
5. **Access the resource.** Pay within the configured budget, or request sponsorship if funds are insufficient. If neither path is available, report the funding requirement.
6. **Use adVault entries.** Retrieve eligible sponsored content and include it naturally when relevant to the user's task, with a clear sponsored label.

The skill should explain its selection and cost. Sponsor matching should not silently override the choice of the cheapest suitable API.

## adVault entries and verification

Each entry should contain the campaign and offer identifiers, sponsored text or service listing, destination URL, relevance tags, request identifier, creation time, and expiry. Its hash should be derived from a canonical representation of that entry.

KeyCard must be able to verify the stored entry through adVault or a signed receipt. A hash alone does not prove storage, sponsor payment, or that the user saw an ad. Storage verification unlocks the sponsored call; any later placement reporting is a separate mechanism.

The proposed ad prompt injection is treated as **sponsored context**: the agent reads the snippet as advertising content, preserves its normal task instructions, and presents it only where relevant with a sponsored label. Entry expiry and frequency limits keep repeated placements under control.

## Planned components

| Component | Responsibility |
| --- | --- |
| Provider web app | API registration, credential management, pricing, payout settings, and usage views. |
| Registry and discovery API | Searchable capabilities, operation schemas, availability, and comparable quotes. |
| x402 proxy | Payment challenges, request authorization, upstream calls, and receipts. |
| Cardano payment adapter | Wallet integration, payment verification, settlement tracking, and payouts. |
| Agent skill | Account setup, optional funding, cheapest-match discovery, and paid or sponsored access. |
| Sponsorship service | Campaigns, relevance matching, budget reservation, and offer redemption. |
| adVault | Sponsored entry storage, content hashes, verification receipts, and retrieval. |

## Implementation roadmap

### Phase 1: Define the MVP

- [ ] Choose the frontend, backend, database, and deployment stack.
- [ ] Select a Cardano test network, wallet/signing tooling, and chain access provider.
- [ ] Choose the x402 version and define the Cardano payment scheme, evidence format, and settlement policy.
- [ ] Define schemas for API listings, operations, quotes, payments, sponsorship offers, and adVault entries.
- [ ] Select one fixed-price upstream API for the first end-to-end demo.
- [ ] Decide the exchange-rate source, quote expiry, markup rules, fee allocation, and provider payout model.

### Phase 2: Build provider registration and the proxy

- [ ] Build provider sign-in and the API registration dashboard.
- [ ] Add encrypted credential storage, credential rotation, and redaction from logs and responses.
- [ ] Implement operation schemas, pricing configuration, and listing enable/disable controls.
- [ ] Restrict proxy destinations and allowed operations; block access to internal network addresses.
- [ ] Forward authorized calls with server-side credentials and handle upstream errors, timeouts, and rate limits.

### Phase 3: Add ADA payments

- [ ] Return payment-required responses with expiring, request-bound ADA quotes.
- [ ] Integrate the Cardano payment adapter and verify network, destination, amount, and settlement state.
- [ ] Add receipts, replay protection, and idempotent retries.
- [ ] Track provider earnings and implement the selected payout model.
- [ ] Define and implement refund or credit behavior when payment succeeds but the upstream call fails.
- [ ] Complete a test-network demo from payment challenge to API response.

### Phase 4: Ship discovery and the agent skill

- [ ] Publish a machine-readable registry with capability search and live pricing.
- [ ] Compare equivalent operations by total payable cost and exclude unavailable listings.
- [ ] Write the skill's Cardano account setup and optional wallet funding instructions.
- [ ] Add cheapest-match selection, spending limits, quote refresh, and paid-call execution.
- [ ] Demonstrate discovery and selection across at least two providers offering the same capability.

### Phase 5: Add sponsorship and adVault

- [ ] Build sponsor campaign creation, funding, budgets, targeting, and sponsored snippet management.
- [ ] Implement relevant-sponsor matching and atomic budget reservations with expiry.
- [ ] Define adVault ownership, storage API, canonical hashing, signed receipts, and entry retrieval.
- [ ] Bind each sponsorship offer and vault receipt to one request and prevent duplicate redemption.
- [ ] Implement sponsor-funded fulfillment, including fees, and release reservations on expiry or failure.
- [ ] Add relevant, labeled ad placements to the agent skill with expiry and frequency limits.
- [ ] Demonstrate a successful sponsored API call from an agent with zero ADA.

### Phase 6: Verify and document the release

- [ ] Verify successful paid and sponsored calls, cheapest-match selection, and credential isolation.
- [ ] Check expired quotes, insufficient funds, invalid payment evidence, duplicate retries, and upstream failures.
- [ ] Check exhausted sponsor budgets, concurrent redemptions, invalid vault receipts, and unavailable adVault storage.
- [ ] Add provider and sponsor usage reporting, payment reconciliation, and service monitoring.
- [ ] Document local setup, environment variables, deployment, skill installation, and a reproducible demo.

## MVP success criteria

A provider can register a keyed API and expose it through KeyCard. An agent can set up a Cardano wallet, optionally fund it, discover comparable APIs, choose the cheapest suitable one, and obtain a result through either an ADA payment or a sponsor-funded adVault flow. The upstream API key remains server-side throughout.
