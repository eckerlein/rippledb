import type { Change, ChangeTags, RippleSchema, EntityName, Hlc } from '@rippledb/core';
import { compareHlc } from '@rippledb/core';

type FieldKey<T extends Record<string, unknown>> = Extract<keyof T, string>;

export type MaterializerState<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
> = {
  values: Partial<S[E]>;
  tags: ChangeTags<S, E>;
  deleted: boolean;
  deletedTag: Hlc | null;
};

export type MaterializerAdapter<S extends RippleSchema = RippleSchema> = {
  load<E extends EntityName<S>>(entity: E, id: string): Promise<MaterializerState<S, E> | null>;
  save<E extends EntityName<S>>(entity: E, id: string, state: MaterializerState<S, E>): Promise<void>;
  remove<E extends EntityName<S>>(entity: E, id: string, state: MaterializerState<S, E>): Promise<void>;
};

type ApplyResult<S extends RippleSchema, E extends EntityName<S>> = {
  state: MaterializerState<S, E>;
  changed: boolean;
  deleted: boolean;
};

function isNewer(incoming: Hlc, existing: Hlc | undefined | null) {
  if (!existing) return true;
  return compareHlc(incoming, existing) > 0;
}

function newestTag<S extends RippleSchema, E extends EntityName<S>>(tags: ChangeTags<S, E>): Hlc | null {
  let latest: Hlc | null = null;
  for (const tag of Object.values(tags)) {
    if (!tag) continue;
    if (!latest || compareHlc(tag, latest) > 0) latest = tag;
  }
  return latest;
}

/**
 * Apply one change to a materialized entity snapshot using per-field LWW tags.
 * This is needed for incremental materialization so we can apply changes safely
 * without reloading or recomputing full entity state each time.
 *
 * Returns the next state plus whether anything actually changed.
 *
 * Example:
 * const { state: next } = applyChangeToState(state, change)
 */
export function applyChangeToState<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
>(current: MaterializerState<S, E> | null, change: Change<S, E>): ApplyResult<S, E> {
  const state: MaterializerState<S, E> =
    current ?? ({
      values: {},
      tags: {},
      deleted: false,
      deletedTag: null,
    } satisfies MaterializerState<S, E>);

  if (change.kind === 'delete') {
    if (isNewer(change.hlc, state.deletedTag)) {
      state.deleted = true;
      state.deletedTag = change.hlc;
      return { state, changed: true, deleted: true };
    }
    return { state, changed: false, deleted: state.deleted };
  }

  let changed = false;
  for (const [field, value] of Object.entries(change.patch as Record<string, unknown>)) {
    const tag = (change.tags as Record<string, Hlc | undefined>)[field];
    if (!tag) continue;
    if (isNewer(tag, (state.tags as Record<string, Hlc | undefined>)[field])) {
      (state.values as Record<string, unknown>)[field as FieldKey<S[E]>] = value;
      (state.tags as Record<string, Hlc | undefined>)[field as FieldKey<S[E]>] = tag;
      changed = true;
    }
  }

  if (state.deleted) {
    const latestTag = newestTag(change.tags);
    if (latestTag && isNewer(latestTag, state.deletedTag)) {
      state.deleted = false;
      state.deletedTag = null;
      changed = true;
    }
  }

  return { state, changed, deleted: state.deleted };
}

export async function materializeChange<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
>(
  adapter: MaterializerAdapter<S>,
  change: Change<S, E>,
): Promise<'noop' | 'saved' | 'removed'> {
  const current = await adapter.load(change.entity, change.entityId);
  const result = applyChangeToState(current, change);

  if (!result.changed) return 'noop';
  if (result.deleted) {
    await adapter.remove(change.entity, change.entityId, result.state);
    return 'removed';
  }

  await adapter.save(change.entity, change.entityId, result.state);
  return 'saved';
}

export async function materializeChanges<
  S extends RippleSchema = RippleSchema,
>(adapter: MaterializerAdapter<S>, changes: Change<S>[]): Promise<void> {
  for (const change of changes) {
    await materializeChange(adapter, change);
  }
}

