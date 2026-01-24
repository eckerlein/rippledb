import type { Change, Hlc } from '@converge/core';
import { compareHlc } from '@converge/core';
import type { DbEvent, Store } from '@converge/client';

export type MemoryListQuery = {
  entity: string;
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

export class MemoryStore implements Store<Record<string, unknown>, MemoryListQuery> {
  private entities = new Map<string, Map<string, RecordState>>();
  private subscribers = new Set<(event: DbEvent) => void>();

  onEvent(cb: (event: DbEvent) => void) {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  async applyChanges(changes: Change[]): Promise<void> {
    const events: DbEvent[] = [];

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

      if (change.kind === 'delete') {
        if (isNewer(change.hlc, rec.deletedTag)) {
          const wasDeleted = rec.deleted;
          rec.deleted = true;
          rec.deletedTag = change.hlc;
          table.set(change.entityId, rec);
          events.push({
            entity: change.entity,
            kind: wasDeleted ? 'update' : 'delete',
            id: change.entityId,
          });
        }
        continue;
      }

      let changed = false;
      for (const [field, value] of Object.entries(change.patch)) {
        const tag = change.tags[field];
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
          kind: isInsert ? 'insert' : 'update',
          id: change.entityId,
        });
      }
    }

    // Emit after "commit"
    for (const ev of events) {
      for (const sub of this.subscribers) sub(ev);
    }
  }

  async getRow(entity: string, id: string): Promise<Record<string, unknown> | null> {
    const table = this.entities.get(entity);
    const rec = table?.get(id);
    if (!rec || rec.deleted) return null;
    return { ...rec.values };
  }

  async listRows(query: MemoryListQuery): Promise<Record<string, unknown>[]> {
    const table = this.entities.get(query.entity);
    if (!table) return [];
    const out: Record<string, unknown>[] = [];
    for (const rec of table.values()) {
      if (!rec.deleted) out.push({ ...rec.values });
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

