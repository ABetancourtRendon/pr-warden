// Shared query helper and mock client for the orders service.

export function query(client, sql) {
  return client.query(sql);
}

// Minimal stand-in for a database driver, used for local runs.
export function createMockClient() {
  return {
    query(sql) {
      return Promise.resolve({ sql, rows: [], rowCount: 0 });
    }
  };
}
