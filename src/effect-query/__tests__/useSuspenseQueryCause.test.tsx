import { act, render, screen } from "@testing-library/react"
import { Effect } from "effect"
import * as Cause from "effect/Cause"
import * as Layer from "effect/Layer"
import { describe, expect, it, vi } from "vitest"
import * as React from "react"

import { createEffectQuery } from "../createEffectQuery"

describe("EffectQuery.useSuspenseQueryCause", () => {
  it("does not throw on failure and returns Cause", async () => {
    vi.useFakeTimers()

    const EffectQuery = createEffectQuery({ layer: Layer.empty })
    const effect = Effect.promise<number>(() =>
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("boom")), 50)
      })
    )

    function Demo() {
      const query = EffectQuery.useSuspenseQueryCause({
        queryKey: ["suspense-cause", 1],
        effect,
        staleTime: Infinity
      })
      if (query._tag === "Failure") {
        return <div data-testid="err">{Cause.pretty(query.cause)}</div>
      }
      return <div data-testid="ok">{query.data}</div>
    }

    render(
      <EffectQuery.Provider>
        <React.Suspense fallback={<div>loading</div>}>
          <Demo />
        </React.Suspense>
      </EffectQuery.Provider>
    )

    expect(screen.getByText("loading")).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(60))

    expect(screen.getByTestId("err")).toHaveTextContent("boom")
    expect(screen.queryByText("loading")).not.toBeInTheDocument()

    vi.useRealTimers()
  })
})

