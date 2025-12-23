import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { compileInvalidations, Invalidation, tagIdKey, tagKey } from "../invalidation"

it.effect("compiles tag invalidations to namespaced keys", () =>
  Effect.sync(() => {
    const keys = compileInvalidations(Invalidation.tagId("todos", 123))
    expect(keys).toContain(tagKey("todos"))
    expect(keys).toContain(tagIdKey("todos", 123))
  })
)

