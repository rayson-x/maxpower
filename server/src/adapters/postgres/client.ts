export interface PostgresQueryResult<Row> {
  rows: Row[];
}

export interface PostgresClient {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PostgresQueryResult<Row>>;
  release(): void;
}

export interface PostgresPool {
  connect(): Promise<PostgresClient>;
}
