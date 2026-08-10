import { Hono } from "hono";
import { z } from "zod";

import { ApiError } from "../../kernel/api-error.js";
import type { AccountDeletion } from "../../modules/account-deletion/model.js";
import type { LlmGatewayModule } from "../../modules/llm/model.js";
import { authenticate, type AccessTokenVerifier } from "../authenticate.js";
import { readJson, requireHeader } from "../request.js";

const requestDeletionSchema = z
  .object({ confirmation: z.literal("DELETE") })
  .strict();

export interface AccountDeletionRouteDependencies {
  tokens: AccessTokenVerifier;
  accountDeletion: AccountDeletion;
  llm?: Pick<LlmGatewayModule, "cancelAccount">;
}

export function createAccountDeletionRoutes(
  dependencies: AccountDeletionRouteDependencies,
): Hono {
  const routes = new Hono();

  routes.post("/me/deletion", async (context) => {
    const body = await readJson(context, requestDeletionSchema);
    const idempotencyKey = requireHeader(context, "Idempotency-Key");
    let principal;
    try {
      principal = await authenticate(context, dependencies.tokens);
    } catch (error) {
      if (!isAuthenticationFailure(error)) throw error;
      const replay = await existingRequest(dependencies.accountDeletion, idempotencyKey);
      if (replay !== undefined) return context.json(receiptRecoveryResponse(replay), 202);
      throw error;
    }
    const job = await dependencies.accountDeletion.request(principal, {
      confirmation: body.confirmation,
      idempotencyKey,
    });
    await dependencies.llm?.cancelAccount?.(principal.accountId);
    return context.json(job, 202);
  });

  routes.get("/me/deletion", async (context) => {
    const receipt = context.req.header("deletion-receipt")?.trim();
    if (receipt) {
      return context.json(receiptStatusResponse(await dependencies.accountDeletion.getByReceipt(receipt)));
    }
    const principal = await authenticate(context, dependencies.tokens);
    return context.json(await dependencies.accountDeletion.get(principal));
  });

  return routes;
}

function isAuthenticationFailure(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

async function existingRequest(
  deletion: AccountDeletion,
  idempotencyKey: string,
) {
  try {
    return await deletion.getByRequestKey(idempotencyKey);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

function receiptStatusResponse(job: Awaited<ReturnType<AccountDeletion["getByReceipt"]>>) {
  const { accountId: _accountId, deletionReceipt: _receipt, ...status } = job;
  return status;
}

function receiptRecoveryResponse(job: Awaited<ReturnType<AccountDeletion["getByRequestKey"]>>) {
  const { accountId: _accountId, ...status } = job;
  return status;
}
