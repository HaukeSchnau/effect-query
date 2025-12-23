import * as Registry from "@effect-atom/atom/Registry"
import { Effect } from "effect"
import * as Layer from "effect/Layer"
import { describe, expect, it } from "vitest"

import { createEffectQuery } from "../createEffectQuery"

describe("Scoped queries", () => {
  it("scopedEffect runs finalizers when atom is unmounted", async () => {
    const EffectQuery = createEffectQuery({ layer: Layer.empty })
    let opened = 0
    let closed = 0

    const scopedEffect = Effect.acquireRelease(
      Effect.sync(() => {
        opened++
        return "resource"
      }),
      () =>
        Effect.sync(() => {
          closed++
        })
    ).pipe(Effect.as("ok"))

    const atom = EffectQuery.queryAtom({
      queryKey: ["scoped", 1],
      scopedEffect,
      scoped: true,
      gcTime: "0 millis",
      staleTime: Infinity
    })

    const registry = Registry.make({ scheduleTask: (f) => f(), timeoutResolution: 1, defaultIdleTTL: 0 })

    // Evaluate
    const result = registry.get(atom)
    if (result._tag !== "Success" || result.value !== "ok") {
      throw new Error("expected success")
    }
    if (opened !== 1) {
      throw new Error("expected resource to open once")
    }

    // Mount + unmount should trigger node removal and lifetime disposal.
    const unmount = registry.mount(atom)
    unmount()

    const deadline = Date.now() + 250
    while (closed !== 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5))
    }

    expect(opened).toBe(1)
    expect(closed).toBe(1)
  })
})
