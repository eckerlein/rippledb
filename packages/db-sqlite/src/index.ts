import Database from 'better-sqlite3';
import type { Change, RippleSchema } from '@rippledb/core';
import type { AppendRequest, AppendResult, Cursor, Db, PullRequest, PullResponse } from '@rippledb/server';
import { applyChangeToState } from '@rippledb/materialize-core';
import type {
  MaterializerConfigBase,
  SyncMaterializerExecutor,
} from '@rippledb/materialize-db';
import { createSyncMaterializer } from '@rippledb/materialize-db';

export type SqliteDatabase = InstanceType<typeof Database>;

export type SqliteDbOptions<S extends RippleSchema = RippleSchema> = {
  /**
   * SQLite pragmas to apply (only when using `filename`).
   * Default: ['journal_mode = WAL']
   */
  pragmas?: string[];
  materializer?: (ctx: { db: SqliteDatabase }) => MaterializerConfigBase<S> & {
    executor: SyncMaterializerExecutor;
  };
} & ({
  filename: string;
} | {
  db: SqliteDatabase;
});

type ChangeRow = {
  seq: number;
  change_json: string;
};

type IdempotencyRow = {
  last_seq: number;
};

function encodeCursor(seq: number): Cursor {
  return String(seq);
}

function decodeCursor(cursor: Cursor | null): number {
  if (!cursor) return 0;
  const n = Number(cursor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export class SqliteDb<S extends RippleSchema = RippleSchema> implements Db<S> {
  private db: SqliteDatabase;
  private ownsDb: boolean;
  private insertChange: ReturnType<SqliteDatabase['prepare']>;
  private selectChanges: ReturnType<SqliteDatabase['prepare']>;
  private idempotencyGet: ReturnType<SqliteDatabase['prepare']>;
  private idempotencyInsert: ReturnType<SqliteDatabase['prepare']>;
  private idempotencyUpdate: ReturnType<SqliteDatabase['prepare']>;
  private materializerFactory: SqliteDbOptions<S>['materializer'];

  constructor(opts: SqliteDbOptions<S>) {
    if ('db' in opts) {
      this.db = opts.db;
      this.ownsDb = false;
    } else {
      this.db = new Database(opts.filename);
      this.ownsDb = true;

      // Only apply pragmas when we create the database
      for (const pragma of opts.pragmas ?? ['journal_mode = WAL']) {
        this.db.pragma(pragma);
      }
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ripple_changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        stream TEXT NOT NULL,
        change_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ripple_idempotency (
        stream TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        last_seq INTEGER NOT NULL,
        PRIMARY KEY (stream, idempotency_key)
      );
    `);

    this.insertChange = this.db.prepare(
      'INSERT INTO ripple_changes (stream, change_json) VALUES (@stream, @change_json)',
    );
    this.selectChanges = this.db.prepare(
      'SELECT seq, change_json FROM ripple_changes WHERE stream = @stream AND seq > @afterSeq ORDER BY seq ASC LIMIT @limit',
    );
    this.idempotencyGet = this.db.prepare(
      'SELECT last_seq FROM ripple_idempotency WHERE stream = @stream AND idempotency_key = @idempotency_key',
    );
    this.idempotencyInsert = this.db.prepare(
      'INSERT INTO ripple_idempotency (stream, idempotency_key, last_seq) VALUES (@stream, @idempotency_key, @last_seq)',
    );
    this.idempotencyUpdate = this.db.prepare(
      'UPDATE ripple_idempotency SET last_seq = @last_seq WHERE stream = @stream AND idempotency_key = @idempotency_key',
    );

    this.materializerFactory = opts.materializer;
  }

  async append(req: AppendRequest<S>): Promise<AppendResult> {
    const tx = this.db.transaction((input: AppendRequest<S>) => {
      if (input.idempotencyKey) {
        const existing = this.idempotencyGet.get({
          stream: input.stream,
          idempotency_key: input.idempotencyKey,
        }) as IdempotencyRow | undefined;
        if (existing) return { accepted: 0 };
        this.idempotencyInsert.run({
          stream: input.stream,
          idempotency_key: input.idempotencyKey,
          last_seq: 0,
        });
      }

      let lastSeq = 0;
      for (const change of input.changes) {
        const info = this.insertChange.run({
          stream: input.stream,
          change_json: JSON.stringify(change),
        });
        lastSeq = Number(info.lastInsertRowid);
      }

      if (input.idempotencyKey) {
        this.idempotencyUpdate.run({
          last_seq: lastSeq,
          stream: input.stream,
          idempotency_key: input.idempotencyKey,
        });
      }

      // Materialize changes if materializer is configured
      if (this.materializerFactory) {
        const materializerConfig = this.materializerFactory({ db: this.db });
        const materializer = createSyncMaterializer(materializerConfig);
        for (const change of input.changes) {
          const current = materializer.load(change.entity, change.entityId);
          const result = applyChangeToState(current, change);

          if (result.changed) {
            if (result.deleted) {
              materializer.remove(change.entity, change.entityId, result.state);
            } else {
              materializer.save(change.entity, change.entityId, result.state);
            }
          }
        }
      }

      return { accepted: input.changes.length };
    });

    return tx(req);
  }

  async pull(req: PullRequest): Promise<PullResponse<S>> {
    const afterSeq = decodeCursor(req.cursor);
    const limit = req.limit ?? 500;
    const rows = this.selectChanges.all({
      stream: req.stream,
      afterSeq,
      limit,
    }) as ChangeRow[];

    const changes = rows.map((row) => JSON.parse(row.change_json) as Change<S>);
    const last = rows[rows.length - 1];

    return {
      changes,
      nextCursor: last ? encodeCursor(last.seq) : req.cursor,
    };
  }

  /**
   * Close the database connection.
   * Only closes if SqliteDb created the connection (via `filename`).
   * If an external `db` was provided, this is a no-op.
   */
  close() {
    if (this.ownsDb) {
      this.db.close();
    }
  }
}

