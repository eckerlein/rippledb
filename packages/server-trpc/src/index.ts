import { initTRPC } from '@trpc/server';
import type { Db, PullRequest, AppendRequest } from '@rippledb/server';
import type { RippleSchema } from '@rippledb/core';

export type RippleTrpcRouterOptions<S extends RippleSchema = RippleSchema> = {
  db: Db<S>;
};

/**
 * Creates a tRPC router with `pull` and `append` procedures for RippleDB sync.
 *
 * @example
 * ```ts
 * import { createRippleTrpcRouter } from '@rippledb/server-trpc';
 * import { initTRPC } from '@trpc/server';
 *
 * const t = initTRPC.create();
 * const rippleRouter = createRippleTrpcRouter({ db });
 *
 * export const appRouter = t.router({
 *   ripple: rippleRouter,
 * });
 * ```
 */
export function createRippleTrpcRouter<S extends RippleSchema = RippleSchema>(
  opts: RippleTrpcRouterOptions<S>,
) {
  const t = initTRPC.create();

  return t.router({
    pull: t.procedure
      .input((input: unknown) => input as PullRequest)
      .query(async ({ input }) => {
        return opts.db.pull(input);
      }),

    append: t.procedure
      .input((input: unknown) => input as AppendRequest<S>)
      .mutation(async ({ input }) => {
        return opts.db.append(input);
      }),
  });
}

export type RippleTrpcRouter<S extends RippleSchema = RippleSchema> = ReturnType<
  typeof createRippleTrpcRouter<S>
>;
