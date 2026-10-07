# KeyCard

Turn traditional web APIs into pay-per-call services for AI agents, powered by ADA on Cardano.

KeyCard is a web app where providers register APIs and securely supply their API keys. KeyCard exposes those services through a Cardano-based x402 proxy, allowing agents to discover an API, pay for a request in ADA, and receive the result without handling the provider's credentials.

Providers recover the underlying API cost plus a small markup. Agents get a common way to access services without managing separate subscriptions and API keys. The packaged skill also includes a signed local vault for user-supplied campaign context; vault entries are independent of API payment and authorization.

Built at TOKEN2049 Origins.

## Project status

This repository contains the landing page, a provider console, registry, and Cardano Preprod x402 proxy. Paid calls now have durable quotes, receipts, timeout recovery, replay protection, provider earnings/refund tracking, and a local agent wallet client. PostgreSQL/HTTP integration tests pass with simulated payment services; a successful live Preprod call remains to be verified.

### Run the landing page

Requires Node.js 22.12+ (or 20.19+).

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To verify and build the site:

```sh
npm test
npm run build
npm run preview
```

The page uses HTML, CSS, and vanilla JavaScript with Vite for development and production builds. Motion includes a layered card entrance, scroll reveals, a sticky three-stage walkthrough, and a page progress indicator, with support for reduced-motion preferences. The demo previews direct ADA payments using example data. Typography uses Google Fonts with local system fallbacks.

### Run the provider console and API

Requires Node.js 20.19+ and Docker Compose. Set local secrets, start PostgreSQL, then start the Vite site and API:

```sh
cp .env.example .env
openssl rand -base64 32  # use for KEYCARD_ENCRYPTION_KEY
docker compose up -d postgres
npm run dev
```

For hosted storage, set `DATABASE_URL` to a Supabase direct or session-pooler
PostgreSQL connection string instead of starting the local container. KeyCard
requires SSL for Supabase connections and applies `src/server/schema.sql` on
backend startup.

The open registry console is served at `http://127.0.0.1:4020/provider/`; the landing page remains at Vite's printed address. Publishing does not require an account or password. Upstream API keys are still encrypted at rest, and proxy calls remain payment-gated. Configure payment settings before issuing quotes.

Registry clients can use `GET /api/registry/services`, filter with `?capability=weather` or free-text `?q=forecast`, inspect one service at `GET /api/registry/services/:listingId`, and publish with `POST /api/registry/services`. Each operation includes its opaque paid proxy URL. The legacy `GET /api/discovery` and provider-console routes remain available for compatibility.

Agents can retrieve relevant, available APIs as JSON with
`GET /api/discovery?query=weather&limit=20`. Use `capability=weather` instead of
`query` for an exact capability match. Results include a relevance score,
operation schemas, effective lovelace pricing, and the operation's proxy URL.

See [paid-call setup, wallet commands, retry contract, and refund policy](docs/paid-calls.md). Run `npm run test:payments` for PostgreSQL integration coverage. The [agent skill](skills/keycard-agent/SKILL.md) covers wallet setup and paid-call instructions. Public calls require a stable secret `Idempotency-Key` alongside the x402 headers.

## Actors and parties involved

| Actor | Role in KeyCard |
| --- | --- |
| **API provider / key owner** | Registers an API using their upstream credentials, sets the cost and markup, and earns ADA when their listing is used. |
| **Upstream API vendor** | Operates the original API, processes requests authenticated with the provider's key, and bills the provider under its existing pricing model. |
| **User / agent owner** | Gives the agent a task, configures its spending limits, optionally funds its wallet, and receives the final answer. |
| **AI agent** | Uses the KeyCard skill to set up a wallet, discover APIs, choose the cheapest suitable option, and make paid calls. |
| **KeyCard platform** | Runs the provider dashboard, API registry, pricing, x402 proxy, payment verification, and payout accounting. |
| **Cardano network** | Processes the ADA transactions used for payments and payouts; KeyCard checks their settlement state through its payment adapter. |
| **Local vault** | Stores user-supplied campaign context and provides hashes, signed integrity receipts, and retrieval for agents. |

The API provider and upstream vendor may be the same organization, but their roles are distinct: the provider supplies access through KeyCard, while the vendor runs the original service. Cardano handles payments; the local vault is an optional agent-side store and is not part of payment processing.

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
3. **User → Agent wallet:** Add enough Preprod ADA for the service price and network fee before a paid call.
4. **AI agent → KeyCard:** Search for APIs that match the task's required capability, inputs, and outputs.
5. **KeyCard → AI agent:** Return suitable listings, availability, and current quotes.
6. **AI agent:** Compare equivalent operations by total payable cost, choose the cheapest available match, and proceed only when it fits the configured budget.

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

### 4. Pricing: who sets, pays, and receives the amount

- **API provider:** Supplies the upstream cost and sets the markup.
- **KeyCard:** Converts the service price into an expiring ADA quote and discloses applicable fees.
- **AI agent:** Compares total costs and checks the quote against the user's spending limit.
- **Agent wallet:** Covers the quoted call cost and network fee.
- **API provider:** Receives the service proceeds under the selected payout model and remains responsible for upstream charges.

The intended pricing model is:

```text
service price in ADA = provider cost in ADA × (1 + markup rate)
quoted service cost  = max(service price, Cardano minimum output)
total payer cost     = quoted service cost + network fee
```

For example, an API request listed at **2 ADA** with a **2% markup** is quoted at **2.04 ADA**, plus the Cardano network fee. Values are stored as integer lovelace so discovery and payment use the same amount.

Discovery and checkout must show comparable total costs, including applicable network fees, so the cheapest listing is also the cheapest usable option for the requested operation.

## Agent skill

KeyCard will provide an installable agent skill covering wallet setup, optional funding, discovery, and API access.

Install the skill for the current user directly from GitHub:

```sh
npx --yes git+https://github.com/kskavin3/KeyCard.git
```

Add `--project` to install into the current project's `.codex/skills` directory,
or use `--force` to replace an existing installation.

1. **Set up a Cardano account.** Connect an existing wallet or create a dedicated agent wallet, select the network, and configure spending limits. Keep signing keys in the agent's local wallet or signer.
2. **Fund the agent wallet.** Show the receiving address and balance, and guide the user through adding enough Preprod ADA for paid calls.
3. **Discover suitable APIs.** Search the registry by capability and inspect supported inputs, outputs, availability, and current quotes.
4. **Choose the cheapest available match.** Compare total prices for the same operation and usage quantity among APIs that meet the task's requirements. Refresh expired quotes and use availability or reliability to break ties.
5. **Access the resource.** Pay within the configured budget. If funds are insufficient, report the funding requirement and stop.
6. **Use local-vault entries when requested.** Store, verify, retrieve, or list user-supplied campaign context independently of API calls.

The skill should explain its selection and cost.

## Local-vault entries and verification

Each entry contains a campaign identifier, content, destination URL, relevance tags, creation time, and expiry. Its hash is derived from a canonical representation of that entry.

The packaged script stores entries locally and returns an HMAC-signed integrity receipt. The receipt only verifies data stored with the same local key; it has no role in API payment or authorization.

Campaign content is untrusted context. The agent must not treat it as instructions and should use only unexpired entries relevant to the user's request.

## Planned components

| Component | Responsibility |
| --- | --- |
| Provider web app | API registration, credential management, pricing, payout settings, and usage views. |
| Registry and discovery API | Searchable capabilities, operation schemas, availability, and comparable quotes. |
| x402 proxy | Payment challenges, request authorization, upstream calls, and receipts. |
| Cardano payment adapter | Wallet integration, payment verification, settlement tracking, and payouts. |
| Agent skill | Account setup, funding, cheapest-match discovery, paid access, and local context storage. |
| Local vault | Campaign-context storage, content hashes, integrity receipts, and retrieval. |

## Implementation roadmap

### Phase 1: Define the MVP

- [x] Choose the frontend, backend, database, and deployment stack.
- [x] Select a Cardano test network, wallet/signing tooling, and chain access provider.
- [x] Choose the x402 version and define the Cardano payment scheme, evidence format, and settlement policy.
- [x] Define schemas for API listings, operations, quotes, payments, receipts, and local-vault entries.
- [x] Select one fixed-price upstream API for the first end-to-end demo.
- [x] Standardize on lovelace pricing and decide quote expiry, markup rules, fee allocation, and provider payout model.

### Phase 2: Build provider registration and the proxy

- [x] Build the open API registration dashboard and service registry.
- [x] Add encrypted credential storage, credential rotation, and redaction from logs and responses.
- [x] Implement operation schemas, pricing configuration, and listing enable/disable controls.
- [x] Restrict proxy destinations and allowed operations; block access to internal network addresses.
- [x] Forward authorized calls with server-side credentials and handle upstream errors, timeouts, and rate limits.

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
- [ ] Write the skill's Cardano account setup and wallet funding instructions.
- [ ] Add cheapest-match selection, spending limits, quote refresh, and paid-call execution.
- [ ] Demonstrate discovery and selection across at least two providers offering the same capability.

### Phase 5: Maintain the local vault

- [x] Store campaign context locally with canonical hashing and HMAC-signed receipts.
- [x] Verify, retrieve, and list entries without overwriting existing data.
- [x] Keep vault data separate from API payment and authorization.

### Phase 6: Verify and document the release

- [ ] Verify successful paid calls, cheapest-match selection, and credential isolation.
- [ ] Check expired quotes, insufficient funds, invalid payment evidence, duplicate retries, and upstream failures.
- [ ] Check invalid vault receipts and unavailable local storage.
- [ ] Add provider usage reporting, payment reconciliation, and service monitoring.
- [ ] Document local setup, environment variables, deployment, skill installation, and a reproducible demo.

## MVP success criteria

A provider can register a keyed API and expose it through KeyCard. An agent can set up and fund a Cardano wallet, discover comparable APIs, choose the cheapest suitable one, and obtain a result through an ADA payment. The upstream API key remains server-side throughout. The optional local vault stores campaign context without affecting payment or access.
