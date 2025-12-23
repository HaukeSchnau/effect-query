import { act, render, screen } from "@testing-library/react"
import { Effect } from "effect"
import * as Layer from "effect/Layer"
import { describe, expect, it, vi } from "vitest"
import * as React from "react"

import { createEffectQuery } from "../createEffectQuery"

describe("EffectQuery.useSuspenseQuery", () => {
  it("suspends during initial load and then renders data", async () => {
    vi.useFakeTimers()

    const EffectQuery = createEffectQuery({ layer: Layer.empty })
    const effect = Effect.promise<number>(() =>
      new Promise((resolve) => {
        setTimeout(() => resolve(123), 50)
      })
    )

    function Demo() {
      const query = EffectQuery.useSuspenseQuery({
        queryKey: ["suspense", 1],
        effect,
        staleTime: "1 hour"
      })
      return <div data-testid="value">{query.data}</div>
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
    expect(screen.getByTestId("value")).toHaveTextContent("123")

    vi.useRealTimers()
  })
})
