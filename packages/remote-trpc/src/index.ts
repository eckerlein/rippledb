import type { Remote } from "@rippledb/client";
import type { Change, RippleSchema } from "@rippledb/core";

type PullInput = { stream: string; cursor: string | null; limit?: number; };
type PullOutput<S extends RippleSchema> = {
  changes: Change<S>[];
  nextCursor: string | null;
};
type AppendInput<S extends RippleSchema> = {
  stream: string;
  idempotencyKey?: string;
  changes: Change<S>[];
};
type AppendOutput = { accepted: number; };

export type TrpcRemoteOptions<S extends RippleSchema = RippleSchema> = {
  /**
   * The pull procedure (e.g., `trpc.ripple.pull.mutate` or `caller.ripple.pull`)
   */
  pull: (input: PullInput) => Promise<PullOutput<S>>;
  /**
   * The append procedure (e.g., `trpc.ripple.append.mutate` or `caller.ripple.append`)
   */
  append: (input: AppendInput<S>) => Promise<AppendOutput>;
};

/**
 * Creates a Remote implementation using tRPC procedures.
 *
 * @example
 * ```ts
 * // With a tRPC client
 * import { createTrpcRemote } from '@rippledb/remote-trpc';
 * import { trpc } from './trpc';
 *
 * const remote = createTrpcRemote({
 *   pull: trpc.ripple.pull.query,    // query for read-only
 *   append: trpc.ripple.append.mutate, // mutation for writes
 * });
 * ```
 *
 * @example
 * ```ts
 * // With a direct caller (for testing)
 * const caller = appRouter.createCaller({});
 * const remote = createTrpcRemote({
 *   pull: caller.ripple.pull,
 *   append: caller.ripple.append,
 * });
 * ```
 */
export function createTrpcRemote<S extends RippleSchema = RippleSchema>(
  opts: TrpcRemoteOptions<S>,
): Remote<S> {
  return {
    pull: opts.pull,
    append: opts.append,
  };
}
