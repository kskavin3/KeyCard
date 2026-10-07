# KeyCard database schema

```mermaid
erDiagram
    PROVIDERS ||--o{ APIS : owns
    APIS ||--o{ API_CREDENTIALS : authenticates_with
    APIS ||--o| API_LISTINGS : publishes
    API_LISTINGS ||--o{ API_OPERATIONS : offers

    PROVIDERS {
        uuid id PK
        text display_name
        text contact_email UK
        text cardano_payout_address
        timestamptz created_at
    }

    APIS {
        uuid id PK
        uuid provider_id FK
        text name
        text description
        text base_url
        text documentation_url
        text auth_location "header or query"
        text auth_name "for example Authorization"
        text auth_prefix "for example Bearer"
        text status "draft, active, disabled"
        timestamptz created_at
        timestamptz updated_at
    }

    API_CREDENTIALS {
        uuid id PK
        uuid api_id FK
        bytea secret_ciphertext
        bytea encrypted_data_key
        bytea nonce
        bytea auth_tag
        text kms_key_id
        int key_version
        text fingerprint
        text last_four
        timestamptz created_at
        timestamptz rotated_at
        timestamptz expires_at
        timestamptz revoked_at
    }

    API_LISTINGS {
        uuid id PK
        uuid api_id FK,UK
        text slug UK
        text title
        text summary
        text category
        text_array tags
        text proxy_path UK
        boolean is_published
        timestamptz created_at
        timestamptz updated_at
    }

    API_OPERATIONS {
        uuid id PK
        uuid listing_id FK
        text operation_key
        text method
        text upstream_path
        text description
        jsonb input_schema
        jsonb output_schema
        decimal upstream_cost_usd
        int markup_bps
        decimal service_price_usd
        boolean is_available
        timestamptz created_at
        timestamptz updated_at
    }
```

## Security boundary

- Encrypt API keys in the server with envelope encryption backed by a KMS; never store plaintext keys.
- Give only the proxy service access to `API_CREDENTIALS`.
- Public listing responses must exclude `API_CREDENTIALS`, `APIS.base_url`, authentication fields, and `API_OPERATIONS.upstream_path`.
- Keep previous credential rows as revoked during key rotation; allow only one active credential per API.
