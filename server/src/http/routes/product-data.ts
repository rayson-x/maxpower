import { Hono } from "hono";
import { z } from "zod";

import type { AccessTokenVerifier } from "../authenticate.js";
import { authenticate, requireCapability } from "../authenticate.js";
import { optionalLimit, readJson, requireHeader } from "../request.js";
import { parseExpectedRevision, revisionEtag } from "../../kernel/revision.js";
import type {
  JsonObject,
  JsonValue,
  ProductData,
} from "../../modules/product-data/model.js";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);
const mediaAssetIdsSchema = z.array(z.string().trim().min(1).max(500)).max(32);

const profilePatchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).nullable().optional(),
    locale: z.string().trim().min(2).max(35).optional(),
    timeZone: z.string().trim().min(1).max(100).optional(),
    unitSystem: z.enum(["metric", "imperial"]).optional(),
    data: jsonObjectSchema.optional(),
  })
  .strict();

const createPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    snapshot: jsonObjectSchema,
  })
  .strict();

const patchPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    snapshot: jsonObjectSchema.optional(),
  })
  .strict();

const createWorkoutSchema = z
  .object({
    planId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    data: jsonObjectSchema.optional(),
    mediaAssetIds: mediaAssetIdsSchema.optional(),
    startedAt: z.iso.datetime().optional(),
  })
  .strict();

const patchWorkoutSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    data: jsonObjectSchema.optional(),
    notes: z.string().max(4_000).nullable().optional(),
    startedAt: z.iso.datetime().optional(),
    mediaAssetIds: mediaAssetIdsSchema.optional(),
  })
  .strict();

const completeWorkoutSchema = z
  .object({
    summary: jsonObjectSchema,
    completedAt: z.iso.datetime().optional(),
  })
  .strict();

const createResultSchema = z
  .object({
    kind: z.string().trim().min(1).max(100),
    workoutSessionId: z.string().min(1).optional(),
    payload: jsonObjectSchema,
    provenance: jsonObjectSchema.optional(),
    mediaAssetIds: mediaAssetIdsSchema.optional(),
    occurredAt: z.iso.datetime().optional(),
  })
  .strict();

const patchResultSchema = z
  .object({
    kind: z.string().trim().min(1).max(100).optional(),
    payload: jsonObjectSchema.optional(),
    provenance: jsonObjectSchema.optional(),
    occurredAt: z.iso.datetime().optional(),
    mediaAssetIds: mediaAssetIdsSchema.optional(),
  })
  .strict();

export interface ProductRouteDependencies {
  tokens: AccessTokenVerifier;
  productData: ProductData;
}

export function createProductDataRoutes(dependencies: ProductRouteDependencies): Hono {
  const routes = new Hono();

  routes.get("/me", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:read");
    const profile = await dependencies.productData.getProfile(principal);
    context.header("ETag", revisionEtag(profile.revision));
    return context.json(profile);
  });

  routes.patch("/me", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    const body = await readJson(context, profilePatchSchema);
    const profile = await dependencies.productData.patchProfile(principal, {
      patch: {
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
        ...(body.locale === undefined ? {} : { locale: body.locale }),
        ...(body.timeZone === undefined ? {} : { timeZone: body.timeZone }),
        ...(body.unitSystem === undefined ? {} : { unitSystem: body.unitSystem }),
        ...(body.data === undefined ? {} : { data: body.data }),
      },
      expectedRevision: parseExpectedRevision(context.req.header("if-match")),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    context.header("ETag", revisionEtag(profile.revision));
    return context.json(profile);
  });

  routes.get("/plans", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:read");
    return context.json(await dependencies.productData.listPlans(principal, pageInput(context)));
  });

  routes.post("/plans", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    const body = await readJson(context, createPlanSchema);
    const plan = await dependencies.productData.createPlan(principal, {
      ...body,
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    context.header("Location", `/v1/plans/${plan.id}`);
    context.header("ETag", revisionEtag(plan.revision));
    return context.json(plan, 201);
  });

  routes.get("/plans/:planId", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:read");
    const plan = await dependencies.productData.getPlan(principal, context.req.param("planId"));
    context.header("ETag", revisionEtag(plan.revision));
    return context.json(plan);
  });

  routes.patch("/plans/:planId", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    const body = await readJson(context, patchPlanSchema);
    const plan = await dependencies.productData.patchPlan(principal, {
      planId: context.req.param("planId"),
      patch: {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.snapshot === undefined ? {} : { snapshot: body.snapshot }),
      },
      expectedRevision: parseExpectedRevision(context.req.header("if-match")),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    context.header("ETag", revisionEtag(plan.revision));
    return context.json(plan);
  });

  routes.post("/plans/:planId/publish", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    const plan = await dependencies.productData.publishPlan(principal, {
      planId: context.req.param("planId"),
      expectedRevision: parseExpectedRevision(context.req.header("if-match")),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    context.header("ETag", revisionEtag(plan.revision));
    return context.json(plan);
  });

  routes.delete("/plans/:planId", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    await dependencies.productData.deletePlan(principal, {
      planId: context.req.param("planId"),
      expectedRevision: parseExpectedRevision(context.req.header("if-match")),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    return context.body(null, 204);
  });

  routes.get("/workout-sessions", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:read");
    return context.json(
      await dependencies.productData.listWorkoutSessions(principal, pageInput(context)),
    );
  });

  routes.post("/workout-sessions", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    const body = await readJson(context, createWorkoutSchema);
    const workout = await dependencies.productData.createWorkoutSession(principal, {
      title: body.title,
      ...(body.planId === undefined ? {} : { planId: body.planId }),
      ...(body.data === undefined ? {} : { data: body.data }),
      ...(body.mediaAssetIds === undefined ? {} : { mediaAssetIds: body.mediaAssetIds }),
      ...(body.startedAt === undefined ? {} : { startedAt: body.startedAt }),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    context.header("Location", `/v1/workout-sessions/${workout.id}`);
    context.header("ETag", revisionEtag(workout.revision));
    return context.json(workout, 201);
  });

  routes.get("/workout-sessions/:workoutSessionId", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:read");
    const workout = await dependencies.productData.getWorkoutSession(
      principal,
      context.req.param("workoutSessionId"),
    );
    context.header("ETag", revisionEtag(workout.revision));
    return context.json(workout);
  });

  routes.patch("/workout-sessions/:workoutSessionId", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    const body = await readJson(context, patchWorkoutSchema);
    const workout = await dependencies.productData.patchWorkoutSession(principal, {
      workoutSessionId: context.req.param("workoutSessionId"),
      patch: {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.data === undefined ? {} : { data: body.data }),
        ...(body.notes === undefined ? {} : { notes: body.notes }),
        ...(body.startedAt === undefined ? {} : { startedAt: body.startedAt }),
        ...(body.mediaAssetIds === undefined ? {} : { mediaAssetIds: body.mediaAssetIds }),
      },
      expectedRevision: parseExpectedRevision(context.req.header("if-match")),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    context.header("ETag", revisionEtag(workout.revision));
    return context.json(workout);
  });

  routes.post("/workout-sessions/:workoutSessionId/complete", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    const body = await readJson(context, completeWorkoutSchema);
    const workout = await dependencies.productData.completeWorkoutSession(principal, {
      workoutSessionId: context.req.param("workoutSessionId"),
      summary: body.summary,
      ...(body.completedAt === undefined ? {} : { completedAt: body.completedAt }),
      expectedRevision: parseExpectedRevision(context.req.header("if-match")),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    context.header("ETag", revisionEtag(workout.revision));
    return context.json(workout);
  });

  routes.delete("/workout-sessions/:workoutSessionId", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    await dependencies.productData.deleteWorkoutSession(principal, {
      workoutSessionId: context.req.param("workoutSessionId"),
      expectedRevision: parseExpectedRevision(context.req.header("if-match")),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    return context.body(null, 204);
  });

  routes.get("/results", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:read");
    return context.json(await dependencies.productData.listResults(principal, pageInput(context)));
  });

  routes.post("/results", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    const body = await readJson(context, createResultSchema);
    const result = await dependencies.productData.createResult(principal, {
      kind: body.kind,
      payload: body.payload,
      ...(body.workoutSessionId === undefined
        ? {}
        : { workoutSessionId: body.workoutSessionId }),
      ...(body.provenance === undefined ? {} : { provenance: body.provenance }),
      ...(body.mediaAssetIds === undefined ? {} : { mediaAssetIds: body.mediaAssetIds }),
      ...(body.occurredAt === undefined ? {} : { occurredAt: body.occurredAt }),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    context.header("Location", `/v1/results/${result.id}`);
    context.header("ETag", revisionEtag(result.revision));
    return context.json(result, 201);
  });

  routes.get("/results/:resultId", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:read");
    const result = await dependencies.productData.getResult(
      principal,
      context.req.param("resultId"),
    );
    context.header("ETag", revisionEtag(result.revision));
    return context.json(result);
  });

  routes.patch("/results/:resultId", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    const body = await readJson(context, patchResultSchema);
    const result = await dependencies.productData.patchResult(principal, {
      resultId: context.req.param("resultId"),
      patch: {
        ...(body.kind === undefined ? {} : { kind: body.kind }),
        ...(body.payload === undefined ? {} : { payload: body.payload }),
        ...(body.provenance === undefined ? {} : { provenance: body.provenance }),
        ...(body.occurredAt === undefined ? {} : { occurredAt: body.occurredAt }),
        ...(body.mediaAssetIds === undefined ? {} : { mediaAssetIds: body.mediaAssetIds }),
      },
      expectedRevision: parseExpectedRevision(context.req.header("if-match")),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    context.header("ETag", revisionEtag(result.revision));
    return context.json(result);
  });

  routes.delete("/results/:resultId", async (context) => {
    const principal = await readPrincipal(context, dependencies, "data:write");
    await dependencies.productData.deleteResult(principal, {
      resultId: context.req.param("resultId"),
      expectedRevision: parseExpectedRevision(context.req.header("if-match")),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    return context.body(null, 204);
  });

  return routes;
}

function pageInput(context: Parameters<typeof authenticate>[0]) {
  const cursor = context.req.query("cursor");
  return {
    limit: optionalLimit(context.req.query("limit")),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

async function readPrincipal(
  context: Parameters<typeof authenticate>[0],
  dependencies: ProductRouteDependencies,
  scope: string,
) {
  const principal = await authenticate(context, dependencies.tokens);
  requireCapability(principal, scope);
  return principal;
}
