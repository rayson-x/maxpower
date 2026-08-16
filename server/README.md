# MaxPower Server

Independent server-first implementation for authenticated cloud product data, optional private media, and the MaxPower LLM gateway. It does not import the Expo client.

## Runtime boundary

The versioned HTTP API is the stable interface. Production composes only durable adapters:

- Better Auth + PostgreSQL for email/phone/password, Google/Apple, explicit identity linking, sessions, and short-lived EdDSA service JWTs.
- PostgreSQL for profiles, immutable plan versions, workout sessions, structured results, idempotency, LLM entitlements, usage, and deletion jobs.
- A private S3-compatible bucket for optional video, canonical packets, keypoints, and nutrition photos.
- An OpenAI-compatible provider behind the two product aliases `maxpower/coach-v1` and `maxpower/nutrition-vision-v1`.
- A dedicated non-persistent Redis for five-minute SSE replay and a separate shared Redis for rate limiting.

Prompts, responses, images, tool arguments, and conversations are not persisted by the gateway. Usage rows retain token totals, the internal provider route/pricing version, credits, and provider cost in micros.

## Local contract runtime

```bash
npm ci
npm run check
MAXPOWER_RUNTIME=memory npm run dev
```

The memory runtime exposes a debug OTP only for local contract tests. It refuses to start when `NODE_ENV=production`.

## Production configuration

Production parses the complete environment once and fails with all missing/invalid variable names. See [.env.example](./.env.example). In particular:

- All public auth, provider, object-storage, and CORS URLs must be HTTPS. PostgreSQL must request TLS and both Redis URLs must use `rediss://`.
- `AUTH_SECRET`, provider keys, OAuth secrets, database credentials, Redis credentials, object-storage credentials, and `LLM_FINGERPRINT_SECRET` belong in the deployment secret manager. Never place them in an image, repository, log, APM attribute, or error report.
- `STREAM_REDIS_PERSISTENCE=disabled` is mandatory. Its Redis deployment must disable RDB, AOF, managed backups, and durable cross-region copies. It must not be the rate-limit Redis.
- User credit rates and actual provider cost-micros rates are separate required values. Changing either requires a new pricing-version ID.
- Each alias has required `MAX_INPUT_BYTES`, `MAX_INPUT_TOKENS`, `MAX_OUTPUT_TOKENS`, `MAX_IMAGES`, and `MAX_IMAGE_BYTES` limits. Startup computes the worst-case credit reservation from those caps; requests that exceed them stop before the provider, and the provider request is clamped to the configured output-token ceiling.
- `AUTH_DEBUG_OTP`, `LOCAL_DEBUG_OTP`, and `MAXPOWER_DEBUG_OTP` are startup errors in production.

The service emits fixed JSON metadata events only. HTTP logs contain request ID, method, route path, status, and duration. Configure APM/error tooling to disable header, query, body, local-variable, SQL-parameter, LLM-content, and credential capture.

## Native social authentication

Google/Apple login uses the server-owned device-bound handoff, not a client
Better Auth cookie bridge. The client generates a 32-byte random hex
`deviceBinding`, keeps it in platform secure storage, and sends it only over
HTTPS:

1. `POST /v1/auth/social/start` returns an HTTPS `authorizationUrl` and opaque
   `exchangeState`.
2. The provider returns to the reviewed HTTPS callback. Better Auth cookies are
   resolved into short-lived server-side state and are not forwarded.
3. The exact native callback receives only `code` and `state`, or `error` and
   `state` when the provider flow fails.
4. `POST /v1/auth/social/exchange` binds the code, state, callback URL, and
   `deviceBinding`, atomically consumes the code, and returns only
   `sessionToken`. The client then calls `POST /v1/auth/refresh`.

The raw Better Auth social sign-in, native proxy, session, token, and sign-out
routes are not public. Do not log callback query strings, request bodies,
cookies, exchange codes, states, or device bindings.

## HTTPS and trusted ingress

The Node process listens on private container HTTP; TLS terminates at a controlled reverse proxy/load balancer. The API always emits HSTS, exact-origin CORS, `no-store`, request IDs, and other response hardening headers.

`docker-compose.yml` uses `expose`, never `ports`, so it is not a public ingress definition. Attach the controlled HTTPS proxy to the private network. The proxy must:

1. strip client-supplied `CF-Connecting-IP` and `X-Real-IP`;
2. set exactly one trusted client-IP header;
3. reject direct access to the container port;
4. enforce its own connection/header/time limits.

`HTTP_TRUST_PROXY_HEADERS=controlled-ingress-only` is an operational acknowledgement of that boundary. The application hashes the resulting identity before using it as a rate-limit key.

## Migrate, deploy, and operate

The reviewed migration chain is fixed and checksum-protected:

```text
010-better-auth.sql
020-product-data.sql
030-media-library.sql
040-llm-entitlements.sql
050-account-deletion.sql
```

The runner takes a PostgreSQL advisory lock and records each file checksum in the same transaction as its schema changes.
The migration entrypoint parses a least-privilege environment containing only `NODE_ENV=production` and the TLS `DATABASE_URL`; it does not require or receive OAuth, OTP, object-storage, Redis, or LLM provider secrets.

```bash
npm run build
npm run release:check
npm run migrate:prod
npm start
npm run worker:prod
```

With Compose, populate the ignored `server/.env` from the secret manager and run the one-shot migration before the API/worker image:

```bash
docker compose --profile ops run --rm migrate
docker compose up -d api worker
```

`GET /healthz` checks the process. `GET /readyz` requires PostgreSQL, both Redis roles, and `HeadBucket` access to private object storage. A failed dependency returns only `503 {"status":"not_ready"}` without the dependency error.

Give the API/worker bucket identity only the private bucket permissions it uses: bucket head/list-versions plus object put/get/head/delete-version under the MaxPower prefix. The deletion worker specifically needs version and delete-marker listing/deletion; omitting those permissions leaves a retryable deletion job rather than falsely marking cleanup complete.

Deploy the API and deletion worker from the same immutable image. Roll application code back by restoring the previous image tag. Migrations are forward-only and additive for this release; do not edit an applied SQL file because checksum verification will stop deployment. Before rollout, take normal PostgreSQL/object-storage recovery points under the infrastructure retention policy (the volatile stream Redis is excluded).

## Release validation

`npm run release:check` runs the full server typecheck/test suite, builds the exact production JavaScript, and invokes `npm run release:scan` on the built artifacts. The scan checks common credential formats plus every configured runtime secret value. Findings contain only a rule and file name; the scanner never prints the matched value. Set `MAXPOWER_RELEASE_SCAN_PATHS` to a comma-separated list when CI must scan additional generated bundles.

`npm run release:privacy` is the focused log/persistence gate. It verifies that HTTP logs, worker/OTP errors, and durable LLM usage omit Authorization, credentials, prompts, responses, images, and tool arguments. The full release check also runs these tests.

After deploying staging, CI sets an ephemeral staging user's `MAXPOWER_STAGING_ACCESS_TOKEN`, exact HTTPS `MAXPOWER_STAGING_BASE_URL`, and a TLS `MAXPOWER_STAGING_DATABASE_URL` for a read-only role limited to content-free `llm_usage_events` columns. Full release evidence also requires the matching `MAXPOWER_STAGING_SCENARIO_*` URL, token, and read-only database URL for a separate Gateway deployment whose deterministic synthetic Provider recognizes the fixed tool, cancellation, timeout, and outage probe messages. Then run:

```bash
npm run release:provider-smoke
# or run every local gate and the optional staging probe
npm run release:verify
```

The probe checks health, readiness, the OpenAPI 3.1 document, JSON/SSE, normalized usage through the read-only content-free audit seam, a deterministic tool call, explicit durable cancellation, Provider timeout, and Provider outage without local fallback. It sends only the fixed `MAXPOWER_SYNTHETIC_RELEASE_PROBE`, `MAXPOWER_SYNTHETIC_TOOL_PROBE`, `MAXPOWER_SYNTHETIC_CANCEL_PROBE`, `MAXPOWER_SYNTHETIC_TIMEOUT_PROBE`, and `MAXPOWER_SYNTHETIC_OUTAGE_PROBE` messages and logs status metadata only. If the primary staging credentials are absent it exits successfully with `staging_credentials_unset`; if primary credentials exist but the deterministic scenario deployment is not configured, it exits non-zero with `staging_scenario_probe_unset`. Invalid HTTPS configuration or any contract failure also exits non-zero. Use dedicated low-privilege staging accounts because the probes consume configured credits. The scenario Provider must keep the cancellation stream open until the cancel endpoint is called, return exactly one `release_probe` tool call with normalized usage, hang until the Gateway timeout for the timeout message, and fail immediately for the outage message.

## Account/media deletion

`POST /v1/me/deletion` immediately marks the account pending deletion and revokes service access. The worker is idempotent and retryable. Before the final object sweep it waits until the later of (a) the authoritative maximum `media_uploads.expires_at` and (b) `requested_at + MEDIA_TRANSFER_EXPIRY_SECONDS`. The second lower bound covers a presigned URL generated immediately before deletion whose database transaction subsequently failed. It then deletes every object version and delete marker below the account's hashed prefix before explicitly removing workout/result media references, product/media metadata, entitlements/sessions, and Better Auth identity rows. Media signing/re-signing rechecks the live account status inside its database transaction, so no new target can appear after the deletion barrier. Together these rules prevent a previously signed upload from recreating an orphan object after the final sweep.

Run exactly one or more worker replicas; PostgreSQL claims jobs with `SKIP LOCKED` and a lease.

## LLM grants

A valid account receives the current UTC month's configured free grant lazily before its first entitlement query or invocation. The `(account, month)` grant is deterministic and idempotent. The amount is configuration, not a public grant endpoint.

Support/admin adjustments use the non-HTTP CLI with an auditable source reference:

```bash
npm run admin:grant:prod -- account_123 900 support-case-456
```

The command prints only whether the idempotent grant was created and a short account hash; it does not print balances, database URLs, or credentials.

## Public routes

- Identity contract: `/v1/auth/*`
- Reviewed Better Auth OAuth/JWKS bridge: `/api/auth/*` (all non-allowlisted raw Better Auth endpoints return 404)
- Profile: `/v1/me`
- Plans: `/v1/plans/*`
- Workouts: `/v1/workout-sessions/*`
- Results: `/v1/results/*`
- Optional media: `/v1/media/*`
- LLM: `/v1/chat/completions`, `/v1/invocations/:id/events`, `/v1/invocations/cancel`, `/v1/entitlements/me`
- Account deletion: `/v1/me/deletion`
- Operations: `/healthz`, `/readyz`, `/openapi.json`

Authenticated ownership always comes from the verified, live session-backed service JWT. Request bodies cannot select an account. Mutable commands use `Idempotency-Key` and/or revision preconditions as documented in OpenAPI.
