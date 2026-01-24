export type Hlc = `${number}:${number}:${string}`;

export type ParsedHlc = {
  wallMillis: number;
  counter: number;
  nodeId: string;
};

export function parseHlc(hlc: Hlc): ParsedHlc {
  const [wallMillisStr, counterStr, nodeId, ...rest] = hlc.split(':');
  if (!wallMillisStr || !counterStr || !nodeId || rest.length > 0) {
    throw new Error(`Invalid HLC: ${hlc}`);
  }
  const wallMillis = Number(wallMillisStr);
  const counter = Number(counterStr);
  if (!Number.isFinite(wallMillis) || !Number.isFinite(counter)) {
    throw new Error(`Invalid HLC: ${hlc}`);
  }
  return { wallMillis, counter, nodeId };
}

export function formatHlc(p: ParsedHlc): Hlc {
  return `${p.wallMillis}:${p.counter}:${p.nodeId}`;
}

export function compareHlc(a: Hlc, b: Hlc): number {
  const pa = parseHlc(a);
  const pb = parseHlc(b);
  if (pa.wallMillis !== pb.wallMillis) return pa.wallMillis < pb.wallMillis ? -1 : 1;
  if (pa.counter !== pb.counter) return pa.counter < pb.counter ? -1 : 1;
  if (pa.nodeId === pb.nodeId) return 0;
  return pa.nodeId < pb.nodeId ? -1 : 1;
}

export type HlcState = {
  lastWallMillis: number;
  counter: number;
  nodeId: string;
};

export function createHlcState(nodeId: string): HlcState {
  return { lastWallMillis: 0, counter: 0, nodeId };
}

export function tickHlc(state: HlcState, nowMillis: number): Hlc {
  if (nowMillis > state.lastWallMillis) {
    state.lastWallMillis = nowMillis;
    state.counter = 0;
  } else {
    state.counter += 1;
  }
  return formatHlc({ wallMillis: state.lastWallMillis, counter: state.counter, nodeId: state.nodeId });
}

export function observeHlc(state: HlcState, remote: Hlc, nowMillis: number): Hlc {
  const r = parseHlc(remote);
  const wall = Math.max(nowMillis, state.lastWallMillis, r.wallMillis);
  let counter = 0;
  if (wall === state.lastWallMillis && wall === r.wallMillis) {
    counter = Math.max(state.counter, r.counter) + 1;
  } else if (wall === state.lastWallMillis) {
    counter = state.counter + 1;
  } else if (wall === r.wallMillis) {
    counter = r.counter + 1;
  }
  state.lastWallMillis = wall;
  state.counter = counter;
  return formatHlc({ wallMillis: wall, counter, nodeId: state.nodeId });
}

