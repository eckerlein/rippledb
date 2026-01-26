import { describe, expect, it } from 'vitest';
import { makeUpsert, makeDelete, createHlcState, tickHlc } from '@rippledb/core';
import type { Change } from '@rippledb/core';
import type { PullRequest, AppendRequest, AppendResult, PullResponse } from '@rippledb/server';
import {
  hlcSchema,
  changeSchema,
  pullRequestSchema,
  appendRequestSchema,
  appendResultSchema,
  pullResponseSchema,
  createChangeSchema,
} from './index';
import { z } from 'zod';

type TestSchema = {
  todo: { id: string; title: string; done: boolean };
};

function makeHlc(nodeId: string, nowMs: number) {
  const state = createHlcState(nodeId);
  return tickHlc(state, nowMs);
}

describe('@rippledb/zod', () => {
  describe('hlcSchema', () => {
    it('validates correct HLC format', () => {
      const hlc = makeHlc('node1', 1000);
      expect(hlcSchema.safeParse(hlc).success).toBe(true);
    });

    it('rejects invalid HLC format', () => {
      expect(hlcSchema.safeParse('invalid').success).toBe(false);
      expect(hlcSchema.safeParse('123').success).toBe(false);
      expect(hlcSchema.safeParse(123).success).toBe(false);
    });
  });

  describe('changeSchema', () => {
    it('validates upsert changes from @rippledb/core', () => {
      const change: Change<TestSchema> = makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todo',
        entityId: '1',
        patch: { id: '1', title: 'Hello', done: false },
        hlc: makeHlc('node1', 1000),
      });

      const result = changeSchema.safeParse(change);
      expect(result.success).toBe(true);
    });

    it('validates delete changes from @rippledb/core', () => {
      const change: Change<TestSchema> = makeDelete<TestSchema>({
        stream: 'test',
        entity: 'todo',
        entityId: '1',
        hlc: makeHlc('node1', 1000),
      });

      const result = changeSchema.safeParse(change);
      expect(result.success).toBe(true);
    });
  });

  describe('createChangeSchema', () => {
    it('validates typed changes with custom schema', () => {
      const todoSchema = z.object({
        id: z.string(),
        title: z.string(),
        done: z.boolean(),
      });
      const todoChangeSchema = createChangeSchema(todoSchema);

      const change: Change<TestSchema> = makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todo',
        entityId: '1',
        patch: { title: 'Hello' },
        hlc: makeHlc('node1', 1000),
      });

      const result = todoChangeSchema.safeParse(change);
      expect(result.success).toBe(true);
    });
  });

  describe('pullRequestSchema', () => {
    it('validates PullRequest from @rippledb/server', () => {
      const req: PullRequest = {
        stream: 'test',
        cursor: null,
        limit: 100,
      };

      const result = pullRequestSchema.safeParse(req);
      expect(result.success).toBe(true);
    });

    it('validates PullRequest with cursor', () => {
      const req: PullRequest = {
        stream: 'test',
        cursor: 'abc123',
      };

      const result = pullRequestSchema.safeParse(req);
      expect(result.success).toBe(true);
    });
  });

  describe('pullResponseSchema', () => {
    it('validates PullResponse from @rippledb/server', () => {
      const change: Change<TestSchema> = makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todo',
        entityId: '1',
        patch: { id: '1', title: 'Hello', done: false },
        hlc: makeHlc('node1', 1000),
      });

      const res: PullResponse<TestSchema> = {
        changes: [change],
        nextCursor: 'cursor123',
      };

      const result = pullResponseSchema.safeParse(res);
      expect(result.success).toBe(true);
    });
  });

  describe('appendRequestSchema', () => {
    it('validates AppendRequest from @rippledb/server', () => {
      const change: Change<TestSchema> = makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todo',
        entityId: '1',
        patch: { id: '1', title: 'Hello', done: false },
        hlc: makeHlc('node1', 1000),
      });

      const req: AppendRequest<TestSchema> = {
        stream: 'test',
        changes: [change],
        idempotencyKey: 'key123',
      };

      const result = appendRequestSchema.safeParse(req);
      expect(result.success).toBe(true);
    });
  });

  describe('appendResultSchema', () => {
    it('validates AppendResult from @rippledb/server', () => {
      const res: AppendResult = {
        accepted: 5,
        hlc: makeHlc('server', 2000),
      };

      const result = appendResultSchema.safeParse(res);
      expect(result.success).toBe(true);
    });

    it('validates AppendResult without hlc', () => {
      const res: AppendResult = {
        accepted: 0,
      };

      const result = appendResultSchema.safeParse(res);
      expect(result.success).toBe(true);
    });
  });
});
