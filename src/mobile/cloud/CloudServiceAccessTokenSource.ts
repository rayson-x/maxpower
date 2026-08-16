export interface CloudServiceAccessTokenSource {
  /** Service JWTs are short-lived and read from memory for every request. */
  accessTokenFor(accountId: string): string | Promise<string>;
}
