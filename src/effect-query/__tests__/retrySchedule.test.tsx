import { act, render, screen } from "@testing-library/react"
import { Effect } from "effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import { describe, expect, it } from "vitest"
import * as React from "react"

import { createEffectQuery } from "../createEffectQuery"

describe("EffectQuery retry schedule", () => {
  it("retries according to the provided Schedule", async () => {
    const EffectQuery = createEffectQuery({ layer: Layer.empty })
    let attempts = 0

    const effect = Effect.suspend(() => {
      attempts++
      return attempts < 3 ? Effect.fail(new Error("nope")) : Effect.succeed(42)
    })

    function Demo() {
      const query = EffectQuery.useQuery({
        queryKey: ["retry", 1],
        effect,
        retry: Schedule.recurs(2),
        staleTime: Infinity
      })
      return <div data-testid="value">{query.status === "success" ? "ok" : "no"}</div>
    }

    render(
      <EffectQuery.Provider>
        <Demo />
      </EffectQuery.Provider>
    )

    await act(async () => {})
    expect(screen.getByTestId("value")).toHaveTextContent("ok")
    expect(attempts).toBe(3)
  })
})
