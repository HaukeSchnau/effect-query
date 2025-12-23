import { act, fireEvent, render, screen } from "@testing-library/react"
import { useAtomSet, useAtomValue } from "@effect-atom/atom-react"
import * as Atom from "@effect-atom/atom/Atom"
import { Effect } from "effect"
import * as Layer from "effect/Layer"
import { describe, expect, it, vi } from "vitest"
import * as React from "react"

import { createEffectQuery } from "../createEffectQuery"

describe("Atom-first surface", () => {
  it("queryAtom is stable per queryKey", () => {
    const EffectQuery = createEffectQuery({ layer: Layer.empty })
    const a1 = EffectQuery.queryAtom({
      queryKey: ["stable", 1],
      effect: Effect.succeed(1),
      staleTime: Infinity
    })
    const a2 = EffectQuery.queryAtom({
      queryKey: ["stable", 1],
      effect: Effect.succeed(999),
      staleTime: Infinity
    })
    const b = EffectQuery.queryAtom({
      queryKey: ["stable", 2],
      effect: Effect.succeed(1),
      staleTime: Infinity
    })
    expect(a1).toBe(a2)
    expect(a1).not.toBe(b)
  })

  it("mutationAtom can invalidate queries (without hooks API)", async () => {
    vi.useFakeTimers()

    const EffectQuery = createEffectQuery({ layer: Layer.empty })
    let n = 0

    const queryAtom = EffectQuery.queryAtom({
      queryKey: ["todos", 1],
      effect: Effect.promise<number>(() => new Promise((resolve) => setTimeout(() => resolve(++n), 10))),
      staleTime: Infinity,
      tags: [{ tag: "todos" }]
    })

    const derivedAtom = Atom.map(queryAtom, (result) =>
      result._tag === "Success" ? result.value : -1
    )

    const mutationAtom = EffectQuery.mutationAtom({
      mutationKey: ["bump"],
      mutationFn: () => Effect.promise<void>(() => new Promise((resolve) => setTimeout(resolve, 1))),
      invalidate: { _tag: "Tag", tag: "todos" }
    })

    function Demo() {
      const value = useAtomValue(derivedAtom)
      const mutate = useAtomSet(mutationAtom, { mode: "promiseExit" })
      return (
        <div>
          <div data-testid="value">{value}</div>
          <button
            onClick={async () => {
              await mutate(void 0)
            }}
          >
            mutate
          </button>
        </div>
      )
    }

    render(
      <EffectQuery.Provider>
        <Demo />
      </EffectQuery.Provider>
    )

    await act(() => vi.advanceTimersByTimeAsync(20))
    expect(screen.getByTestId("value")).toHaveTextContent("1")

    fireEvent.click(screen.getByRole("button", { name: "mutate" }))
    await act(() => vi.advanceTimersByTimeAsync(50))
    expect(screen.getByTestId("value")).toHaveTextContent("2")

    vi.useRealTimers()
  })
})
