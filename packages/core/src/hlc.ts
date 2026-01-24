export type Hlc = `${number}:${number}:${string}`;

export type ParsedHlc = {
  wallMs: number;
  counter: number;
  nodeId: string;
};

export function parseHlc(hlc: Hlc): ParsedHlc {
  const [wallMsStr, counterStr, nodeId, ...rest] = hlc.split(':');
  if (!wallMsStr || !counterStr || !nodeId || rest.length > 0) {
    throw new Error(`Invalid HLC: ${hlc}`);
  }
  const wallMs = Number(wallMsStr);
  const counter = Number(counterStr);
  if (!Number.isFinite(wallMs) || !Number.isFinite(counter)) {
    throw new Error(`Invalid HLC: ${hlc}`);
  }
  return { wallMs, counter, nodeId };
}

export function formatHlc(p: ParsedHlc): Hlc {
  return `${p.wallMs}:${p.counter}:${p.nodeId}`;
}

export function compareHlc(a: Hlc, b: Hlc): number {
  const pa = parseHlc(a);
  const pb = parseHlc(b);
  if (pa.wallMs !== pb.wallMs) return pa.wallMs < pb.wallMs ? -1 : 1;
  if (pa.counter !== pb.counter) return pa.counter < pb.counter ? -1 : 1;
  if (pa.nodeId === pb.nodeId) return 0;
  return pa.nodeId < pb.nodeId ? -1 : 1;
}

export type HlcState = {
  lastWallMs: number;
  counter: number;
  nodeId: string;
};

export function createHlcState(nodeId: string): HlcState {
  return { lastWallMs: 0, counter: 0, nodeId };
}

export function tickHlc(state: HlcState, nowMs: number): Hlc {
  if (nowMs > state.lastWallMs) {
    state.lastWallMs = nowMs;
    state.counter = 0;
  } else {
    state.counter += 1;
  }
  return formatHlc({ wallMs: state.lastWallMs, counter: state.counter, nodeId: state.nodeId });
}

export function observeHlc(state: HlcState, remote: Hlc, nowMs: number): Hlc {
  const r = parseHlc(remote);
  const wall = Math.max(nowMs, state.lastWallMs, r.wallMs);
  let counter = 0;
  if (wall === state.lastWallMs && wall === r.wallMs) {
    counter = Math.max(state.counter, r.counter) + 1;
  } else if (wall === state.lastWallMs) {
    counter = state.counter + 1;
  } else if (wall === r.wallMs) {
    counter = r.counter + 1;
  }
  state.lastWallMs = wall;
  state.counter = counter;
  return formatHlc({ wallMs: wall, counter, nodeId: state.nodeId });
}

