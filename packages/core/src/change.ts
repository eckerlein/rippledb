import type { Hlc } from "./hlc";

export type ChangeKind = "upsert" | "delete";

export type RippleSchema = Record<string, Record<string, unknown>>;

export type EntityName<S extends RippleSchema> = Extract<keyof S, string>;

type FieldKey<T extends Record<string, unknown>> = Extract<keyof T, string>;

export type ChangePatch<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
> = Partial<S[E]>;

export type ChangeTags<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
> = Partial<Record<FieldKey<S[E]>, Hlc>>;

export type Change<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
> = {
  stream: string;
  entity: E;
  entityId: string;
  kind: ChangeKind;
  patch: ChangePatch<S, E>;
  tags: ChangeTags<S, E>;
  hlc: Hlc;
};

export type UpsertChangeInput<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
> = {
  stream: string;
  entity: E;
  entityId: string;
  patch: ChangePatch<S, E>;
  hlc: Hlc;
  tags?: ChangeTags<S, E>;
};

export type DeleteChangeInput<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
> = {
  stream: string;
  entity: E;
  entityId: string;
  hlc: Hlc;
};

export function makeUpsert<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
>(input: UpsertChangeInput<S, E>): Change<S, E> {
  const tags = input.tags
    ?? (Object.fromEntries(
      Object.keys(input.patch).map(key => [key, input.hlc]),
    ) as ChangeTags<S, E>);

  return {
    stream: input.stream,
    entity: input.entity,
    entityId: input.entityId,
    kind: "upsert",
    patch: input.patch,
    tags,
    hlc: input.hlc,
  };
}

export function makeDelete<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
>(input: DeleteChangeInput<S, E>): Change<S, E> {
  return {
    stream: input.stream,
    entity: input.entity,
    entityId: input.entityId,
    kind: "delete",
    patch: {},
    tags: {},
    hlc: input.hlc,
  };
}
