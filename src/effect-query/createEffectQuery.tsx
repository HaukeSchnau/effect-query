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
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schedule from "effect/Schedule"

import { QueryContext } from "./QueryContext"
import { QueryClient, type QueryClientService } from "./QueryClient"
import { allInvalidationKey, exactKey, prefixKey, queryInvalidationKeys, type QueryKey } from "./queryKeys"

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
  readonly queryFn?: never
}

type UseQueryFnOptions<A, E, R> = {
  readonly effect?: never
  /**
   * Compatibility API: a function that receives the queryKey.
   */
  readonly queryFn: (options: { readonly queryKey: QueryKey }) => Effect.Effect<A, E, R>
}

export type UseQueryOptions<A, E, R> = UseQueryBaseOptions<A, E> & (UseQueryEffectOptions<A, E, R> | UseQueryFnOptions<A, E, R>)

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

export interface UseMutationOptions<Arg, A, E, R> {
  readonly mutationKey?: QueryKey | undefined
  readonly mutationFn: (arg: Arg) => Effect.Effect<A, E, R | QueryClient | Reactivity>
  readonly invalidate?: ReadonlyArray<QueryKey> | QueryKey | undefined
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
  readonly invalidateQuery: (key: QueryKey) => void
  readonly invalidateQueries: (prefix: QueryKey) => void
  readonly invalidateAll: () => void
  readonly prefetchQuery: <A, E, R>(options: Omit<UseQueryOptions<A, E, R>, "enabled">) => Promise<void>
}

export interface EffectQuery<R> {
  readonly Provider: React.FC<{
    readonly children?: React.ReactNode | undefined
    readonly defaultGcTime?: Duration.DurationInput | undefined
  }>
  readonly useQuery: <A, E>(options: UseQueryOptions<A, E, R>) => UseQueryResult<A, E>
  readonly useSuspenseQuery: <A, E>(options: UseSuspenseQueryOptions<A, E, R>) => UseSuspenseQueryResult<A>
  readonly useMutation: <Arg, A, E>(options: UseMutationOptions<Arg, A, E, R>) => UseMutationResult<Arg, A, E>
  readonly useQueryClient: () => QueryClientApi
}

type QueryClientContextValue<R> = {
  readonly runtime: Atom.AtomRuntime<R, never>
  readonly getQueryAtom: <A, E>(options: UseQueryOptions<A, E, R>) => Atom.Atom<AtomResult.Result<A, E>>
  readonly invalidate: Atom.Writable<AtomResult.Result<void, never>, ReadonlyArray<string>>
  readonly queryClient: QueryClientService
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

    let queryClientService!: QueryClientService

    const toEffect = <A, E>(query: UseQueryOptions<A, E, R>): Effect.Effect<A, E, R> => {
      const effect = (query as any).effect as Effect.Effect<A, E, R | QueryContext | QueryClient> | undefined
      if (effect !== undefined) {
        return effect.pipe(
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
        Atom.withReactivity(queryInvalidationKeys(query.queryKey)),
        query.gcTime === undefined
          ? Atom.setIdleTTL("5 minutes")
          : Atom.setIdleTTL(query.gcTime)
      )

      queryAtoms.set(keyHash, atom)
      return atom
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
      invalidateQuery: (key) => Reactivity_.invalidate([exactKey(key)]),
      invalidateQueries: (prefix) => Reactivity_.invalidate([prefixKey(prefix)]),
      invalidateAll: Reactivity_.invalidate([allInvalidationKey]),
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

    return { runtime, getQueryAtom, invalidate, queryClient: queryClientService }
  }

  const Provider: EffectQuery<R>["Provider"] = (props) => {
    const client = React.useMemo(() => createClientValue(), [])
    const defaultIdleTTL = decodeMillis(props.defaultGcTime ?? "5 minutes", 5 * 60_000)
    return (
      <RegistryProvider defaultIdleTTL={defaultIdleTTL}>
        <QueryClientContext.Provider value={client}>{props.children}</QueryClientContext.Provider>
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

    const invalidationKeys = React.useMemo(() => {
      const normalize = (value: UseMutationOptions<Arg, A, E, R>["invalidate"]): ReadonlyArray<QueryKey> => {
        if (value === undefined) return []
        if (Array.isArray(value) && value.length > 0 && (value as ReadonlyArray<any>).every(Array.isArray)) {
          return value as ReadonlyArray<QueryKey>
        }
        return [value as QueryKey]
      }

      const invalidates = normalize(mutation.invalidate)

      const keys: Array<string> = []
      for (const key of invalidates) {
        keys.push(prefixKey(key))
      }
      return keys
    }, [mutation.invalidate])

    const mutationAtom = React.useMemo(
      () =>
        client.runtime.fn(
          Effect.fnUntraced(function*(arg: any) {
            return yield* mutation.mutationFn(arg as Arg).pipe(Effect.provideService(QueryClient, client.queryClient))
          }),
          invalidationKeys.length > 0 ? { reactivityKeys: invalidationKeys } : undefined
        ),
      [client.queryClient, client.runtime, invalidationKeys, mutation.mutationFn]
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

  const useQueryClient = (): QueryClientApi => {
    const client = useClient()
    const invalidate = useAtomSet(client.invalidate)
    const getQueryAtom = client.getQueryAtom
    const registry = React.useContext(RegistryContext)

    const invalidateQuery = React.useCallback((key: QueryKey) => invalidate([exactKey(key)]), [invalidate])
    const invalidateQueries = React.useCallback((prefix: QueryKey) => invalidate([prefixKey(prefix)]), [invalidate])
    const invalidateAll = React.useCallback(() => invalidate([allInvalidationKey]), [invalidate])

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
      invalidateQuery,
      invalidateQueries,
      invalidateAll,
      prefetchQuery: prefetchQueryWithRegistry
    }
  }

  return { Provider, useQuery, useSuspenseQuery, useMutation, useQueryClient }
}
