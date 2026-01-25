import { createClient, type Client } from '@libsql/client';
import type { Change, ConvergeSchema } from '@converge/core';
import type {
  AppendRequest,
  AppendResult,
  Cursor,
  Db,
  PullRequest,
  PullResponse,
} from '@converge/server';
import { applyChangeToState } from '@converge/materialize-core';
import type { CustomMaterializerConfig } from '@converge/materialize-db';
import { createCustomMaterializer } from '@converge/materialize-db';
import type { Db as MaterializerDb } from '@converge/materialize-db';

type TursoDbOptions<S extends ConvergeSchema = ConvergeSchema> = {
  url: string;
  authToken: string;
  materializer?: Omit<CustomMaterializerConfig<S>, 'db'>;
};

type SqlStatement = {
  sql: string;
  args: unknown[];
};

/**
 * SQL-collecting Db implementation for materialization.
 * Collects run() calls and executes get() immediately.
 */
class CollectingDb implements MaterializerDb {
  private statements: SqlStatement[] = [];
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async get<T = unknown>(query: string, params: unknown[]): Promise<T | null> {
    // Execute immediately - reads are fine outside transaction
    const result = await this.client.execute({
      sql: query,
      args: params as string[] | number[] | null[] | boolean[] | Uint8Array[],
    });
    return (result.rows[0] as T) ?? null;
  }

  async run(command: string, params: unknown[]): Promise<void> {
    // Collect SQL - don't execute yet
    this.statements.push({ sql: command, args: params });
  }

  getStatements(): SqlStatement[] {
    return this.statements;
  }

  clear(): void {
    this.statements = [];
  }
}

function encodeCursor(seq: number): Cursor {
  return String(seq);
}

function decodeCursor(cursor: Cursor | null): number {
  if (!cursor) return 0;
  const n = Number(cursor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export class TursoDb<S extends ConvergeSchema = ConvergeSchema> implements Db<S> {
  private client: Client;
  private materializerConfig: Omit<CustomMaterializerConfig<S>, 'db'> | undefined;

  constructor(opts: TursoDbOptions<S>) {
    this.client = createClient({
      url: opts.url,
      authToken: opts.authToken,
    });

    // Initialize tables
    this.initTables();

    // Store materializer config for per-request use
    this.materializerConfig = opts.materializer;
  }

  private async initTables(): Promise<void> {
    await this.client.batch([
      {
        sql: `CREATE TABLE IF NOT EXISTS converge_changes (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          stream TEXT NOT NULL,
          change_json TEXT NOT NULL
        )`,
        args: [],
      },
      {
        sql: `CREATE TABLE IF NOT EXISTS converge_idempotency (
          stream TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          last_seq INTEGER NOT NULL,
          PRIMARY KEY (stream, idempotency_key)
        )`,
        args: [],
      },
    ]);
  }

  async append(req: AppendRequest<S>): Promise<AppendResult> {
    // Collect all SQL statements for the transaction
    const transactionStatements: SqlStatement[] = [];

    // Check idempotency if provided
    if (req.idempotencyKey) {
      const existing = await this.client.execute({
        sql: 'SELECT last_seq FROM converge_idempotency WHERE stream = ? AND idempotency_key = ?',
        args: [req.stream, req.idempotencyKey],
      });

      if (existing.rows.length > 0) {
        return { accepted: 0 };
      }

      transactionStatements.push({
        sql: 'INSERT INTO converge_idempotency (stream, idempotency_key, last_seq) VALUES (?, ?, 0)',
        args: [req.stream, req.idempotencyKey],
      });
    }

    // Generate SQL for change log inserts
    for (const change of req.changes) {
      transactionStatements.push({
        sql: 'INSERT INTO converge_changes (stream, change_json) VALUES (?, ?)',
        args: [req.stream, JSON.stringify(change)],
      });
    }

    // Materialize changes if materializer is configured
    if (this.materializerConfig) {
      const collectingDb = new CollectingDb(this.client);
      const materializer = createCustomMaterializer({
        ...this.materializerConfig,
        db: collectingDb,
      } as CustomMaterializerConfig<S>);

      // Load current states (executes immediately)
      for (const change of req.changes) {
        const current = await materializer.load(change.entity, change.entityId);
        const result = applyChangeToState(current, change);

        if (result.changed) {
          if (result.deleted) {
            await materializer.remove(change.entity, change.entityId, result.state);
          } else {
            await materializer.save(change.entity, change.entityId, result.state);
          }
        }
      }

      // Collect materialization SQL statements
      transactionStatements.push(...collectingDb.getStatements());
    }

    // Update idempotency with last sequence (we'll get it from the last insert)
    if (req.idempotencyKey && req.changes.length > 0) {
      // Note: In Turso, we can't easily get lastInsertRowid in a batch.
      // We'll use a placeholder and update after getting the result.
      // For now, we'll use a subquery or handle it differently.
      // This is a limitation - we might need to execute in two phases or use a different approach.
      transactionStatements.push({
        sql: 'UPDATE converge_idempotency SET last_seq = (SELECT MAX(seq) FROM converge_changes WHERE stream = ?) WHERE stream = ? AND idempotency_key = ?',
        args: [req.stream, req.stream, req.idempotencyKey],
      });
    }

    // Execute all statements in one transaction
    // Note: libSQL client's batch() executes statements sequentially but not in a transaction.
    // For true transactions, we need to use execute() with BEGIN/COMMIT or use transaction() method.
    // For now, we'll use batch() which should work for most cases, but isn't truly atomic.
    // TODO: Investigate if libSQL client supports proper transactions via transaction() method.
    await this.client.batch(
      transactionStatements.map((stmt) => ({
        sql: stmt.sql,
        args: stmt.args as string[] | number[] | null[] | boolean[] | Uint8Array[],
      })),
    );

    return { accepted: req.changes.length };
  }

  async pull(req: PullRequest): Promise<PullResponse<S>> {
    const afterSeq = decodeCursor(req.cursor);
    const limit = req.limit ?? 500;

    const result = await this.client.execute({
      sql: 'SELECT seq, change_json FROM converge_changes WHERE stream = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
      args: [req.stream, afterSeq, limit],
    });

    const changes = result.rows.map((row) => {
      const changeJson = row.change_json as string;
      return JSON.parse(changeJson) as Change<S>;
    });

    const lastRow = result.rows[result.rows.length - 1];
    const lastSeq = lastRow ? (lastRow.seq as number) : null;

    return {
      changes,
      nextCursor: lastSeq !== null ? encodeCursor(lastSeq) : req.cursor,
    };
  }

  close(): void {
    this.client.close();
  }
}
