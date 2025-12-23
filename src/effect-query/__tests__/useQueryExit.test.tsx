import { render, screen } from "@testing-library/react"
import { Effect } from "effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"
import * as React from "react"

import { createEffectQuery } from "../createEffectQuery"

describe("EffectQuery.useQueryExit", () => {
  it("returns Exit for success and failure", async () => {
    const EffectQuery = createEffectQuery({ layer: Layer.empty })

    function SuccessDemo() {
      const query = EffectQuery.useQueryExit({
        queryKey: ["exit", "ok"],
        effect: Effect.succeed(123),
        staleTime: Infinity
      })
      const exit = Option.getOrElse(query.exit, () => Exit.die("missing"))
      return <div data-testid="ok">{Exit.isSuccess(exit) ? exit.value : "no"}</div>
    }

    function FailDemo() {
      const query = EffectQuery.useQueryExit({
        queryKey: ["exit", "fail"],
        effect: Effect.fail(new Error("nope")),
        staleTime: Infinity
      })
      const exit = Option.getOrElse(query.exit, () => Exit.die("missing"))
      return <div data-testid="fail">{Exit.isFailure(exit) ? "fail" : "no"}</div>
    }

    render(
      <EffectQuery.Provider>
        <SuccessDemo />
        <FailDemo />
      </EffectQuery.Provider>
    )

    expect(screen.getByTestId("ok")).toHaveTextContent("123")
    expect(screen.getByTestId("fail")).toHaveTextContent("fail")
  })
})

