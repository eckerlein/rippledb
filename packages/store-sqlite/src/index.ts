import Database from 'better-sqlite3';
import type { Change, EntityName, Hlc, SchemaDescriptor, InferSchema } from '@rippledb/core';
import { compareHlc } from '@rippledb/core';
import type { DbEvent, Store } from '@rippledb/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SqliteStoreOptions<D extends SchemaDescriptor<any> = SchemaDescriptor<any>> = {
  /**
   * SQLite database file path or ':memory:' for in-memory database.
   */
  filename?: string;
  /**
   * Existing better-sqlite3 Database instance.
   * If provided, `filename` is ignored.
   */
  db?: Database.Database;
  /**
   * SQLite pragmas to apply (only when using `filename`).
   * Default: ['journal_mode = WAL']
   */
  pragmas?: string[];
  /**
   * Name of the tags table. Default: 'ripple_tags'
   */
  tagsTable?: string;
  /**
   * Schema descriptor for creating domain tables with proper columns.
   * Required to enable SQL WHERE clauses and proper column-based queries.
   * Use the same schema descriptor as your backend for consistency.
   * The RippleSchema type is inferred from this descriptor.
   */
  schema: D;
  /**
   * Optional field mapping from schema field names to database column names.
   * If omitted, field names are used as column names.
   */
  fieldMap?: Partial<Record<EntityName<InferSchema<D>>, Record<string, string>>>;
};

type TagsRow = {
  data: string; // JSON string of entity values
  tags: string; // JSON string of field tags
  deleted: number; // 0 or 1 (SQLite boolean)
  deletedTag: string | null; // Hlc as string
};

function isNewer(incoming: Hlc, existing: Hlc | undefined | null): boolean {
  if (!existing) return true;
  return compareHlc(incoming, existing) > 0;
}

function parseHlc(hlc: string | null): Hlc | null {
  if (!hlc) return null;
  return JSON.parse(hlc) as Hlc;
}

function stringifyHlc(hlc: Hlc | null): string | null {
  if (!hlc) return null;
  return JSON.stringify(hlc);
}

function fieldTypeToSqlite(field: { _type: string; _optional?: boolean }): string {
  switch (field._type) {
    case 'string':
    case 'enum':
      return 'TEXT';
    case 'number':
      return 'INTEGER';
    case 'boolean':
      return 'INTEGER'; // SQLite uses INTEGER for booleans (0/1)
    default:
      return 'TEXT'; // Default to TEXT for unknown types
  }
}

function convertValueForSqlite(value: unknown, fieldType: string): unknown {
  if (fieldType === 'boolean') {
    return value === true ? 1 : 0;
  }
  return value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class SqliteStore<D extends SchemaDescriptor<any> = SchemaDescriptor<any>> implements Store<InferSchema<D>, string> {
  private db: Database.Database;
  private ownsDb: boolean;
  private subscribers = new Set<(event: DbEvent<InferSchema<D>>) => void>();
  private tagsTable: string;
  private loadTags: Database.Statement<[string, string], TagsRow>;
  private saveTags: Database.Statement<[string, string, string, string], Database.RunResult>;
  private removeTags: Database.Statement<[string, string, string, string, string | null], Database.RunResult>;
  private entityTableCache = new Set<string>();
  private schema: D;
  private fieldMap?: Partial<Record<EntityName<InferSchema<D>>, Record<string, string>>>;

  constructor(opts: SqliteStoreOptions<D>) {
    if (opts.db) {
      this.db = opts.db;
      this.ownsDb = false;
    } else {
      this.db = new Database(opts.filename ?? ':memory:');
      this.ownsDb = true;

      // Apply pragmas when we create the database
      for (const pragma of opts.pragmas ?? ['journal_mode = WAL']) {
        this.db.pragma(pragma);
      }
    }

    this.tagsTable = opts.tagsTable ?? 'ripple_tags';
    this.schema = opts.schema;
    this.fieldMap = opts.fieldMap;

    // Create tags table (like materializer)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.escapeIdentifier(this.tagsTable)} (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        tags TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        deleted_tag TEXT,
        PRIMARY KEY (entity, id)
      )
    `);

    // Prepare statements for tags table operations
    this.loadTags = this.db.prepare(
      `SELECT data, tags, deleted, deleted_tag FROM ${this.escapeIdentifier(this.tagsTable)} WHERE entity = ? AND id = ?`,
    );
    this.saveTags = this.db.prepare(
      `INSERT INTO ${this.escapeIdentifier(this.tagsTable)} (entity, id, data, tags, deleted, deleted_tag)
       VALUES (?, ?, ?, ?, 0, NULL)
       ON CONFLICT(entity, id) DO UPDATE SET
         data = excluded.data,
         tags = excluded.tags,
         deleted = 0,
         deleted_tag = NULL`,
    );
    this.removeTags = this.db.prepare(
      `INSERT INTO ${this.escapeIdentifier(this.tagsTable)} (entity, id, data, tags, deleted, deleted_tag)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(entity, id) DO UPDATE SET
         data = excluded.data,
         tags = excluded.tags,
         deleted = 1,
         deleted_tag = excluded.deleted_tag`,
    );
  }

  onEvent(cb: (event: DbEvent<InferSchema<D>>) => void) {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private getColumnName(entity: string, field: string): string {
    const map = this.fieldMap?.[entity as EntityName<InferSchema<D>>];
    return map?.[field] ?? field;
  }

  private ensureEntityTable(entity: string): void {
    if (this.entityTableCache.has(entity)) return;

    const entityTableName = this.escapeIdentifier(entity);

    // Create domain table with proper columns based on schema
    const fields = this.schema.getFields(entity);
    if (fields.length === 0) {
      throw new Error(`Entity "${entity}" has no fields in schema`);
    }

    // Build column definitions
    // Always add 'id' as primary key (even if schema has it, we use it as PK)
    const columns: string[] = ['id TEXT PRIMARY KEY'];
    for (const field of fields) {
      // Skip 'id' field from schema since we already added it as PK
      if (field === 'id') continue;
      const fieldDesc = this.schema.getFieldDescriptor(entity, field);
      if (!fieldDesc || !('_type' in fieldDesc)) continue;
      const columnName = this.escapeIdentifier(this.getColumnName(entity, field));
      const sqlType = fieldTypeToSqlite(fieldDesc);
      const nullable = fieldDesc._optional ? '' : ' NOT NULL';
      columns.push(`${columnName} ${sqlType}${nullable}`);
    }
    columns.push('deleted INTEGER NOT NULL DEFAULT 0');

    this.db.exec(`CREATE TABLE IF NOT EXISTS ${entityTableName} (${columns.join(', ')})`);

    this.entityTableCache.add(entity);
  }

  private escapeIdentifier(identifier: string): string {
    // Simple escaping - wrap in double quotes
    // In production, you might want more robust escaping
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  async applyChanges(changes: Change<InferSchema<D>>[]): Promise<void> {
    const events: DbEvent<InferSchema<D>>[] = [];

    const tx = this.db.transaction((changes: Change<InferSchema<D>>[]) => {
      for (const change of changes) {
        this.ensureEntityTable(change.entity);
        const entityTableName = this.escapeIdentifier(change.entity);

        // Load existing tags/metadata
        const existingTags = this.loadTags.get(change.entity, change.entityId) as TagsRow | undefined;

        let dataJson: string;
        let tagsJson: string;
        let deleted: number;
        let deletedTag: string | null;

        if (existingTags) {
          dataJson = existingTags.data;
          tagsJson = existingTags.tags;
          deleted = existingTags.deleted;
          deletedTag = existingTags.deletedTag;
        } else {
          dataJson = '{}';
          tagsJson = '{}';
          deleted = 0;
          deletedTag = null;
        }

        const values = JSON.parse(dataJson) as Record<string, unknown>;
        const tags = JSON.parse(tagsJson) as Record<string, Hlc>;
        const parsedDeletedTag = parseHlc(deletedTag);

        if (change.kind === 'delete') {
          if (isNewer(change.hlc, parsedDeletedTag)) {
            const wasDeleted = deleted === 1;
            deleted = 1;
            deletedTag = stringifyHlc(change.hlc);
            // Update tags table
            this.removeTags.run(change.entity, change.entityId, dataJson, tagsJson, deletedTag);
            // Update domain table
            const updateDomainStmt = this.db.prepare(
              `UPDATE ${entityTableName} SET deleted = ? WHERE id = ?`,
            );
            updateDomainStmt.run(deleted, change.entityId);
            events.push({
              entity: change.entity,
              kind: wasDeleted ? 'update' : 'delete',
              id: change.entityId,
            });
          }
          continue;
        }

        // Handle upsert
        let changed = false;
        const changeTags = (change.tags as Record<string, Hlc | undefined>) || {};
        const patch = (change.patch as Record<string, unknown>) || {};

        for (const [field, value] of Object.entries(patch)) {
          const tag = changeTags[field];
          if (!tag) continue;
          const existingTag = tags[field];
          if (isNewer(tag, existingTag)) {
            values[field] = value;
            tags[field] = tag;
            changed = true;
          }
        }

        // If record was deleted and we're upserting, restore it
        const wasDeleted = deleted === 1;
        if (wasDeleted) {
          deleted = 0;
          deletedTag = null;
          changed = true;
        }

        if (changed || !existingTags) {
          dataJson = JSON.stringify(values);
          tagsJson = JSON.stringify(tags);

          // Update tags table
          this.saveTags.run(change.entity, change.entityId, dataJson, tagsJson);

          // Update domain table - write to proper columns
          const fields = this.schema.getFields(change.entity);
          const columns: string[] = [];
          const columnValues: unknown[] = [];
          const updates: string[] = [];

          for (const field of fields) {
            const columnName = this.getColumnName(change.entity, field);
            const value = values[field];
            const fieldDesc = this.schema.getFieldDescriptor(change.entity, field);
            const sqlType = (fieldDesc && '_type' in fieldDesc) ? fieldDesc._type : 'string';
            const convertedValue = convertValueForSqlite(value, sqlType);

            columns.push(this.escapeIdentifier(columnName));
            columnValues.push(convertedValue);
            updates.push(`${this.escapeIdentifier(columnName)} = ?`);
          }

          const upsertDomainStmt = this.db.prepare(
            `INSERT INTO ${entityTableName} (id, ${columns.join(', ')}, deleted)
             VALUES (?, ${columns.map(() => '?').join(', ')}, ?)
             ON CONFLICT(id) DO UPDATE SET
               ${updates.join(', ')}, deleted = ?`,
          );
          upsertDomainStmt.run(change.entityId, ...columnValues, deleted, ...columnValues, deleted);

          const isInsert = !existingTags;
          events.push({
            entity: change.entity,
            kind: isInsert ? 'insert' : wasDeleted ? 'insert' : 'update',
            id: change.entityId,
          });
        }
      }
    });

    tx(changes);

    // Emit after "commit"
    for (const ev of events) {
      for (const sub of this.subscribers) sub(ev);
    }
  }

  async getRow<E extends EntityName<InferSchema<D>>>(entity: E, id: string): Promise<InferSchema<D>[E] | null> {
    this.ensureEntityTable(entity);
    const entityTableName = this.escapeIdentifier(entity);

    // Read from proper columns
    const fields = this.schema.getFields(entity);
    const columns = fields.map((f) => this.escapeIdentifier(this.getColumnName(entity, f)));
    const stmt = this.db.prepare(
      `SELECT ${columns.join(', ')}, deleted FROM ${entityTableName} WHERE id = ?`,
    );
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row || (row.deleted as number) === 1) return null;

      const result = {} as InferSchema<D>[E];
      for (const field of fields) {
        const columnName = this.getColumnName(entity, field);
        let value = row[columnName];
        const fieldDesc = this.schema.getFieldDescriptor(entity, field);
        // Convert boolean back from integer
        if (fieldDesc && '_type' in fieldDesc && fieldDesc._type === 'boolean') {
          value = value === 1;
        }
        result[field as keyof InferSchema<D>[E]] = value as InferSchema<D>[E][keyof InferSchema<D>[E]];
      }
      return result;
  }

  async getRows<E extends EntityName<InferSchema<D>>>(entity: E, ids: string[]): Promise<Map<string, InferSchema<D>[E]>> {
    const result = new Map<string, InferSchema<D>[E]>();
    if (ids.length === 0) return result;

    this.ensureEntityTable(entity);
    const entityTableName = this.escapeIdentifier(entity);

    // Read from proper columns
    const fields = this.schema.getFields(entity);
    const columns = fields.map((f) => this.escapeIdentifier(this.getColumnName(entity, f)));
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `SELECT id, ${columns.join(', ')}, deleted FROM ${entityTableName} WHERE id IN (${placeholders}) AND deleted = 0`,
    );
    const rows = stmt.all(...ids) as Array<Record<string, unknown>>;

      for (const row of rows) {
        const id = row.id as string;
        const resultRow = {} as InferSchema<D>[E];
        for (const field of fields) {
          const columnName = this.getColumnName(entity, field);
          let value = row[columnName];
          const fieldDesc = this.schema.getFieldDescriptor(entity, field);
          // Convert boolean back from integer
          if (fieldDesc && '_type' in fieldDesc && fieldDesc._type === 'boolean') {
            value = value === 1;
          }
          resultRow[field as keyof InferSchema<D>[E]] = value as InferSchema<D>[E][keyof InferSchema<D>[E]];
        }
        result.set(id, resultRow);
      }

    return result;
  }

  /**
   * Execute a SQL query and return matching rows.
   *
   * Queries can use actual column names from the schema:
   * ```ts
   * await store.listRows('SELECT * FROM todos WHERE done = 0');
   * ```
   *
   * @param query - SQL query string. **Warning:** If queries come from untrusted sources,
   *                validate/whitelist them to prevent SQL injection.
   * @returns Array of entity objects matching the query
   */
  async listRows(query: string): Promise<Array<InferSchema<D>[EntityName<InferSchema<D>>]>> {
    const rows = this.db.prepare(query).all() as Array<Record<string, unknown>>;

    const result: Array<InferSchema<D>[EntityName<InferSchema<D>>]> = [];
    for (const row of rows) {
      // If query includes deleted column, filter it out
      if (row.deleted !== undefined && (row.deleted as number) === 1) continue;

      // Return row as-is (columns match schema fields)
      result.push(row as InferSchema<D>[EntityName<InferSchema<D>>]);
    }

    return result;
  }

  /**
   * Close the database connection.
   * Only closes if SqliteStore created the connection (via `filename`).
   * If an external `db` was provided, this is a no-op.
   */
  close() {
    if (this.ownsDb) {
      this.db.close();
    }
  }
}
