/**
 * Database interface for materialization operations.
 * 
 * All db adapters must provide a transaction-bound instance that implements this.
 * All materializer executors receive this as the first parameter.
 * 
 * Supports both synchronous and asynchronous operations:
 * - Sync: Methods return values directly (e.g., SQLite with better-sqlite3)
 * - Async: Methods return Promises (e.g., Turso, PostgreSQL)
 */
export type MaterializerDb = {
  /**
   * Execute a query/command that returns a single row/document.
   * Returns null if no result found.
   * 
   * Can return synchronously (sync databases) or as a Promise (async databases).
   */
  get<T = unknown>(query: string, params: unknown[]): Promise<T | null> | T | null;

  /**
   * Execute a query/command that doesn't return rows (INSERT/UPDATE/DELETE, etc.).
   * 
   * Can return synchronously (sync databases) or as a Promise (async databases).
   */
  run(command: string, params: unknown[]): Promise<void> | void;
};
