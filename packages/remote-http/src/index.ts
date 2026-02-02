import type { Remote } from "@rippledb/client";
import type { RippleSchema } from "@rippledb/core";

export type HttpRemoteOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

export function createHttpRemote<S extends RippleSchema = RippleSchema>(
  opts: HttpRemoteOptions,
): Remote<S> {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const fetchImpl = opts.fetch ?? fetch;
  const defaultHeaders = {
    "content-type": "application/json",
    ...opts.headers,
  };

  type PullRequest = Parameters<Remote<S>["pull"]>[0];
  type PullResponse = Awaited<ReturnType<Remote<S>["pull"]>>;
  type AppendRequest = Parameters<Remote<S>["append"]>[0];
  type AppendResponse = Awaited<ReturnType<Remote<S>["append"]>>;

  return {
    async pull(req: PullRequest): Promise<PullResponse> {
      const res = await fetchImpl(`${baseUrl}/pull`, {
        method: "POST",
        headers: defaultHeaders,
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        throw new Error(`remote.pull failed: ${res.status}`);
      }
      return (await res.json()) as PullResponse;
    },
    async append(req: AppendRequest): Promise<AppendResponse> {
      const res = await fetchImpl(`${baseUrl}/append`, {
        method: "POST",
        headers: defaultHeaders,
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        throw new Error(`remote.append failed: ${res.status}`);
      }
      return (await res.json()) as AppendResponse;
    },
  };
}
