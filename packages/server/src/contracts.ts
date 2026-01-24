import type { Change, Hlc } from '@converge/core';

export type Cursor = string;

export type PullRequest = {
  stream: string;
  cursor: Cursor | null;
  limit?: number;
};

export type PullResponse = {
  changes: Change[];
  nextCursor: Cursor | null;
};

export type AppendRequest = {
  stream: string;
  /**
   * Idempotency key for the whole batch (optional but recommended).
   * Implementation-specific semantics (e.g. unique constraint).
   */
  idempotencyKey?: string;
  changes: Change[];
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
 * Implementations live in `@converge/db-*`.
 */
export interface Db {
  append(req: AppendRequest): Promise<AppendResult>;
  pull(req: PullRequest): Promise<PullResponse>;
}

