import { describe, expect, it } from 'vitest';
import { makeDelete, makeUpsert, type ChangeTags } from '@converge/core';
import { applyChangeToState } from './index';

type Schema = {
  todos: {
    title: string;
    done: boolean;
  };
};

const base = {
  stream: 'demo',
  entity: 'todos' as const,
  entityId: 'todo-1',
};

function upsert(
  hlc: `${number}:${number}:${string}`,
  patch: Schema['todos'],
  tags?: ChangeTags<Schema, 'todos'>,
) {
  return makeUpsert<Schema>({
    ...base,
    hlc,
    patch,
    tags,
  });
}

function del(hlc: `${number}:${number}:${string}`) {
  return makeDelete<Schema>({
    ...base,
    hlc,
  });
}

describe('applyChangeToState', () => {
  it('keeps newer field values when older tags arrive', () => {
    const first = applyChangeToState(null, upsert('2:0:a', { title: 'new', done: false }));
    const second = applyChangeToState(
      first.state,
      upsert('1:0:a', { title: 'old', done: false }, { title: '1:0:a' }),
    );

    expect(second.state.values.title).toBe('new');
    expect(second.changed).toBe(false);
  });

  it('applies deletes when the delete tag is newer', () => {
    const first = applyChangeToState(null, upsert('1:0:a', { title: 'keep', done: false }));
    const second = applyChangeToState(first.state, del('2:0:a'));

    expect(second.deleted).toBe(true);
    expect(second.state.deletedTag).toBe('2:0:a');
  });

  it('revives an entity when a newer field tag arrives after delete', () => {
    const first = applyChangeToState(null, upsert('1:0:a', { title: 'keep', done: false }));
    const deleted = applyChangeToState(first.state, del('2:0:a'));
    const revived = applyChangeToState(
      deleted.state,
      upsert('3:0:a', { title: 'back', done: true }, { title: '3:0:a' }),
    );

    expect(revived.state.deleted).toBe(false);
    expect(revived.state.values.title).toBe('back');
  });

  it('ignores stale deletes', () => {
    const first = applyChangeToState(null, upsert('1:0:a', { title: 'keep', done: false }));
    const deleted = applyChangeToState(first.state, del('2:0:a'));
    const staleDelete = applyChangeToState(deleted.state, del('1:0:a'));

    expect(staleDelete.changed).toBe(false);
    expect(staleDelete.state.deletedTag).toBe('2:0:a');
  });
});
