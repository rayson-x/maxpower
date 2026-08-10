import { randomUUID } from "node:crypto";

export type IdFactory = (prefix: string) => string;

export const randomId: IdFactory = (prefix) => `${prefix}_${randomUUID()}`;
