import type { Dialect } from "./types";

/**
 * Built-in database dialects.
 */
export const dialects: Record<string, Dialect> = {
  sqlite: {
    createTagsTable: tagsTable =>
      `CREATE TABLE IF NOT EXISTS ${tagsTable} (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        tags TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        deleted_tag TEXT,
        PRIMARY KEY (entity, id)
      )`,
    loadCommand: tagsTable =>
      `SELECT data, tags, deleted, deleted_tag FROM ${tagsTable} WHERE entity = ? AND id = ?`,
    saveCommand: tagsTable =>
      `INSERT INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag)
       VALUES (?, ?, ?, ?, 0, NULL)
       ON CONFLICT(entity, id) DO UPDATE SET
         data = excluded.data,
         tags = excluded.tags,
         deleted = 0,
         deleted_tag = NULL`,
    removeCommand: tagsTable =>
      `INSERT INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(entity, id) DO UPDATE SET
         data = excluded.data,
         tags = excluded.tags,
         deleted = 1,
         deleted_tag = excluded.deleted_tag`,
    saveEntityCommand: (tableName, id, columns, values, updates) => {
      // Convert booleans to integers for SQLite
      const convertValue = (v: unknown): unknown => {
        if (typeof v === "boolean") return v ? 1 : 0;
        return v;
      };
      const convertedValues = values.map(convertValue);
      return {
        sql: `INSERT INTO ${tableName} (id, ${columns.join(", ")})
              VALUES (?, ${columns.map(() => "?").join(", ")})
              ON CONFLICT(id) DO UPDATE SET
                ${updates.join(", ")}`,
        params: [id, ...convertedValues, ...convertedValues],
      };
    },
  },
  postgresql: {
    createTagsTable: tagsTable =>
      `CREATE TABLE IF NOT EXISTS ${tagsTable} (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        tags TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        deleted_tag TEXT,
        PRIMARY KEY (entity, id)
      )`,
    loadCommand: tagsTable =>
      `SELECT data, tags, deleted, deleted_tag FROM ${tagsTable} WHERE entity = $1 AND id = $2`,
    saveCommand: tagsTable =>
      `INSERT INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag)
       VALUES ($1, $2, $3, $4, 0, NULL)
       ON CONFLICT (entity, id) DO UPDATE SET
         data = EXCLUDED.data,
         tags = EXCLUDED.tags,
         deleted = 0,
         deleted_tag = NULL`,
    removeCommand: tagsTable =>
      `INSERT INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag)
       VALUES ($1, $2, $3, $4, 1, $5)
       ON CONFLICT (entity, id) DO UPDATE SET
         data = EXCLUDED.data,
         tags = EXCLUDED.tags,
         deleted = 1,
         deleted_tag = EXCLUDED.deleted_tag`,
    saveEntityCommand: (tableName, id, columns, values, updates) => {
      // Convert booleans to integers for PostgreSQL
      const convertValue = (v: unknown): unknown => {
        if (typeof v === "boolean") return v ? 1 : 0;
        return v;
      };
      const convertedValues = values.map(convertValue);
      const insertPlaceholders = columns.map((_, i) => `$${i + 2}`).join(", ");
      const updateClauses = updates.map((u, i) =>
        u.replace("?", `$${i + 2 + columns.length}`)
      );
      return {
        sql: `INSERT INTO ${tableName} (id, ${columns.join(", ")})
              VALUES ($1, ${insertPlaceholders})
              ON CONFLICT (id) DO UPDATE SET
                ${updateClauses.join(", ")}`,
        params: [id, ...convertedValues, ...convertedValues],
      };
    },
  },
};
