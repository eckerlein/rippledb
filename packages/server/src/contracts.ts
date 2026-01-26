import type { Change, RippleSchema, Hlc } from '@rippledb/core';

export type Cursor = string;

export type PullRequest = {
  stream: string;
  cursor: Cursor | null;
  limit?: number;
};

export type PullResponse<S extends RippleSchema = RippleSchema> = {
  changes: Change<S>[];
  nextCursor: Cursor | null;
};

export type AppendRequest<S extends RippleSchema = RippleSchema> = {
  stream: string;
  /**
   * Idempotency key for the whole batch (optional but recommended).
   * Implementation-specific semantics (e.g. unique constraint).
   */
  idempotencyKey?: string;
  changes: Change<S>[];
};

export type AppendResult = {
  accepted: number;
  /**
   * Server may assign/normalize a high-watermark tag for bookkeeping.
   */
  hlc?: Hlc;
};

/**
 * Server-side persistence contract (authoritative ordering + cursorable history).
 * Implementations live in `@rippledb/db-*`.
 */
export interface Db<S extends RippleSchema = RippleSchema> {
  append(req: AppendRequest<S>): Promise<AppendResult>;
  pull(req: PullRequest): Promise<PullResponse<S>>;
}

