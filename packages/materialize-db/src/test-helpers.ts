import Database from "better-sqlite3";
import pg from "pg";
import type { Db } from "./types";

export type TestSchema = {
  todos: {
    id: string;
    title: string;
    done: boolean;
  };
};

// SQLite Db adapter
export function createSqliteDb(): Db {
  const db = new Database(":memory:");
  return {
    async get<T>(query: string, params: unknown[]): Promise<T | null> {
      const stmt = db.prepare(query);
      const row = stmt.get(...params) as T | undefined;
      return row ?? null;
    },
    async run(command: string, params: unknown[]): Promise<void> {
      db.prepare(command).run(...params);
    },
  };
}

// PostgreSQL Db adapter
export function createPostgresDb(connectionString: string): {
  db: Db;
  close: () => Promise<void>;
} {
  const client = new pg.Client({ connectionString });
  let connected = false;
  let closing = false;

  const connect = async () => {
    if (!connected && !closing) {
      await client.connect();
      connected = true;
    }
  };

  const db: Db = {
    async get<T>(query: string, params: unknown[]): Promise<T | null> {
      await connect();
      if (closing) throw new Error("Database connection is closing");
      const result = await client.query(query, params);
      return (result.rows[0] as T) ?? null;
    },
    async run(command: string, params: unknown[]): Promise<void> {
      await connect();
      if (closing) throw new Error("Database connection is closing");
      await client.query(command, params);
    },
  };

  return {
    db,
    close: async () => {
      if (connected && !closing) {
        closing = true;
        try {
          await client.end();
        } catch (error) {
          console.error("Error closing database connection", error);
          // Ignore errors during cleanup
        }
        connected = false;
        closing = false;
      }
    },
  };
}
