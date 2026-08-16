BEGIN;

CREATE SCHEMA IF NOT EXISTS maxpower;

CREATE TABLE IF NOT EXISTS maxpower.media_assets (
  account_id text NOT NULL,
  id text NOT NULL,
  kind text NOT NULL CHECK (
    kind IN ('video', 'canonical_packet', 'keypoints', 'nutrition_photo')
  ),
  file_name text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  object_key text NOT NULL UNIQUE,
  object_etag text,
  object_version_id text,
  status text NOT NULL CHECK (status IN ('uploading', 'ready')),
  purpose text NOT NULL DEFAULT 'personal' CHECK (purpose = 'personal'),
  verification text NOT NULL CHECK (
    verification IN ('unverified_metadata', 'object_metadata_verified')
  ),
  revision integer NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  ready_at timestamptz,
  deleted_at timestamptz,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE IF NOT EXISTS maxpower.media_uploads (
  account_id text NOT NULL,
  id text NOT NULL,
  asset_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled')),
  byte_transfer text NOT NULL CHECK (byte_transfer = 'presigned_put'),
  revision integer NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  cancelled_at timestamptz,
  PRIMARY KEY (account_id, id),
  FOREIGN KEY (account_id, asset_id)
    REFERENCES maxpower.media_assets (account_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS maxpower.workout_session_media_references (
  account_id text NOT NULL,
  workout_session_id text NOT NULL,
  asset_id text NOT NULL,
  evidence_status text NOT NULL DEFAULT 'available' CHECK (
    evidence_status IN ('available', 'evidence_deleted')
  ),
  linked_at timestamptz NOT NULL,
  evidence_deleted_at timestamptz,
  PRIMARY KEY (account_id, workout_session_id, asset_id),
  FOREIGN KEY (account_id, workout_session_id)
    REFERENCES maxpower.workout_sessions (account_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (account_id, asset_id)
    REFERENCES maxpower.media_assets (account_id, id)
    ON DELETE RESTRICT,
  CHECK (
    (evidence_status = 'available' AND evidence_deleted_at IS NULL)
    OR (evidence_status = 'evidence_deleted' AND evidence_deleted_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS maxpower.result_media_references (
  account_id text NOT NULL,
  result_id text NOT NULL,
  asset_id text NOT NULL,
  evidence_status text NOT NULL DEFAULT 'available' CHECK (
    evidence_status IN ('available', 'evidence_deleted')
  ),
  linked_at timestamptz NOT NULL,
  evidence_deleted_at timestamptz,
  PRIMARY KEY (account_id, result_id, asset_id),
  FOREIGN KEY (account_id, result_id)
    REFERENCES maxpower.results (account_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (account_id, asset_id)
    REFERENCES maxpower.media_assets (account_id, id)
    ON DELETE RESTRICT,
  CHECK (
    (evidence_status = 'available' AND evidence_deleted_at IS NULL)
    OR (evidence_status = 'evidence_deleted' AND evidence_deleted_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS maxpower.media_asset_relations (
  account_id text NOT NULL,
  parent_asset_id text NOT NULL,
  child_asset_id text NOT NULL,
  relation_type text NOT NULL CHECK (relation_type = 'derived_from'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, parent_asset_id, child_asset_id),
  CHECK (parent_asset_id <> child_asset_id),
  FOREIGN KEY (account_id, parent_asset_id)
    REFERENCES maxpower.media_assets (account_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (account_id, child_asset_id)
    REFERENCES maxpower.media_assets (account_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS maxpower.media_idempotency (
  account_id text NOT NULL,
  idempotency_key text NOT NULL,
  operation text NOT NULL,
  fingerprint text NOT NULL,
  result_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS maxpower.media_deletion_jobs (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  root_asset_id text NOT NULL,
  deleted_asset_ids jsonb NOT NULL CHECK (jsonb_typeof(deleted_asset_ids) = 'array'),
  object_keys jsonb NOT NULL CHECK (jsonb_typeof(object_keys) = 'array'),
  not_before timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'retryable', 'completed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (account_id, root_asset_id)
);

CREATE INDEX IF NOT EXISTS media_assets_account_created_idx
  ON maxpower.media_assets (account_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS media_relations_parent_idx
  ON maxpower.media_asset_relations (account_id, parent_asset_id);
CREATE INDEX IF NOT EXISTS media_uploads_asset_idx
  ON maxpower.media_uploads (account_id, asset_id);
CREATE INDEX IF NOT EXISTS media_uploads_expiry_idx
  ON maxpower.media_uploads (expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS workout_media_asset_idx
  ON maxpower.workout_session_media_references (account_id, asset_id);
CREATE INDEX IF NOT EXISTS result_media_asset_idx
  ON maxpower.result_media_references (account_id, asset_id);
CREATE INDEX IF NOT EXISTS media_deletion_jobs_ready_idx
  ON maxpower.media_deletion_jobs (not_before, created_at)
  WHERE status IN ('queued', 'retryable', 'running');

COMMIT;
