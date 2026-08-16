BEGIN;

CREATE SCHEMA IF NOT EXISTS maxpower;

CREATE TABLE IF NOT EXISTS maxpower.account_deletion_jobs (
  id text PRIMARY KEY,
  account_id text NOT NULL UNIQUE,
  request_key_hash text NOT NULL UNIQUE CHECK (
    request_key_hash ~ '^[a-f0-9]{64}$'
  ),
  deletion_receipt_hash text NOT NULL UNIQUE CHECK (
    deletion_receipt_hash ~ '^[a-f0-9]{64}$'
  ),
  status text NOT NULL CHECK (status IN ('pending', 'running', 'retryable', 'completed')),
  cleanup_stage text NOT NULL CHECK (
    cleanup_stage IN (
      'requested',
      'access_blocked',
      'media_objects_erased',
      'metadata_erased',
      'identity_erased'
    )
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  requested_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  last_error_code text,
  lease_expires_at timestamptz,
  CHECK (status <> 'completed' OR cleanup_stage = 'identity_erased'),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS account_deletion_claim_idx
  ON maxpower.account_deletion_jobs (requested_at, id)
  WHERE status IN ('pending', 'retryable', 'running');

COMMIT;
