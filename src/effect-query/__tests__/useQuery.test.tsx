import { act, fireEvent, render, screen } from "@testing-library/react"
import { Effect } from "effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { describe, expect, it, vi } from "vitest"
import * as React from "react"

import { createEffectQuery } from "../createEffectQuery"

describe("EffectQuery.useQuery", () => {
  it("dedupes the same queryKey across observers", async () => {
    vi.useFakeTimers()

    let calls = 0
    const EffectQuery = createEffectQuery({ layer: Layer.empty })

    const effect = Effect.promise<number>(() =>
      new Promise((resolve) => {
        calls++
        setTimeout(() => resolve(123), 50)
      })
    )

    function Observer(props: { readonly label: string }) {
      const query = EffectQuery.useQuery({
        queryKey: ["dedupe", 1],
        effect,
        staleTime: "1 hour"
      })
      return (
        <div>
          <div>{props.label}</div>
          <div data-testid={`value-${props.label}`}>{Option.getOrElse(query.data, () => -1)}</div>
        </div>
      )
    }

    render(
      <EffectQuery.Provider>
        <Observer label="a" />
        <Observer label="b" />
      </EffectQuery.Provider>
    )

    expect(calls).toBe(1)
    await act(() => vi.advanceTimersByTimeAsync(60))
    expect(screen.getByTestId("value-a")).toHaveTextContent("123")
    expect(screen.getByTestId("value-b")).toHaveTextContent("123")

    vi.useRealTimers()
  })

  it("invalidates by prefix and refetches with previous data", async () => {
    vi.useFakeTimers()

    let n = 0
    const EffectQuery = createEffectQuery({ layer: Layer.empty })

    const effect = Effect.promise<number>(() =>
      new Promise((resolve) => {
        setTimeout(() => resolve(++n), 50)
      })
    )

    function Demo() {
      const query = EffectQuery.useQuery({
        queryKey: ["todos", 1],
        effect,
        staleTime: "1 hour"
      })
      const client = EffectQuery.useQueryClient()

      return (
        <div>
          <div data-testid="value">{Option.getOrElse(query.data, () => 0)}</div>
          <div data-testid="fetching">{String(query.isFetching)}</div>
          <button onClick={() => client.invalidateQueries(["todos"])}>invalidate</button>
        </div>
      )
    }

    render(
      <EffectQuery.Provider>
        <Demo />
      </EffectQuery.Provider>
    )

    await act(() => vi.advanceTimersByTimeAsync(60))
    expect(screen.getByTestId("value")).toHaveTextContent("1")
    expect(screen.getByTestId("fetching")).toHaveTextContent("false")

    fireEvent.click(screen.getByRole("button", { name: "invalidate" }))
    expect(screen.getByTestId("value")).toHaveTextContent("1")
    expect(screen.getByTestId("fetching")).toHaveTextContent("true")

    await act(() => vi.advanceTimersByTimeAsync(60))
    expect(screen.getByTestId("value")).toHaveTextContent("2")
    expect(screen.getByTestId("fetching")).toHaveTextContent("false")

    vi.useRealTimers()
  })
})
