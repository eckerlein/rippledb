"use client";

export function ArchitectureStack() {
  return (
    <div className="my-8 flex flex-col gap-0 font-mono text-sm">
      {/* Your Application */}
      <div className="rounded-t-xl border border-neutral-200 dark:border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 dark:from-violet-950 dark:to-fuchsia-950 px-6 py-4 text-center">
        <span className="font-semibold text-neutral-800 dark:text-violet-200">
          Your Application
        </span>
      </div>

      {/* Interfaces Layer */}
      <div className="border-x border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-6 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="font-semibold text-emerald-600 dark:text-emerald-400">
              @rippledb/server
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Db interface
            </div>
          </div>
          <div className="text-center">
            <div className="font-semibold text-sky-600 dark:text-sky-400">
              @rippledb/client
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Store interface
            </div>
          </div>
        </div>
      </div>

      {/* Adapters Layer */}
      <div className="border-x border-b border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800/50 px-6 py-4">
        <div className="flex flex-wrap justify-center gap-3">
          {["db-sqlite", "db-turso", "db-drizzle", "db-memory"].map(
            (adapter) => (
              <span
                key={adapter}
                className="rounded-md bg-white dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-600 shadow-sm"
              >
                {adapter}
              </span>
            ),
          )}
        </div>
        <div className="mt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
          adapters implement the interfaces
        </div>
      </div>

      {/* Core Layer */}
      <div className="rounded-b-xl border-x border-b border-neutral-200 dark:border-cyan-500/30 bg-gradient-to-r from-amber-500/10 to-orange-500/10 dark:from-cyan-950 dark:to-teal-950 px-6 py-4 text-center">
        <div className="font-semibold text-amber-700 dark:text-cyan-300">
          @rippledb/core
        </div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          HLC, Change, pure merge logic
        </div>
      </div>
    </div>
  );
}
