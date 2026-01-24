import Database from 'better-sqlite3';
import type { Change, ConvergeSchema } from '@converge/core';
import type { AppendRequest, AppendResult, Cursor, Db, PullRequest, PullResponse } from '@converge/server';

type SqliteDbOptions = {
  filename: string;
  pragmas?: string[];
};

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

type SqliteDatabase = InstanceType<typeof Database>;

export class SqliteDb<S extends ConvergeSchema = ConvergeSchema> implements Db<S> {
  private db: SqliteDatabase;
  private insertChange: ReturnType<SqliteDatabase['prepare']>;
  private selectChanges: ReturnType<SqliteDatabase['prepare']>;
  private idempotencyGet: ReturnType<SqliteDatabase['prepare']>;
  private idempotencyInsert: ReturnType<SqliteDatabase['prepare']>;
  private idempotencyUpdate: ReturnType<SqliteDatabase['prepare']>;

  constructor(opts: SqliteDbOptions) {
    this.db = new Database(opts.filename);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS converge_changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        stream TEXT NOT NULL,
        change_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS converge_idempotency (
        stream TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        last_seq INTEGER NOT NULL,
        PRIMARY KEY (stream, idempotency_key)
      );
    `);

    for (const pragma of opts.pragmas ?? ['journal_mode = WAL']) {
      this.db.pragma(pragma);
    }

    this.insertChange = this.db.prepare(
      'INSERT INTO converge_changes (stream, change_json) VALUES (@stream, @change_json)',
    );
    this.selectChanges = this.db.prepare(
      'SELECT seq, change_json FROM converge_changes WHERE stream = @stream AND seq > @afterSeq ORDER BY seq ASC LIMIT @limit',
    );
    this.idempotencyGet = this.db.prepare(
      'SELECT last_seq FROM converge_idempotency WHERE stream = @stream AND idempotency_key = @idempotency_key',
    );
    this.idempotencyInsert = this.db.prepare(
      'INSERT INTO converge_idempotency (stream, idempotency_key, last_seq) VALUES (@stream, @idempotency_key, @last_seq)',
    );
    this.idempotencyUpdate = this.db.prepare(
      'UPDATE converge_idempotency SET last_seq = @last_seq WHERE stream = @stream AND idempotency_key = @idempotency_key',
    );
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

  close() {
    this.db.close();
  }
}

