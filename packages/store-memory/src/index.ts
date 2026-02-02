import type { DbEvent, Store } from "@rippledb/client";
import type { Change, EntityName, Hlc, RippleSchema } from "@rippledb/core";
import { compareHlc } from "@rippledb/core";

export type MemoryListQuery<E extends string = string> = {
  entity: E;
};

type RecordState = {
  values: Record<string, unknown>;
  tags: Record<string, Hlc>;
  deleted: boolean;
  deletedTag: Hlc | null;
};

function isNewer(incoming: Hlc, existing: Hlc | undefined | null) {
  if (!existing) return true;
  return compareHlc(incoming, existing) > 0;
}

export class MemoryStore<
  S extends RippleSchema = RippleSchema,
> implements Store<S, MemoryListQuery<EntityName<S>>> {
  private entities = new Map<string, Map<string, RecordState>>();
  private subscribers = new Set<(event: DbEvent<S>) => void>();

  onEvent(cb: (event: DbEvent<S>) => void) {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  async applyChanges(changes: Change<S>[]): Promise<void> {
    const events: DbEvent<S>[] = [];

    for (const change of changes) {
      const table = this.getTable(change.entity);
      const existing = table.get(change.entityId);
      const rec: RecordState =
        existing ??
        ({
          values: {},
          tags: {},
          deleted: false,
          deletedTag: null,
        } satisfies RecordState);

      if (change.kind === "delete") {
        if (isNewer(change.hlc, rec.deletedTag)) {
          const wasDeleted = rec.deleted;
          rec.deleted = true;
          rec.deletedTag = change.hlc;
          table.set(change.entityId, rec);
          events.push({
            entity: change.entity,
            kind: wasDeleted ? "update" : "delete",
            id: change.entityId,
          });
        }
        continue;
      }

      let changed = false;
      for (const [field, value] of Object.entries(
        change.patch as Record<string, unknown>,
      )) {
        const tag = (change.tags as Record<string, Hlc | undefined>)[field];
        if (!tag) continue;
        if (isNewer(tag, rec.tags[field])) {
          rec.values[field] = value;
          rec.tags[field] = tag;
          changed = true;
        }
      }

      if (changed) {
        const isInsert = !existing;
        table.set(change.entityId, rec);
        events.push({
          entity: change.entity,
          kind: isInsert ? "insert" : "update",
          id: change.entityId,
        });
      }
    }

    // Emit after "commit"
    for (const ev of events) {
      for (const sub of this.subscribers) sub(ev);
    }
  }

  async getRow<E extends EntityName<S>>(
    entity: E,
    id: string,
  ): Promise<S[E] | null> {
    const table = this.entities.get(entity);
    const rec = table?.get(id);
    if (!rec || rec.deleted) return null;
    return { ...rec.values } as S[E];
  }

  async getRows<E extends EntityName<S>>(
    entity: E,
    ids: string[],
  ): Promise<Map<string, S[E]>> {
    const result = new Map<string, S[E]>();
    if (ids.length === 0) return result;

    const table = this.entities.get(entity);
    if (!table) return result;

    for (const id of ids) {
      const rec = table.get(id);
      if (!rec || rec.deleted) continue;
      result.set(id, { ...rec.values } as S[E]);
    }

    return result;
  }

  async listRows(
    query: MemoryListQuery<EntityName<S>>,
  ): Promise<Array<S[EntityName<S>]>> {
    const table = this.entities.get(query.entity);
    if (!table) return [];
    const out: Array<S[EntityName<S>]> = [];
    for (const rec of table.values()) {
      if (!rec.deleted) out.push({ ...rec.values } as S[EntityName<S>]);
    }
    return out;
  }

  private getTable(entity: string) {
    let table = this.entities.get(entity);
    if (!table) {
      table = new Map();
      this.entities.set(entity, table);
    }
    return table;
  }
}
