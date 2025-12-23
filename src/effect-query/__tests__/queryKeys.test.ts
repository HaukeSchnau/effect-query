import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { allInvalidationKey, exactKey, prefixKey } from "../queryKeys"
import { queryInvalidationKeys } from "../invalidation"

it.effect("queryInvalidationKeys includes exact, prefixes, and all", () =>
  Effect.sync(() => {
    const key = ["todos", 1] as const
    const keys = queryInvalidationKeys(key)
    expect(keys).toContain(allInvalidationKey)
    expect(keys).toContain(exactKey(key))
    expect(keys).toContain(prefixKey(["todos"]))
    expect(keys).toContain(prefixKey(["todos", 1]))
  })
)
