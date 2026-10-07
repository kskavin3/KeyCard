<div align="center">

<img src="public/favicon.svg" alt="KeyCard logo" width="88" height="88" />

# Every API. One KeyCard.

**Give your agent the keys to the internet.**

Discover APIs. Pay in ADA. Get things done.

<p>
  <img src="https://img.shields.io/badge/Cardano-Preprod-0033AD?style=flat-square" alt="Cardano Preprod" />
  <img src="https://img.shields.io/badge/x402-v2-12160E?style=flat-square" alt="x402 v2" />
  <img src="https://img.shields.io/badge/Payments-ADA-C2F878?style=flat-square" alt="Payments in ADA" />
  <img src="https://img.shields.io/badge/Built_at-TOKEN2049_Origins-12160E?style=flat-square" alt="Built at TOKEN2049 Origins" />
</p>

[Get started](#get-started) · [Install the agent skill](#give-your-agent-a-keycard) · [Payment docs](docs/paid-calls.md) · [Architecture](docs/architecture-decisions.md)

</div>

---

KeyCard turns traditional web APIs into services that AI agents can discover and pay for per call. Providers publish an API, supply their credentials, and set a price. Agents find a suitable operation, authorize an ADA payment through x402, and receive the result. The provider's upstream API key stays on the server.

**Your API gets a new audience. Your agent gets a new capability.**

> **MVP status:** The provider console, searchable registry, durable payment proxy, and local agent wallet are implemented for Cardano Preprod. Payment integration tests use PostgreSQL and simulated payment services; a successful live Preprod call still needs verification. The landing-page playground uses example data.

## Built to open doors

| For API providers | For agent builders |
| --- | --- |
| Publish through an open console without an account or password. | Discover services by capability or free-text search. |
| Describe operations with request and response schemas. | Compare suitable operations using effective lovelace prices. |
| Set per-operation pricing and markup. | Enforce per-call and cumulative wallet budgets, including fees. |
| Keep upstream credentials encrypted with AES-256-GCM. | Call a stable proxy URL without handling provider credentials. |
| Track earnings, receipts, pending calls, and refunds. | Resume interrupted payments using a persistent local journal. |

## Discover. Pay. Unlock.

```text
  YOUR AGENT                  KEYCARD                     UPSTREAM API
      |                          |                              |
      |--- Discover an API ----->|                              |
      |<-- Schema + price -------|                              |
      |                          |                              |
      |--- Request + call ID --->|                              |
      |<-- 402 + ADA quote ------|                              |
      |                          |                              |
      |--- Signed payment ------>|--- Verify payment            |
      |                          |--- Call with provider key --->|
      |                          |<-- Result --------------------|
      |                          |--- Save result               |
      |                          |--- Settle on Cardano         |
      |<-- Result + receipt -----|                              |
```

1. **Discover:** Search the registry, check operation schemas, and compare eligible prices.
2. **Pay:** Receive a five-minute quote, check the budget, and sign locally. KeyCard verifies payment evidence before calling the upstream API.
3. **Unlock:** KeyCard saves the upstream result, settles the payment, and returns the result and receipt after confirmation.

Quotes, results, and receipts live in PostgreSQL. A stable, secret `Idempotency-Key` binds each call to its request; retries reuse the same payment and saved result. Ambiguous upstream outcomes enter provider review. See the [paid-call contract](docs/paid-calls.md) for recovery and refund behavior.

### Follow the ADA

```text
Service price = provider cost × (1 + markup)
Quoted amount = max(service price, configured minimum payment)
Agent total   = quoted amount + Cardano network fee
```

Prices use integer lovelace: **1 ADA = 1,000,000 lovelace**. The default quote floor is **1.5 ADA**; the wallet also checks the live chain minimum. A 2 ADA operation with a 2% markup costs **2.04 ADA plus the network fee**.

The quoted service amount goes directly to the provider's payout address. This MVP takes no separate platform fee. Providers remain responsible for upstream vendor charges; refunds are issued by providers and verified on-chain.

## Get started

Use **Node.js 22.12+** (Node.js 20.19+ is also supported) and npm. Docker Compose is needed only for local PostgreSQL.

```sh
git clone https://github.com/kskavin3/KeyCard.git
cd KeyCard
npm install
```

### Just exploring? Launch the visual demo

```sh
npm run dev:client
```

Open the URL printed by Vite. The landing page includes animated access cards, a three-stage walkthrough, and an interactive paid-call preview with reduced-motion support. This preview needs no database or wallet and makes no real payments. Registry and provider actions need the full stack below.

### Ready to build? Start the full stack

**1. Create your local configuration.**

```sh
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

In PowerShell, use `Copy-Item .env.example .env` for the copy step. Paste the generated value into `KEYCARD_ENCRYPTION_KEY` in `.env`.

**2. Choose your database.** For local PostgreSQL:

```sh
docker compose up -d postgres
```

Replace the example `DATABASE_URL` in `.env` with:

```dotenv
DATABASE_URL=postgresql://keycard:keycard@127.0.0.1:5433/keycard
```

For Supabase, use a direct or session-pooler PostgreSQL connection string instead. Supabase connections use SSL. The API applies the schema and pending migrations at startup.

**3. Start the app.**

```sh
npm run dev
```

This starts Vite and the Express API together.

| Destination | Address |
| --- | --- |
| Landing page | The local URL printed by Vite |
| Provider console | [127.0.0.1:4020/provider/](http://127.0.0.1:4020/provider/) |
| API health | [127.0.0.1:4020/api/health](http://127.0.0.1:4020/api/health) |
| Service registry | [127.0.0.1:4020/api/registry/services](http://127.0.0.1:4020/api/registry/services) |

### Enable Preprod payments

Before making a paid call, configure the following in `.env`, publish a service with valid upstream credentials, and fund a dedicated agent wallet with Preprod test ADA.

| Variable | Purpose |
| --- | --- |
| `KEYCARD_PAY_TO` | Provider-controlled Cardano Preprod payout address. |
| `BLOCKFROST_PROJECT_ID` | Preprod chain access for payment checks and wallet operations. |
| `FACILITATOR_URL` | Payment verification and settlement; the example includes a Preprod endpoint. |
| `KEYCARD_PUBLIC_ORIGIN` | Origin used for public proxy URLs; defaults in the example to `http://127.0.0.1:4020`. |

See [`.env.example`](.env.example) for the complete configuration and [paid-call setup](docs/paid-calls.md) for wallet commands, retry rules, and live acceptance steps. Keep populated `.env` files and wallet material out of source control.

## Give your agent a KeyCard

Install the packaged skill for the current user:

```sh
npx --yes git+https://github.com/kskavin3/KeyCard.git
```

Add `--project` to install into the current project's `.codex/skills` directory, or `--force` to replace an existing installation.

The [agent skill](skills/keycard-agent/SKILL.md) covers discovery, cheapest suitable operation selection, wallet budgets, paid calls, and recovery. It defaults to the hosted KeyCard API; wallet commands run from a KeyCard checkout with dependencies installed.

Create a dedicated Preprod wallet from your checkout:

```sh
# Example limits: 3 ADA per call, 15 ADA cumulative, including network fees.
npm run agent:wallet -- init 3000000 15000000
npm run agent:wallet -- info
```

The wallet stores its mnemonic, limits, and payment journal locally in the ignored `.keycard-agent/` directory. Funding is needed only when you are ready to make paid calls.

<details>
<summary><strong>Optional: a signed local vault for agent context</strong></summary>

The skill also stores user-supplied campaign context with canonical hashes and HMAC-signed integrity receipts. Agents can store, verify, retrieve, and list entries, using only relevant, unexpired content as context.

Vault receipts verify local integrity only. They do not authorize API access or replace payment. See the [vault instructions](skills/keycard-agent/SKILL.md#local-vault).

</details>

## Talk to the registry

| Request | What it does |
| --- | --- |
| `GET /api/registry/services?query=weather&limit=20` | Search available services by relevance. |
| `GET /api/registry/services?capability=weather` | Filter by an exact capability. |
| `GET /api/registry/services/:listingId` | Inspect a service and its operations. |
| `POST /api/registry/services` | Publish a service. |
| `/api/proxy/:proxyId` | Call an operation using its declared HTTP method and x402 payment flow. |

Discovery returns operation schemas, effective lovelace pricing, relevance scores, and each operation's absolute `proxyUrl`. Use that URL for calls. The legacy `/api/discovery` and `/api/proxy/:listingId/:operationId` routes remain supported.

Public proxy requests require a private, random `Idempotency-Key` of 32–128 URL-safe characters, including the first unpaid request. The wallet client handles the payment headers and persistent retry journal. API schemas live in [`schemas/`](schemas/README.md).

## Under the hood

| Layer | Stack |
| --- | --- |
| Web | Vite, vanilla JavaScript, HTML, CSS |
| API | Node.js, TypeScript, Express |
| Storage | PostgreSQL; Docker Compose or hosted Supabase |
| Payments | x402 v2, Cardano Preprod, ADA, Blockfrost |
| Agent tools | Local wallet CLI, installable skill, signed context vault |

```text
KeyCard/
├── index.html              Landing page
├── src/                    Frontend, tests, and Express server
├── public/provider/        Provider console and onboarding
├── scripts/                Dev launcher, wallet, and payment test runner
├── skills/keycard-agent/   Installable agent skill and local vault
├── schemas/                Public JSON Schema contracts
├── migrations/             Database migrations
├── docs/                   Architecture and payment lifecycle
└── postman/                Salesforce example collection
```

### Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the web app and API together; requires database configuration. |
| `npm run dev:client` | Run the frontend only. |
| `npm run dev:api` | Run the API with file watching. |
| `npm test` | Run the test suite; database integration tests skip without `KEYCARD_TEST_DATABASE_URL`. |
| `npm run test:payments` | Run payment and provider integration tests using `DATABASE_URL` from `.env`. |
| `npm run build` | Compile the TypeScript server and build the frontend. |
| `npm run preview` | Preview the built frontend. |
| `npm run start:api` | Run the compiled API. |

Payment integration tests create isolated test schemas and remove them afterward. They simulate facilitator and chain responses; they do not submit funded Preprod transactions.

## Next unlocks

- [ ] Verify a funded Preprod call end to end, including its receipt and on-chain transaction.
- [ ] Repeat the same call to confirm one payment and an identical saved result.
- [ ] Demonstrate discovery and cheapest suitable selection across two providers with the same capability.

Explore the [architecture decisions](docs/architecture-decisions.md), [payment lifecycle](docs/paid-calls.md), [database diagram](db/ER_DIAGRAM.md), or [Salesforce example](postman/README.md) to go deeper.

---

<div align="center">

**Traditional APIs. Agent-native access.**<br />
Built at TOKEN2049 Origins · Powered by Cardano + x402

</div>
