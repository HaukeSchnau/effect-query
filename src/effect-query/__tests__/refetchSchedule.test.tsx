import { act, render } from "@testing-library/react"
import { Effect } from "effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import { describe, expect, it, vi } from "vitest"
import * as React from "react"

import { createEffectQuery } from "../createEffectQuery"

describe("EffectQuery refetch schedule", () => {
  it("refetches according to the provided Schedule", async () => {
    vi.useFakeTimers()

    const EffectQuery = createEffectQuery({ layer: Layer.empty })
    let calls = 0

    const effect = Effect.promise<number>(() =>
      new Promise((resolve) => {
        calls++
        setTimeout(() => resolve(calls), 10)
      })
    )

    const refetch = Schedule.spaced("50 millis").pipe(Schedule.intersect(Schedule.recurs(2)))

    function Demo() {
      EffectQuery.useQuery({
        queryKey: ["poll", 1],
        effect,
        staleTime: Infinity,
        refetch
      })
      return null
    }

    render(
      <EffectQuery.Provider>
        <Demo />
      </EffectQuery.Provider>
    )

    await act(() => vi.advanceTimersByTimeAsync(15))
    expect(calls).toBe(1)

    await act(() => vi.advanceTimersByTimeAsync(250))
    expect(calls).toBe(3)

    vi.useRealTimers()
  })
})

