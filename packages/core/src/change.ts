import type { Hlc } from './hlc';

export type ChangeKind = 'upsert' | 'delete';

export type ConvergeSchema = Record<string, Record<string, unknown>>;

export type EntityName<S extends ConvergeSchema> = Extract<keyof S, string>;

type FieldKey<T extends Record<string, unknown>> = Extract<keyof T, string>;

export type Change<
  S extends ConvergeSchema = ConvergeSchema,
  E extends EntityName<S> = EntityName<S>,
> = {
  stream: string;
  entity: E;
  entityId: string;
  kind: ChangeKind;
  patch: Partial<S[E]>;
  tags: Partial<Record<FieldKey<S[E]>, Hlc>>;
  hlc: Hlc;
};

