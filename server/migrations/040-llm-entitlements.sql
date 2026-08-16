BEGIN;

CREATE TABLE llm_entitlement_accounts (
  account_id text PRIMARY KEY,
  available_credits bigint NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  spent_credits bigint NOT NULL DEFAULT 0 CHECK (spent_credits >= 0),
  reset_at timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE TABLE llm_entitlement_grants (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('free_monthly', 'admin', 'subscription')),
  credits bigint NOT NULL CHECK (credits > 0),
  reset_at timestamptz,
  source_ref text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, source_ref)
);

CREATE TABLE llm_entitlement_reservations (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES llm_entitlement_accounts(account_id),
  invocation_id text NOT NULL UNIQUE,
  reserved_credits bigint NOT NULL CHECK (reserved_credits > 0),
  charged_credits bigint NOT NULL DEFAULT 0 CHECK (charged_credits >= 0),
  status text NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  lease_expires_at timestamptz,
  CHECK ((status = 'reserved') = (lease_expires_at IS NOT NULL)),
  CHECK (charged_credits <= reserved_credits)
);

CREATE INDEX llm_entitlement_reservation_lease_idx
  ON llm_entitlement_reservations (lease_expires_at, id)
  WHERE status = 'reserved';

CREATE TABLE llm_entitlement_ledger_entries (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id text NOT NULL,
  grant_id text REFERENCES llm_entitlement_grants(id),
  invocation_id text,
  reservation_id text REFERENCES llm_entitlement_reservations(id),
  kind text NOT NULL CHECK (kind IN ('grant', 'reserve', 'settle', 'release', 'adjustment')),
  available_delta bigint NOT NULL,
  reserved_delta bigint NOT NULL,
  spent_delta bigint NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX llm_entitlement_ledger_account_sequence
  ON llm_entitlement_ledger_entries(account_id, sequence);

CREATE TABLE llm_pricing_versions (
  id text PRIMARY KEY,
  alias text NOT NULL CHECK (alias = 'maxpower/coach-v1'),
  provider_id text NOT NULL,
  provider_model text NOT NULL,
  input_credits_per_million_tokens bigint NOT NULL CHECK (input_credits_per_million_tokens >= 0),
  output_credits_per_million_tokens bigint NOT NULL CHECK (output_credits_per_million_tokens >= 0),
  input_cost_micros_per_million_tokens bigint NOT NULL CHECK (input_cost_micros_per_million_tokens >= 0),
  output_cost_micros_per_million_tokens bigint NOT NULL CHECK (output_cost_micros_per_million_tokens >= 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE llm_gateway_invocations (
  id text PRIMARY KEY,
  owner_account_id text NOT NULL,
  alias text NOT NULL CHECK (alias = 'maxpower/coach-v1'),
  stream boolean NOT NULL,
  idempotency_fingerprint text NOT NULL,
  request_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('received', 'dispatching', 'running', 'cancel_requested', 'rejected', 'completed', 'failed')),
  reserved_credits bigint NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  settled_credits bigint NOT NULL DEFAULT 0 CHECK (settled_credits >= 0),
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (owner_account_id, idempotency_fingerprint)
);

CREATE TABLE llm_invocation_cancellations (
  owner_account_id text NOT NULL,
  idempotency_fingerprint text NOT NULL,
  requested_at timestamptz NOT NULL,
  PRIMARY KEY (owner_account_id, idempotency_fingerprint)
);

CREATE TABLE llm_usage_events (
  invocation_id text PRIMARY KEY REFERENCES llm_gateway_invocations(id),
  owner_account_id text NOT NULL,
  alias text NOT NULL CHECK (alias = 'maxpower/coach-v1'),
  provider_id text NOT NULL,
  provider_model text NOT NULL,
  pricing_version_id text NOT NULL REFERENCES llm_pricing_versions(id),
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  total_tokens bigint NOT NULL CHECK (total_tokens >= 0),
  cached_input_tokens bigint NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  image_tokens bigint NOT NULL DEFAULT 0 CHECK (image_tokens >= 0),
  provider_credits bigint NOT NULL CHECK (provider_credits >= 0),
  provider_cost_micros bigint NOT NULL DEFAULT 0 CHECK (provider_cost_micros >= 0),
  charged_credits bigint NOT NULL CHECK (charged_credits >= 0),
  recorded_at timestamptz NOT NULL,
  usage_basis text NOT NULL CHECK (usage_basis IN ('provider_reported', 'conservative_estimate')),
  CHECK (total_tokens = input_tokens + output_tokens),
  CHECK (cached_input_tokens <= input_tokens),
  CHECK (image_tokens <= input_tokens)
);

CREATE TABLE llm_provider_usage_reconciliations (
  id text PRIMARY KEY,
  invocation_id text NOT NULL REFERENCES llm_gateway_invocations(id),
  upstream_usage_id text NOT NULL,
  provider_id text NOT NULL,
  provider_model text NOT NULL,
  pricing_version_id text NOT NULL REFERENCES llm_pricing_versions(id),
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  total_tokens bigint NOT NULL CHECK (total_tokens >= 0),
  provider_cost_micros bigint NOT NULL CHECK (provider_cost_micros >= 0),
  reconciled_at timestamptz NOT NULL,
  UNIQUE (provider_id, upstream_usage_id),
  CHECK (total_tokens = input_tokens + output_tokens)
);

CREATE TABLE llm_invocation_recovery_events (
  invocation_id text PRIMARY KEY REFERENCES llm_gateway_invocations(id),
  account_id text NOT NULL,
  reservation_id text NOT NULL REFERENCES llm_entitlement_reservations(id),
  resolution text NOT NULL CHECK (
    resolution IN (
      'released_before_provider',
      'released_dispatch_pending_reconciliation',
      'charged_pending_reconciliation'
    )
  ),
  reserved_credits bigint NOT NULL CHECK (reserved_credits > 0),
  recovered_at timestamptz NOT NULL
);

COMMIT;
