import type { Hlc } from './hlc';

export type ChangeKind = 'upsert' | 'delete';

export type Change = {
  stream: string;
  entity: string;
  entityId: string;
  kind: ChangeKind;
  patch: Record<string, unknown>;
  tags: Record<string, Hlc>;
  hlc: Hlc;
};

