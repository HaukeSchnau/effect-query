import { RegistryContext, RegistryProvider, useAtomSuspense, useAtomValue, useAtomSet } from "@effect-atom/atom-react"
import * as Atom from "@effect-atom/atom/Atom"
import { AtomRegistry } from "@effect-atom/atom/Registry"
import type * as Registry from "@effect-atom/atom/Registry"
import * as AtomResult from "@effect-atom/atom/Result"
import * as React from "react"
import * as Reactivity_ from "@effect/experimental/Reactivity"
import type { Reactivity } from "@effect/experimental/Reactivity"
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"

import { QueryContext } from "./QueryContext"
import { QueryClient, type QueryClientService } from "./QueryClient"
import { exactKey, hashQueryKey, type QueryKey } from "./queryKeys"
import {
  compileInvalidations,
  Invalidation,
  type Invalidation as InvalidationSpec,
  queryInvalidationKeys,
  type QueryTag
} from "./invalidation"

export type QueryStatus = "idle" | "loading" | "success" | "error"

type UseQueryBaseOptions<A, E> = {
  readonly queryKey: QueryKey
  /**
   * Preferred API: a plain Effect that can require services from `createEffectQuery({ layer })`.
   * If you need the key inside the Effect, use `yield* QueryContext` to access it.
   */
  readonly enabled?: boolean | undefined
  readonly initialData?: A | (() => A) | undefined
  readonly staleTime?: Duration.DurationInput | undefined
  readonly gcTime?: Duration.DurationInput | undefined
  /**
   * Marks the query as resource-scoped. When `true` and `gcTime` is not provided,
   * the query is configured to be GC'd immediately after the last observer unmounts.
   */
  readonly scoped?: boolean | undefined
  /**
   * Extra invalidation tags for this query (in addition to its queryKey exact/prefix keys).
   */
  readonly tags?: ReadonlyArray<QueryTag> | undefined
  /**
   * Retry policy for the query.
   *
   * Example: `Schedule.exponential("200 millis").pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3)))`
   */
  readonly retry?: Schedule.Schedule<any, E, any> | undefined
  readonly refetchOnWindowFocus?: boolean | undefined
  readonly refetchOnReconnect?: boolean | undefined
  /**
   * Polling policy for refetching this query (after it has been mounted).
   *
   * Example: `Schedule.spaced("30 seconds")`
   */
  readonly refetch?: Schedule.Schedule<any, unknown, any> | undefined
}

type UseQueryEffectOptions<A, E, R> = {
  readonly effect: Effect.Effect<A, E, R | QueryContext | QueryClient | Reactivity>
  readonly scopedEffect?: never
  readonly queryFn?: never
}

type UseQueryScopedEffectOptions<A, E, R> = {
  readonly effect?: never
  readonly scopedEffect: Effect.Effect<A, E, Scope.Scope | R | QueryContext | QueryClient | Reactivity>
  readonly queryFn?: never
}

type UseQueryFnOptions<A, E, R> = {
  readonly effect?: never
  readonly scopedEffect?: never
  /**
   * Compatibility API: a function that receives the queryKey.
   */
  readonly queryFn: (options: { readonly queryKey: QueryKey }) => Effect.Effect<A, E, R>
}

export type UseQueryOptions<A, E, R> =
  & UseQueryBaseOptions<A, E>
  & (UseQueryEffectOptions<A, E, R> | UseQueryScopedEffectOptions<A, E, R> | UseQueryFnOptions<A, E, R>)

export interface UseQueryResult<A, E> {
  readonly result: AtomResult.Result<A, E>
  readonly data: Option.Option<A>
  readonly error: Option.Option<Cause.Cause<E>>
  readonly status: QueryStatus
  readonly isFetching: boolean
  readonly isStale: boolean
  readonly refetch: () => void
}

export type UseSuspenseQueryOptions<A, E, R> = UseQueryOptions<A, E, R> & {
  readonly suspendOnWaiting?: boolean | undefined
}

export interface UseSuspenseQueryResult<A> {
  readonly data: A
  readonly isFetching: boolean
  readonly isStale: boolean
  readonly refetch: () => void
}

export type UseSuspenseQueryResultCause<A, E> =
  | {
    readonly _tag: "Success"
    readonly data: A
    readonly isFetching: boolean
    readonly isStale: boolean
    readonly refetch: () => void
  }
  | {
    readonly _tag: "Failure"
    readonly cause: Cause.Cause<E>
    readonly previousData: Option.Option<A>
    readonly isFetching: boolean
    readonly isStale: boolean
    readonly refetch: () => void
  }

export interface UseQueryExitResult<A, E> {
  readonly exit: Option.Option<Exit.Exit<A, E>>
  readonly isFetching: boolean
  readonly isStale: boolean
  readonly refetch: () => void
}

export interface UseMutationOptions<Arg, A, E, R> {
  readonly mutationKey?: QueryKey | undefined
  readonly mutationFn: (arg: Arg) => Effect.Effect<A, E, R | QueryClient | Reactivity>
  /**
   * Typed invalidation algebra; compiled to Reactivity keys internally.
   */
  readonly invalidate?: InvalidationSpec | ReadonlyArray<InvalidationSpec> | undefined
  readonly reactivityKeys?: ReadonlyArray<unknown> | Record<string, ReadonlyArray<unknown>> | undefined
}

export interface UseMutationResult<Arg, A, E> {
  readonly mutateAsync: (arg: Arg) => Promise<A>
  readonly mutate: (arg: Arg) => void
  readonly reset: () => void
  readonly data: Option.Option<A>
  readonly error: Option.Option<Cause.Cause<E>>
  readonly status: "idle" | "pending" | "success" | "error"
}

export interface QueryClientApi {
  readonly invalidate: (inv: InvalidationSpec | ReadonlyArray<InvalidationSpec>) => void
  readonly invalidateQuery: (key: QueryKey) => void
  readonly invalidateQueries: (prefix: QueryKey) => void
  readonly invalidateTag: (tag: string) => void
  readonly invalidateTagId: (tag: string, id: unknown) => void
  readonly invalidateAll: () => void
  readonly prefetchQuery: <A, E, R>(options: Omit<UseQueryOptions<A, E, R>, "enabled">) => Promise<void>
}

export interface EffectQuery<R> {
  readonly Provider: React.FC<{
    readonly children?: React.ReactNode | undefined
    readonly defaultGcTime?: Duration.DurationInput | undefined
    readonly scheduleTask?: ((f: () => void) => void) | undefined
    readonly timeoutResolution?: number | undefined
  }>
  readonly queryAtom: <A, E>(options: UseQueryOptions<A, E, R>) => Atom.Atom<AtomResult.Result<A, E>>
  readonly mutationAtom: <Arg, A, E>(options: UseMutationOptions<Arg, A, E, R>) => Atom.Writable<
    AtomResult.Result<A, E>,
    Arg
  >
  readonly useQuery: <A, E>(options: UseQueryOptions<A, E, R>) => UseQueryResult<A, E>
  /**
   * Suspense + throw-on-failure (ErrorBoundary-friendly).
   */
  readonly useSuspenseQuery: <A, E>(options: UseSuspenseQueryOptions<A, E, R>) => UseSuspenseQueryResult<A>
  /**
   * Suspense but does not throw on failure; returns a Cause instead.
   */
  readonly useSuspenseQueryCause: <A, E>(options: UseSuspenseQueryOptions<A, E, R>) => UseSuspenseQueryResultCause<A, E>
  /**
   * Exit/Cause-first hook for users who want `Exit` semantics.
   */
  readonly useQueryExit: <A, E>(options: UseQueryOptions<A, E, R>) => UseQueryExitResult<A, E>
  readonly useMutation: <Arg, A, E>(options: UseMutationOptions<Arg, A, E, R>) => UseMutationResult<Arg, A, E>
  readonly useQueryClient: () => QueryClientApi
}

type QueryClientContextValue<R> = {
  readonly runtime: Atom.AtomRuntime<R, never>
  readonly getQueryAtom: <A, E>(options: UseQueryOptions<A, E, R>) => Atom.Atom<AtomResult.Result<A, E>>
  readonly invalidate: Atom.Writable<AtomResult.Result<void, never>, ReadonlyArray<string>>
  readonly queryClient: QueryClientService
  readonly getMutationAtom: <Arg, A, E>(options: UseMutationOptions<Arg, A, E, R>) => Atom.Writable<
    AtomResult.Result<A, E>,
    Arg
  >
}

const QueryClientContext = React.createContext<QueryClientContextValue<any> | null>(null)

const decodeMillis = (input: Duration.DurationInput | undefined, fallbackMs: number): number => {
  if (input === undefined) return fallbackMs
  return Duration.toMillis(Duration.decode(input))
}

  const computeData = <A, E>(result: AtomResult.Result<A, E>): Option.Option<A> => {
    if (result._tag === "Success") return Option.some(result.value)
    if (result._tag === "Failure") return result.previousSuccess.pipe(Option.map((s) => s.value))
    return Option.none()
  }

const computeError = <A, E>(result: AtomResult.Result<A, E>): Option.Option<Cause.Cause<E>> => {
  if (result._tag === "Failure") return Option.some(result.cause)
  return Option.none()
}

const computeStatus = <A, E>(result: AtomResult.Result<A, E>): QueryStatus => {
  if (result._tag === "Success") return "success"
  if (result._tag === "Failure") return "error"
  return result.waiting ? "loading" : "idle"
}

const computeIsStale = <A, E>(result: AtomResult.Result<A, E>, staleTimeMs: number): boolean => {
  if (staleTimeMs === Infinity) return false
  if (result._tag === "Success") return Date.now() - result.timestamp > staleTimeMs
  if (result._tag === "Failure" && result.previousSuccess._tag === "Some") {
    return Date.now() - result.previousSuccess.value.timestamp > staleTimeMs
  }
  return true
}

const toExitOption = <A, E>(result: AtomResult.Result<A, E>): Option.Option<Exit.Exit<A, E>> => {
  if (result._tag === "Success") return Option.some(Exit.succeed(result.value))
  if (result._tag === "Failure") return Option.some(Exit.failCause(result.cause))
  return Option.none()
}

const startRefetchFiber = (
  schedule: Schedule.Schedule<any, unknown, any>,
  refresh: () => void
): Fiber.Fiber<void, never> => {
  const scheduleVoid = schedule.pipe(Schedule.mapInput(() => undefined as unknown))
  const program = Effect.gen(function*() {
    const driver = yield* Schedule.driver(scheduleVoid)
    while (true) {
      const exit = yield* Effect.exit(driver.next(undefined))
      if (exit._tag === "Failure") {
        return
      }
      refresh()
    }
  })
  // The schedule may require services like `Clock` / `Random` which are available in the default runtime,
  // but `runFork` is typed as requiring `never`, so we erase the requirement here.
  return Effect.runFork(program as Effect.Effect<void, never, never>)
}

export const createEffectQuery = <R,>(options: {
  readonly layer: Layer.Layer<R, never>
}): EffectQuery<R> => {
  const runtime = Atom.runtime(options.layer)

  const createClientValue = (): QueryClientContextValue<R> => {
    const queryAtoms = new Map<string, Atom.Atom<AtomResult.Result<any, any>>>()
    const mutationAtoms = new Map<string, Atom.Writable<AtomResult.Result<any, any>, any>>()

    let queryClientService!: QueryClientService

    const toEffect = <A, E>(query: UseQueryOptions<A, E, R>): Effect.Effect<A, E, R> => {
      const effect = (query as any).effect as Effect.Effect<A, E, R | QueryContext | QueryClient> | undefined
      const scopedEffect = (query as any).scopedEffect as Effect.Effect<
        A,
        E,
        Scope.Scope | R | QueryContext | QueryClient
      > | undefined
      if (effect !== undefined) {
        return effect.pipe(
          Effect.provideService(QueryContext, { queryKey: query.queryKey }),
          Effect.provideService(QueryClient, queryClientService)
        ) as Effect.Effect<A, E, R>
      }
      if (scopedEffect !== undefined) {
        return scopedEffect.pipe(
          Effect.provideService(QueryContext, { queryKey: query.queryKey }),
          Effect.provideService(QueryClient, queryClientService)
        ) as Effect.Effect<A, E, R>
      }
      if (query.queryFn === undefined) {
        throw new Error("useQuery requires either `effect` or `queryFn`")
      }
      return query.queryFn({ queryKey: query.queryKey }).pipe(
        Effect.provideService(QueryContext, { queryKey: query.queryKey }),
        Effect.provideService(QueryClient, queryClientService)
      ) as Effect.Effect<A, E, R>
    }

    const invalidate = runtime.fn(
      Effect.fnUntraced(function*(keys: ReadonlyArray<string>) {
        yield* Reactivity_.invalidate(keys)
      })
    )

    const getQueryAtom = <A, E>(query: UseQueryOptions<A, E, R>): Atom.Atom<AtomResult.Result<A, E>> => {
      const keyHash = exactKey(query.queryKey)
      const cached = queryAtoms.get(keyHash) as Atom.Atom<AtomResult.Result<A, E>> | undefined
      if (cached !== undefined) return cached

      const base: Effect.Effect<A, E, any> = Effect.suspend(() => toEffect(query)) as any
      const retried: Effect.Effect<A, E, any> = query.retry !== undefined
        ? (Effect.retry(base, query.retry as any) as any)
        : base

      const atom = runtime.atom(retried, {
        initialValue: query.initialData !== undefined
          ? (typeof query.initialData === "function" ? (query.initialData as () => A)() : query.initialData)
          : undefined
      }).pipe(
        Atom.withReactivity(queryInvalidationKeys(query.queryKey, query.tags)),
        query.gcTime === undefined
          ? (query.scoped ? Atom.setIdleTTL("0 millis") : Atom.setIdleTTL("5 minutes"))
          : Atom.setIdleTTL(query.gcTime)
      )

      queryAtoms.set(keyHash, atom)
      return atom
    }

    const getMutationAtom = <Arg, A, E>(mutation: UseMutationOptions<Arg, A, E, R>) => {
      const keyHash = mutation.mutationKey ? `eq:m:${hashQueryKey(mutation.mutationKey)}` : undefined
      if (keyHash !== undefined) {
        const cached = mutationAtoms.get(keyHash) as Atom.Writable<AtomResult.Result<A, E>, Arg> | undefined
        if (cached !== undefined) return cached
      }

      const reactivityKeys = mutation.reactivityKeys ??
        (mutation.invalidate !== undefined ? compileInvalidations(mutation.invalidate) : undefined)

      const atom = runtime.fn(
        Effect.fnUntraced(function*(arg: Arg) {
          return yield* mutation.mutationFn(arg).pipe(Effect.provideService(QueryClient, queryClientService))
        }),
        reactivityKeys ? { reactivityKeys } : undefined
      )

      if (keyHash !== undefined) {
        mutationAtoms.set(keyHash, atom as any)
      }
      return atom as Atom.Writable<AtomResult.Result<A, E>, Arg>
    }

    const awaitAtomComplete = <A, E>(registry: Registry.Registry, atom: Atom.Atom<AtomResult.Result<A, E>>) =>
      Effect.async<AtomResult.Result<A, E>, never>((resume) => {
        const unsub = registry.subscribe(atom, (result: AtomResult.Result<A, E>) => {
          if (result._tag === "Initial" || result.waiting) return
          unsub()
          resume(Effect.succeed(result))
        })
        return Effect.sync(() => unsub())
      })

    queryClientService = {
      invalidateQuery: (key) => Reactivity_.invalidate(compileInvalidations(Invalidation.exact(key))),
      invalidateQueries: (prefix) => Reactivity_.invalidate(compileInvalidations(Invalidation.prefix(prefix))),
      invalidateAll: Reactivity_.invalidate(compileInvalidations(Invalidation.all())),
      invalidate: (inv) => Reactivity_.invalidate(compileInvalidations(inv)),
      prefetch: (key, effect) =>
        Effect.gen(function*() {
          const registry = yield* AtomRegistry
          const atom = getQueryAtom({ queryKey: key, effect } as any as UseQueryOptions<any, any, R>)
          return yield* Effect.acquireUseRelease(
            Effect.sync(() => registry.mount(atom)),
            () =>
              Effect.gen(function*() {
                registry.refresh(atom)
                const result = yield* awaitAtomComplete(registry, atom)
                if (result._tag === "Success") {
                  return
                }
                if (result._tag === "Failure") {
                  return yield* Effect.failCause(result.cause)
                }
                return yield* Effect.die("Unexpected query result state")
              }),
            (dispose) => Effect.sync(dispose)
          )
        }),
      ensureQueryData: (key, effect) =>
        Effect.gen(function*() {
          const registry = yield* AtomRegistry
          const atom = getQueryAtom({ queryKey: key, effect } as any as UseQueryOptions<any, any, R>)
          return yield* Effect.acquireUseRelease(
            Effect.sync(() => registry.mount(atom)),
            () =>
              Effect.gen(function*() {
                registry.refresh(atom)
                const result = yield* awaitAtomComplete(registry, atom)
                if (result._tag === "Success") {
                  return result.value
                }
                if (result._tag === "Failure") {
                  return yield* Effect.failCause(result.cause)
                }
                return yield* Effect.die("Unexpected query result state")
              }),
            (dispose) => Effect.sync(dispose)
          )
        })
    }

    return { runtime, getQueryAtom, invalidate, queryClient: queryClientService, getMutationAtom }
  }

  const clientValue = createClientValue()

  const Provider: EffectQuery<R>["Provider"] = (props) => {
    const defaultIdleTTL = decodeMillis(props.defaultGcTime ?? "5 minutes", 5 * 60_000)
    return (
      <RegistryProvider
        defaultIdleTTL={defaultIdleTTL}
        scheduleTask={props.scheduleTask}
        timeoutResolution={props.timeoutResolution}
      >
        <QueryClientContext.Provider value={clientValue}>{props.children}</QueryClientContext.Provider>
      </RegistryProvider>
    )
  }

  const useClient = (): QueryClientContextValue<R> => {
    const ctx = React.useContext(QueryClientContext)
    if (ctx === null) {
      throw new Error("EffectQuery.Provider is missing")
    }
    return ctx
  }

  const useQuery = <A, E>(query: UseQueryOptions<A, E, R>): UseQueryResult<A, E> => {
    const client = useClient()
    const keySig = React.useMemo(() => exactKey(query.queryKey), [query.queryKey])
    const atom = React.useMemo(() => client.getQueryAtom(query), [client, keySig])
    const registry = React.useContext(RegistryContext)

    const enabled = query.enabled ?? true
    const readAtom = React.useMemo(
      () =>
        (enabled ? atom : Atom.make(() => AtomResult.initial<A, E>())),
      [atom, enabled]
    )
    const result = useAtomValue(readAtom)

    const staleTimeMs = decodeMillis(query.staleTime, 0)
    const isStale = enabled ? computeIsStale(result, staleTimeMs) : false

    const latestResultRef = React.useRef(result)
    latestResultRef.current = result

    const refetch = React.useCallback(() => {
      if (enabled) {
        registry.refresh(atom)
        return
      }
      const dispose = registry.mount(atom)
      registry.refresh(atom)
      const unsub = registry.subscribe(atom, (next: any) => {
        if (next._tag === "Initial" || next.waiting) return
        unsub()
        dispose()
      })
    }, [atom, enabled, registry])

    React.useEffect(() => {
      if (!enabled) return
      if (query.refetch === undefined) return
      const fiber = startRefetchFiber(query.refetch, refetch)
      return () => {
        Effect.runFork(Fiber.interruptFork(fiber))
      }
    }, [enabled, query.refetch, refetch])

    React.useEffect(() => {
      if (!enabled) return
      if (result._tag !== "Initial" && isStale) {
        refetch()
      }
    }, [enabled, isStale, refetch, result._tag])

    React.useEffect(() => {
      if (!enabled) return
      if (query.refetchOnWindowFocus === false) return
      const onFocus = () => {
        if (computeIsStale(latestResultRef.current, staleTimeMs)) {
          refetch()
        }
      }
      window.addEventListener("focus", onFocus)
      return () => window.removeEventListener("focus", onFocus)
    }, [enabled, query.refetchOnWindowFocus, refetch, staleTimeMs])

    React.useEffect(() => {
      if (!enabled) return
      if (query.refetchOnReconnect === false) return
      const onOnline = () => refetch()
      window.addEventListener("online", onOnline)
      return () => window.removeEventListener("online", onOnline)
    }, [enabled, query.refetchOnReconnect, refetch])

    return {
      result,
      data: computeData(result),
      error: computeError(result),
      status: computeStatus(result),
      isFetching: result.waiting,
      isStale,
      refetch
    }
  }

  const useMutation = <Arg, A, E>(mutation: UseMutationOptions<Arg, A, E, R>): UseMutationResult<Arg, A, E> => {
    const client = useClient()

    const mutationKeySig = React.useMemo(
      () => (mutation.mutationKey ? `eq:m:${hashQueryKey(mutation.mutationKey)}` : ""),
      [mutation.mutationKey]
    )
    const mutationAtom = React.useMemo(
      () => client.getMutationAtom(mutation),
      [client, mutationKeySig, mutation.invalidate, mutation.mutationFn, mutation.reactivityKeys]
    )

    const run = useAtomSet(mutationAtom, { mode: "promiseExit" })

    const [state, setState] = React.useState<{
      status: "idle" | "pending" | "success" | "error"
      data: Option.Option<any>
      error: Option.Option<Cause.Cause<any>>
    }>({ status: "idle", data: Option.none(), error: Option.none() })

    const mutateAsync = React.useCallback(async (arg: Arg) => {
        setState((s) => ({ ...s, status: "pending", error: Option.none() }))
        const exit = await run(arg as any)
        if (exit._tag === "Success") {
          setState({ status: "success", data: Option.some(exit.value), error: Option.none() })
          return exit.value
        }
        setState({ status: "error", data: Option.none(), error: Option.some(exit.cause) })
        throw exit.cause
      },
      [run]
    )

    const mutate = React.useCallback(
      (arg: Arg) => {
        void mutateAsync(arg)
      },
      [mutateAsync]
    )

    const reset = React.useCallback(() => {
      setState({ status: "idle", data: Option.none(), error: Option.none() })
    }, [])

    return {
      mutateAsync,
      mutate,
      reset,
      status: state.status,
      data: state.data,
      error: state.error
    }
  }

  const useSuspenseQuery = <A, E>(
    query: UseSuspenseQueryOptions<A, E, R>
  ): UseSuspenseQueryResult<A> => {
    const client = useClient()
    const keySig = React.useMemo(() => exactKey(query.queryKey), [query.queryKey])
    const atom = React.useMemo(() => client.getQueryAtom(query), [client, keySig])
    const registry = React.useContext(RegistryContext)

    if (query.enabled === false) {
      throw new Error("useSuspenseQuery does not support enabled: false")
    }

    const result = useAtomValue(atom)
    const success = useAtomSuspense(atom, { suspendOnWaiting: query.suspendOnWaiting ?? false }) as AtomResult.Success<
      A,
      E
    >
    const data = success.value

    const staleTimeMs = decodeMillis(query.staleTime, 0)
    const isStale = computeIsStale(result, staleTimeMs)

    const refetch = React.useCallback(() => {
      registry.refresh(atom)
    }, [atom, registry])

    React.useEffect(() => {
      if (query.refetch === undefined) return
      const fiber = startRefetchFiber(query.refetch, refetch)
      return () => {
        Effect.runFork(Fiber.interruptFork(fiber))
      }
    }, [query.refetch, refetch])

    React.useEffect(() => {
      if (result._tag !== "Initial" && isStale) {
        refetch()
      }
    }, [isStale, refetch, result._tag])

    React.useEffect(() => {
      if (query.refetchOnWindowFocus === false) return
      const onFocus = () => {
        if (computeIsStale(result, staleTimeMs)) {
          refetch()
        }
      }
      window.addEventListener("focus", onFocus)
      return () => window.removeEventListener("focus", onFocus)
    }, [query.refetchOnWindowFocus, refetch, result, staleTimeMs])

    React.useEffect(() => {
      if (query.refetchOnReconnect === false) return
      const onOnline = () => refetch()
      window.addEventListener("online", onOnline)
      return () => window.removeEventListener("online", onOnline)
    }, [query.refetchOnReconnect, refetch])

    return { data, isFetching: result.waiting, isStale, refetch }
  }

  const useSuspenseQueryCause = <A, E>(
    query: UseSuspenseQueryOptions<A, E, R>
  ): UseSuspenseQueryResultCause<A, E> => {
    const client = useClient()
    const keySig = React.useMemo(() => exactKey(query.queryKey), [query.queryKey])
    const atom = React.useMemo(() => client.getQueryAtom(query), [client, keySig])
    const registry = React.useContext(RegistryContext)

    if (query.enabled === false) {
      throw new Error("useSuspenseQueryCause does not support enabled: false")
    }

    const result = useAtomValue(atom)
    const suspenseResult = useAtomSuspense(atom, {
      suspendOnWaiting: query.suspendOnWaiting ?? false,
      includeFailure: true
    }) as AtomResult.Success<A, E> | AtomResult.Failure<A, E>

    const staleTimeMs = decodeMillis(query.staleTime, 0)
    const isStale = computeIsStale(result, staleTimeMs)

    const refetch = React.useCallback(() => {
      registry.refresh(atom)
    }, [atom, registry])

    React.useEffect(() => {
      if (query.refetch === undefined) return
      const fiber = startRefetchFiber(query.refetch, refetch)
      return () => {
        Effect.runFork(Fiber.interruptFork(fiber))
      }
    }, [query.refetch, refetch])

    React.useEffect(() => {
      if (result._tag !== "Initial" && isStale) {
        refetch()
      }
    }, [isStale, refetch, result._tag])

    React.useEffect(() => {
      if (query.refetchOnWindowFocus === false) return
      const onFocus = () => {
        if (computeIsStale(result, staleTimeMs)) {
          refetch()
        }
      }
      window.addEventListener("focus", onFocus)
      return () => window.removeEventListener("focus", onFocus)
    }, [query.refetchOnWindowFocus, refetch, result, staleTimeMs])

    React.useEffect(() => {
      if (query.refetchOnReconnect === false) return
      const onOnline = () => refetch()
      window.addEventListener("online", onOnline)
      return () => window.removeEventListener("online", onOnline)
    }, [query.refetchOnReconnect, refetch])

    if (suspenseResult._tag === "Success") {
      return { _tag: "Success", data: suspenseResult.value, isFetching: result.waiting, isStale, refetch }
    }
    return {
      _tag: "Failure",
      cause: suspenseResult.cause,
      previousData: suspenseResult.previousSuccess.pipe(Option.map((s) => s.value)),
      isFetching: result.waiting,
      isStale,
      refetch
    }
  }

  const useQueryExit = <A, E>(query: UseQueryOptions<A, E, R>): UseQueryExitResult<A, E> => {
    const { result, isFetching, isStale, refetch } = useQuery(query)
    return { exit: toExitOption(result), isFetching, isStale, refetch }
  }

  const useQueryClient = (): QueryClientApi => {
    const client = useClient()
    const invalidate = useAtomSet(client.invalidate)
    const getQueryAtom = client.getQueryAtom
    const registry = React.useContext(RegistryContext)

    const invalidateTyped = React.useCallback(
      (inv: InvalidationSpec | ReadonlyArray<InvalidationSpec>) => invalidate(compileInvalidations(inv)),
      [invalidate]
    )
    const invalidateQuery = React.useCallback((key: QueryKey) => invalidateTyped(Invalidation.exact(key)), [invalidateTyped])
    const invalidateQueries = React.useCallback(
      (prefix: QueryKey) => invalidateTyped(Invalidation.prefix(prefix)),
      [invalidateTyped]
    )
    const invalidateTag = React.useCallback((tag: string) => invalidateTyped(Invalidation.tag(tag)), [invalidateTyped])
    const invalidateTagId = React.useCallback(
      (tag: string, id: unknown) => invalidateTyped(Invalidation.tagId(tag, id)),
      [invalidateTyped]
    )

    // Prefetch needs the current registry, which is only available via the RegistryContext hook.
    // We implement it by reading the registry through a tiny atom, then mounting the query atom.
    const prefetchQueryWithRegistry = React.useCallback(
      async <A, E, R0>(query: Omit<UseQueryOptions<A, E, R0>, "enabled">) => {
        const atom = getQueryAtom(query as any as UseQueryOptions<A, E, R>)
        const dispose = registry.mount(atom)
        registry.refresh(atom)
        await new Promise<void>((resolve) => {
          const unsub = registry.subscribe(atom, (result: any) => {
            if (result._tag === "Initial" || result.waiting) return
            unsub()
            dispose()
            resolve()
          })
        })
      },
      [getQueryAtom, registry]
    )

    return {
      invalidate: invalidateTyped,
      invalidateQuery,
      invalidateQueries,
      invalidateTag,
      invalidateTagId,
      invalidateAll: () => invalidateTyped(Invalidation.all()),
      prefetchQuery: prefetchQueryWithRegistry
    }
  }

  const queryAtom = <A, E>(options: UseQueryOptions<A, E, R>) => clientValue.getQueryAtom(options)
  const mutationAtom = <Arg, A, E>(options: UseMutationOptions<Arg, A, E, R>) => clientValue.getMutationAtom(options)

  return {
    Provider,
    queryAtom,
    mutationAtom,
    useQuery,
    useSuspenseQuery,
    useSuspenseQueryCause,
    useQueryExit,
    useMutation,
    useQueryClient
  }
}
