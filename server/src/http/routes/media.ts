import { Hono } from "hono";
import { z } from "zod";

import type { AccessTokenVerifier } from "../authenticate.js";
import { authenticate, requireCapability } from "../authenticate.js";
import { optionalLimit, readJson, requireHeader } from "../request.js";
import { parseExpectedRevision, revisionEtag } from "../../kernel/revision.js";
import type { MediaLibrary } from "../../modules/media/model.js";
import { MAX_SINGLE_PUT_BYTES } from "../../modules/media/model.js";

const createUploadSchema = z
  .object({
    kind: z.enum(["video", "canonical_packet", "keypoints", "nutrition_photo"]),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(3).max(255),
    byteSize: z.number().int().positive().max(MAX_SINGLE_PUT_BYTES),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    parentAssetId: z.string().min(1).optional(),
  })
  .strict();

export interface MediaRouteDependencies {
  tokens: AccessTokenVerifier;
  media: MediaLibrary;
}

export function createMediaRoutes(dependencies: MediaRouteDependencies): Hono {
  const routes = new Hono();

  routes.post("/media/uploads", async (context) => {
    const principal = await readPrincipal(context, dependencies, "media:write");
    const body = await readJson(context, createUploadSchema);
    const created = await dependencies.media.createUpload(principal, {
      kind: body.kind,
      fileName: body.fileName,
      contentType: body.contentType,
      byteSize: body.byteSize,
      sha256: body.sha256,
      ...(body.parentAssetId === undefined ? {} : { parentAssetId: body.parentAssetId }),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    context.header("Location", `/v1/media/${created.asset.id}`);
    context.header("ETag", revisionEtag(created.upload.revision));
    return context.json(created, 201);
  });

  routes.post("/media/uploads/:uploadId/complete", async (context) => {
    const principal = await readPrincipal(context, dependencies, "media:write");
    const completed = await dependencies.media.completeUpload(principal, {
      uploadId: context.req.param("uploadId"),
      expectedRevision: parseExpectedRevision(context.req.header("if-match")),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    context.header("ETag", revisionEtag(completed.asset.revision));
    return context.json(completed);
  });

  routes.get("/media", async (context) => {
    const principal = await readPrincipal(context, dependencies, "media:read");
    const cursor = context.req.query("cursor");
    return context.json(await dependencies.media.listAssets(principal, {
      limit: optionalLimit(context.req.query("limit")),
      ...(cursor === undefined ? {} : { cursor }),
    }));
  });

  routes.get("/media/:assetId", async (context) => {
    const principal = await readPrincipal(context, dependencies, "media:read");
    const asset = await dependencies.media.getAsset(principal, context.req.param("assetId"));
    context.header("ETag", revisionEtag(asset.revision));
    return context.json(asset);
  });

  routes.post("/media/:assetId/download-url", async (context) => {
    const principal = await readPrincipal(context, dependencies, "media:read");
    return context.json(await dependencies.media.createDownload(principal, {
      assetId: context.req.param("assetId"),
    }));
  });

  routes.delete("/media/:assetId", async (context) => {
    const principal = await readPrincipal(context, dependencies, "media:write");
    const result = await dependencies.media.deleteAsset(principal, {
      assetId: context.req.param("assetId"),
      expectedRevision: parseExpectedRevision(context.req.header("if-match")),
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
    });
    return context.json({ status: "deleted", ...result }, 202);
  });

  return routes;
}

async function readPrincipal(
  context: Parameters<typeof authenticate>[0],
  dependencies: MediaRouteDependencies,
  scope: string,
) {
  const principal = await authenticate(context, dependencies.tokens);
  requireCapability(principal, scope);
  return principal;
}
