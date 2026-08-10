export interface PostgresQueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

/** Structurally compatible with the query surface of pg.Pool and pg.PoolClient. */
export interface PostgresQueryable {
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<PostgresQueryResult<Row>>;
}
