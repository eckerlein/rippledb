import type { Change, ConvergeSchema, Hlc } from '@converge/core';

export type Cursor = string;

export type PullRequest = {
  stream: string;
  cursor: Cursor | null;
  limit?: number;
};

export type PullResponse<S extends ConvergeSchema = ConvergeSchema> = {
  changes: Change<S>[];
  nextCursor: Cursor | null;
};

export type AppendRequest<S extends ConvergeSchema = ConvergeSchema> = {
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
 * Implementations live in `@converge/db-*`.
 */
export interface Db<S extends ConvergeSchema = ConvergeSchema> {
  append(req: AppendRequest<S>): Promise<AppendResult>;
  pull(req: PullRequest): Promise<PullResponse<S>>;
}

