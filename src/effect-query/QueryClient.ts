import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { Reactivity } from "@effect/experimental/Reactivity"
import type { AtomRegistry } from "@effect-atom/atom/Registry"
import type { QueryKey } from "./queryKeys"
import type { Invalidation } from "./invalidation"

export interface QueryClientService {
  readonly invalidateQuery: (key: QueryKey) => Effect.Effect<void, never, Reactivity>
  readonly invalidateQueries: (prefix: QueryKey) => Effect.Effect<void, never, Reactivity>
  readonly invalidateAll: Effect.Effect<void, never, Reactivity>
  readonly invalidate: (inv: Invalidation | ReadonlyArray<Invalidation>) => Effect.Effect<void, never, Reactivity>
  readonly prefetch: <A, E>(
    key: QueryKey,
    effect: Effect.Effect<A, E, any>
  ) => Effect.Effect<void, E, AtomRegistry | Reactivity>
  readonly ensureQueryData: <A, E>(
    key: QueryKey,
    effect: Effect.Effect<A, E, any>
  ) => Effect.Effect<A, E, AtomRegistry | Reactivity>
}

export class QueryClient extends Context.Tag("effect-query/QueryClient")<
  QueryClient,
  QueryClientService
>() {}
