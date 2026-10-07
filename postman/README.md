# Salesforce Developer Edition collection

This directory contains a small, auditable Salesforce Platform collection for
evaluating Salesforce as an upstream KeyCard provider. It is curated from
Salesforce's official Platform API collection and current REST and GraphQL
documentation rather than copying the full 250+ request workspace.

The selected APIs work in a free Developer Edition org when the authenticated
user has the required object, field, and API permissions:

- API version and resource discovery
- Org limits
- sObject discovery and metadata
- Bounded SOQL and parameterized search
- GraphQL reads
- Account create, read, update, and cleanup
- Composite REST reads

Paid or separately provisioned products such as CPQ, Data 360, Loyalty,
Subscription Management, Einstein services, and Marketing Cloud are excluded.

## Import and authenticate

1. Create a free Salesforce Developer Edition org. Do not use a production org
   for the CRUD demonstration.
2. Import both JSON files in this directory into Postman.
3. Obtain an OAuth access token using Salesforce's official Postman collection,
   Salesforce CLI, or a connected/external client app.
4. Set `endpoint` to the `instance_url`/My Domain URL returned by Salesforce,
   not `login.salesforce.com`.
5. Set `accessToken` in the imported environment and select that environment.
6. Run **Discovery and metadata > List API versions** first.

The collection and environment contain no client secret, password, refresh
token, or access token. Do not commit an exported environment after populating
its secret value.

## Best initial KeyCard operations

Start with the read-only requests below:

| Operation | Why it fits KeyCard | Input restriction |
| --- | --- | --- |
| Describe sObject | Machine-readable capability discovery | Allowlist object names |
| Parameterized search | Useful agent search without arbitrary SOSL | Limit objects, fields, and result count |
| SOQL query | High utility for CRM agents | Use query templates; do not accept arbitrary SOQL |
| GraphQL query | Retrieves multiple related fields in one call | Persisted/allowlisted queries only |
| Composite read | Reduces round trips and has clear per-call value | Allowlist subrequest paths and methods |

Avoid exposing the generic CRUD requests directly. Register narrow operations
such as `find-accounts`, `get-account-summary`, or `create-qualified-lead`, with
explicit JSON Schemas and field allowlists. KeyCard should keep the Salesforce
OAuth credential server-side and inject the bearer token only while forwarding
to the provider's My Domain endpoint.

## Sources

- Salesforce Developers' verified Postman workspace:
  <https://www.postman.com/salesforce-developers>
- REST API resource reference:
  <https://developer.salesforce.com/docs/platform/api-rest/guide/resources-list.html>
- REST API supported editions and permissions:
  <https://developer.salesforce.com/docs/platform/api-rest/guide/intro-rest-compatible-editions.html>
- GraphQL API availability:
  <https://developer.salesforce.com/docs/platform/graphql/guide/graphql-about.html>
- Official collection source and installation notes:
  <https://github.com/forcedotcom/postman-salesforce-apis>

Salesforce's official Postman collection is provided as-is and is not covered
by Salesforce support or SLAs. This curated collection is likewise intended for
development and evaluation, not production deployment without review.
