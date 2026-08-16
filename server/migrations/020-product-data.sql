BEGIN;

CREATE SCHEMA IF NOT EXISTS maxpower;

CREATE TABLE IF NOT EXISTS maxpower.profiles (
  account_id text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  display_name text,
  locale text NOT NULL,
  time_zone text NOT NULL,
  unit_system text NOT NULL CHECK (unit_system IN ('metric', 'imperial')),
  revision integer NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS maxpower.plans (
  account_id text NOT NULL,
  id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  current_version_id text NOT NULL,
  published_version_id text,
  revision integer NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE IF NOT EXISTS maxpower.plan_versions (
  account_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  version_number integer NOT NULL CHECK (version_number >= 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  PRIMARY KEY (account_id, id),
  UNIQUE (account_id, plan_id, version_number),
  FOREIGN KEY (account_id, plan_id)
    REFERENCES maxpower.plans (account_id, id)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION maxpower.guard_immutable_plan_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'plan version snapshots are immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'published plan versions cannot be unpublished or republished'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plan_versions_immutable ON maxpower.plan_versions;
CREATE TRIGGER plan_versions_immutable
BEFORE UPDATE ON maxpower.plan_versions
FOR EACH ROW EXECUTE FUNCTION maxpower.guard_immutable_plan_version();

CREATE TABLE IF NOT EXISTS maxpower.workout_sessions (
  account_id text NOT NULL,
  id text NOT NULL,
  plan_id text,
  plan_version_id text,
  plan_snapshot jsonb,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('in_progress', 'completed')),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  summary jsonb CHECK (summary IS NULL OR jsonb_typeof(summary) = 'object'),
  notes text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  revision integer NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (account_id, id),
  CHECK ((plan_id IS NULL) = (plan_version_id IS NULL)),
  CHECK (plan_snapshot IS NULL OR jsonb_typeof(plan_snapshot) = 'object'),
  FOREIGN KEY (account_id, plan_id)
    REFERENCES maxpower.plans (account_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS maxpower.results (
  account_id text NOT NULL,
  id text NOT NULL,
  kind text NOT NULL,
  workout_session_id text,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  occurred_at timestamptz NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (account_id, id),
  FOREIGN KEY (account_id, workout_session_id)
    REFERENCES maxpower.workout_sessions (account_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS maxpower.workout_session_revisions (
  account_id text NOT NULL,
  workout_session_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, workout_session_id, revision),
  FOREIGN KEY (account_id, workout_session_id)
    REFERENCES maxpower.workout_sessions (account_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS maxpower.result_revisions (
  account_id text NOT NULL,
  result_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, result_id, revision),
  FOREIGN KEY (account_id, result_id)
    REFERENCES maxpower.results (account_id, id)
    ON DELETE CASCADE
);

INSERT INTO maxpower.workout_session_revisions
  (account_id, workout_session_id, revision, snapshot, recorded_at)
SELECT account_id, id, revision, to_jsonb(workout_sessions), updated_at
  FROM maxpower.workout_sessions
ON CONFLICT (account_id, workout_session_id, revision) DO NOTHING;

INSERT INTO maxpower.result_revisions
  (account_id, result_id, revision, snapshot, recorded_at)
SELECT account_id, id, revision, to_jsonb(results), updated_at
  FROM maxpower.results
ON CONFLICT (account_id, result_id, revision) DO NOTHING;

CREATE OR REPLACE FUNCTION maxpower.guard_immutable_product_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'product history revisions are immutable' USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS workout_session_revisions_immutable
  ON maxpower.workout_session_revisions;
CREATE TRIGGER workout_session_revisions_immutable
BEFORE UPDATE ON maxpower.workout_session_revisions
FOR EACH ROW EXECUTE FUNCTION maxpower.guard_immutable_product_revision();

DROP TRIGGER IF EXISTS result_revisions_immutable ON maxpower.result_revisions;
CREATE TRIGGER result_revisions_immutable
BEFORE UPDATE ON maxpower.result_revisions
FOR EACH ROW EXECUTE FUNCTION maxpower.guard_immutable_product_revision();

CREATE TABLE IF NOT EXISTS maxpower.product_idempotency (
  account_id text NOT NULL,
  idempotency_key text NOT NULL,
  operation text NOT NULL,
  fingerprint text NOT NULL,
  result_jsonb jsonb,
  result_is_undefined boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, idempotency_key),
  CHECK (result_is_undefined OR result_jsonb IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS plans_account_created_idx
  ON maxpower.plans (account_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS workout_sessions_account_created_idx
  ON maxpower.workout_sessions (account_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS results_account_created_idx
  ON maxpower.results (account_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

COMMIT;
