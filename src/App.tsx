import { Result, useAtomSet, useAtomValue } from "@effect-atom/atom-react"
import * as Atom from "@effect-atom/atom/Atom"
import { Effect, Ref } from "effect"
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as React from "react"
import * as Schedule from "effect/Schedule"
import { createEffectQuery, QueryClient, QueryContext } from "./effect-query"
import "./App.css"

class CounterApi extends Effect.Service<CounterApi>()("demo/CounterApi", {
  scoped: Effect.gen(function*() {
    const ref = yield* Ref.make(0)
    const getCalls = yield* Ref.make(0)

    const get = Effect.gen(function*() {
      yield* Effect.sleep("250 millis")
      const calls = yield* Ref.updateAndGet(getCalls, (n) => n + 1)
      if (calls % 7 === 0) {
        return yield* Effect.fail(new Error("Simulated network error (every 7th fetch)"))
      }
      return yield* Ref.get(ref)
    })

    const increment = Effect.gen(function*() {
      yield* Effect.sleep("250 millis")
      const next = yield* Ref.updateAndGet(ref, (n) => n + 1)
      return next
    })

    const calls = Ref.get(getCalls)

    return { get, increment, calls } as const
  })
}) {}

const EffectQuery = createEffectQuery({
  layer: CounterApi.Default
})

export default function App() {
  return (
    <EffectQuery.Provider>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
        <h1 style={{ marginBottom: 8 }}>Effect Query (prototype)</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>
          A TanStack Query-ish client built from Effect + effect-atom.
        </p>

        <CounterCard />
        <div style={{ height: 16 }} />
        <SharedObservers />
        <div style={{ height: 16 }} />
        <SuspenseExample />
        <div style={{ height: 16 }} />
        <PollingExample />
        <div style={{ height: 16 }} />
        <RetryExample />
        <div style={{ height: 16 }} />
        <AtomFirstExample />
      </div>
    </EffectQuery.Provider>
  )
}

function CounterCard() {
  const client = EffectQuery.useQueryClient()

  const query = EffectQuery.useQuery({
    queryKey: ["counter", "value"],
    effect: Effect.gen(function*() {
      const _ctx = yield* QueryContext
      void _ctx
      const api = yield* CounterApi
      return yield* api.get
    }),
    staleTime: "1 second",
    gcTime: "30 seconds",
    refetchOnWindowFocus: true
  })

  const mutation = EffectQuery.useMutation({
    mutationFn: () =>
      Effect.gen(function*() {
        const api = yield* CounterApi
        const next = yield* api.increment
        const client = yield* QueryClient
        yield* client.invalidateQueries(["counter"])
        return next
      })
  })

  return (
    <div className="card" style={{ textAlign: "left" }}>
      <h2 style={{ marginTop: 0 }}>Counter</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ minWidth: 220 }}>
          {Result.builder(query.result)
            .onInitial(() => <div>Loading…</div>)
            .onFailure((cause: Cause.Cause<Error>) => <div>Error: {Cause.pretty(cause)}</div>)
            .onSuccess((value: number, { waiting }: { readonly waiting: boolean }) => (
              <div>
                <div style={{ fontSize: 32, fontWeight: 700 }}>{value}</div>
                <div style={{ opacity: 0.7 }}>{waiting ? "Refreshing…" : "Fresh"}</div>
              </div>
            ))
            .render()}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => mutation.mutate(void 0)} disabled={mutation.status === "pending"}>
            +1 (mutation)
          </button>
          <button onClick={query.refetch}>Refetch</button>
          <button onClick={() => client.invalidateQueries(["counter"])}>Invalidate ["counter"]</button>
        </div>
      </div>

      <div style={{ marginTop: 12, opacity: 0.75, fontSize: 12 }}>
        <div>Status: {query.status}</div>
        <div>isFetching: {String(query.isFetching)}</div>
        <div>isStale: {String(query.isStale)}</div>
        <div>mutation: {mutation.status}</div>
      </div>

      {Option.isSome(mutation.error) ? (
        <pre style={{ marginTop: 12, color: "crimson" }}>{Cause.pretty(mutation.error.value)}</pre>
      ) : null}

      {Option.isSome(mutation.data) ? (
        <div style={{ marginTop: 12, opacity: 0.75 }}>
          mutation result: {mutation.data.value}
        </div>
      ) : null}
    </div>
  )
}

function SharedObservers() {
  return (
    <div className="card" style={{ textAlign: "left" }}>
      <h2 style={{ marginTop: 0 }}>Shared Observers</h2>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Both components subscribe to the same <code>queryKey</code>, so the underlying request is shared.
      </p>
      <div style={{ display: "flex", gap: 16 }}>
        <CounterReadOnly label="Observer A" />
        <CounterReadOnly label="Observer B" />
      </div>
    </div>
  )
}

function CounterReadOnly(props: { readonly label: string }) {
  const query = EffectQuery.useQuery({
    queryKey: ["counter", "value"],
    effect: Effect.gen(function*() {
      const api = yield* CounterApi
      return yield* api.get
    }),
    staleTime: "1 second"
  })

  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: 600 }}>{props.label}</div>
      <div style={{ opacity: 0.75, fontSize: 12 }}>{query.isFetching ? "fetching" : query.status}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>
        {Option.getOrElse(query.data, () => 0)}
      </div>
    </div>
  )
}

function SuspenseExample() {
  return (
    <div className="card" style={{ textAlign: "left" }}>
      <h2 style={{ marginTop: 0 }}>Suspense Query</h2>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        This uses <code>useSuspenseQuery</code> and suspends only on the initial load.
      </p>
      <ErrorBoundary fallback={<div style={{ color: "crimson" }}>Something went wrong.</div>}>
        <React.Suspense fallback={<div>Loading…</div>}>
          <SuspenseCounter />
        </React.Suspense>
      </ErrorBoundary>
    </div>
  )
}

function SuspenseCounter() {
  const query = EffectQuery.useSuspenseQuery({
    queryKey: ["counter", "value"],
    effect: Effect.gen(function*() {
      const api = yield* CounterApi
      return yield* api.get
    }),
    staleTime: "1 second"
  })

  return <div style={{ fontSize: 24, fontWeight: 700 }}>{query.data}</div>
}

class ErrorBoundary extends React.Component<
  { readonly fallback: React.ReactNode; readonly children?: React.ReactNode },
  { readonly hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  override render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

function PollingExample() {
  const [enabled, setEnabled] = React.useState(true)

  const polledValue = EffectQuery.useQuery({
    queryKey: ["counter", "polled"],
    effect: Effect.gen(function*() {
      const api = yield* CounterApi
      return yield* api.get
    }),
    staleTime: Infinity,
    enabled,
    refetch: Schedule.spaced("2 seconds")
  })

  const callCount = EffectQuery.useQuery({
    queryKey: ["counter", "calls"],
    effect: Effect.gen(function*() {
      const api = yield* CounterApi
      return yield* api.calls
    }),
    staleTime: "250 millis",
    enabled
  })

  return (
    <div className="card" style={{ textAlign: "left" }}>
      <h2 style={{ marginTop: 0 }}>Schedule-Based Polling</h2>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Polls with <code>refetch: Schedule.spaced("2 seconds")</code> (no setInterval).
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          {Result.builder(polledValue.result)
            .onInitial(() => <div>Loading…</div>)
            .onFailure((cause: Cause.Cause<Error>) => <div>Error: {Cause.pretty(cause)}</div>)
            .onSuccess((value: number, { waiting }: { readonly waiting: boolean }) => (
              <div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
                <div style={{ opacity: 0.7 }}>{waiting ? "Polling…" : "Idle"}</div>
              </div>
            ))
            .render()}
          <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12 }}>
            get() calls: {Option.getOrElse(callCount.data, () => 0)}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => setEnabled((v) => !v)}>{enabled ? "Stop" : "Start"}</button>
          <button onClick={polledValue.refetch}>Manual refetch</button>
        </div>
      </div>
    </div>
  )
}

function RetryExample() {
  const attempts = React.useRef(0)

  const retry = Schedule.exponential("200 millis").pipe(Schedule.intersect(Schedule.recurs(5)))

  const query = EffectQuery.useQuery({
    queryKey: ["retry", "demo"],
    effect: Effect.suspend(() => {
      attempts.current++
      if (attempts.current < 3) return Effect.fail(new Error(`Transient error (attempt ${attempts.current})`))
      return Effect.succeed(`Succeeded on attempt ${attempts.current}`)
    }),
    staleTime: Infinity,
    retry
  })

  return (
    <div className="card" style={{ textAlign: "left" }}>
      <h2 style={{ marginTop: 0 }}>Schedule-Based Retry</h2>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Retries with <code>retry: Schedule.exponential("200 millis")</code> capped by <code>Schedule.recurs(5)</code>.
      </p>
      {Result.builder(query.result)
        .onInitial(() => <div>Loading…</div>)
        .onFailure((cause: Cause.Cause<Error>) => <div style={{ color: "crimson" }}>Error: {Cause.pretty(cause)}</div>)
        .onSuccess((value: string, { waiting }: { readonly waiting: boolean }) => (
          <div>
            <div style={{ fontWeight: 700 }}>{value}</div>
            <div style={{ opacity: 0.7 }}>{waiting ? "Retrying…" : "Done"}</div>
          </div>
        ))
        .render()}
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button onClick={query.refetch}>Run again</button>
        <button
          onClick={() => {
            attempts.current = 0
            query.refetch()
          }}
        >
          Reset attempts + run
        </button>
      </div>
    </div>
  )
}

function AtomFirstExample() {
  const counterQueryAtom = React.useMemo(
    () =>
      EffectQuery.queryAtom({
        queryKey: ["counter", "atom-first"],
        effect: Effect.gen(function*() {
          const api = yield* CounterApi
          return yield* api.get
        }),
        staleTime: "1 second",
        refetch: Schedule.spaced("3 seconds")
      }),
    []
  )

  const counterValueAtom = React.useMemo(
    () => Atom.map(counterQueryAtom, (r) => (r._tag === "Success" ? r.value : 0)),
    [counterQueryAtom]
  )

  const bumpAtom = React.useMemo(
    () =>
      EffectQuery.mutationAtom({
        mutationKey: ["counter", "atom-first", "bump"],
        mutationFn: () =>
          Effect.gen(function*() {
            const api = yield* CounterApi
            return yield* api.increment
          }),
        invalidate: ["counter"]
      }),
    []
  )

  const value = useAtomValue(counterValueAtom)
  const bump = useAtomSet(bumpAtom, { mode: "promiseExit" })
  const client = EffectQuery.useQueryClient()

  return (
    <div className="card" style={{ textAlign: "left" }}>
      <h2 style={{ marginTop: 0 }}>Atom-First Composition</h2>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Uses <code>EffectQuery.queryAtom</code> + <code>Atom.map</code> +{" "}
        <code>EffectQuery.mutationAtom</code> directly (hooks become thin wrappers).
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 700, minWidth: 80 }}>{value}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void bump(void 0)}>+1 (mutationAtom)</button>
          <button onClick={() => client.invalidateQueries(["counter"])}>Invalidate ["counter"]</button>
        </div>
      </div>
      <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12 }}>
        This query also polls via <code>refetch: Schedule.spaced("3 seconds")</code>.
      </div>
    </div>
  )
}
