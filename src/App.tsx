import { Result } from "@effect-atom/atom-react"
import { Effect, Ref } from "effect"
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import { createEffectQuery } from "./effect-query"
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

    return { get, increment } as const
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
      </div>
    </EffectQuery.Provider>
  )
}

function CounterCard() {
  const client = EffectQuery.useQueryClient()

  const query = EffectQuery.useQuery({
    queryKey: ["counter", "value"],
    queryFn: () =>
      Effect.gen(function*() {
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
        return yield* api.increment
      }),
      invalidate: ["counter"]
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
    queryFn: () =>
      Effect.gen(function*() {
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
