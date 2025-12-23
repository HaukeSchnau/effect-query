import * as Hash from "effect/Hash"
import type { QueryKey } from "./queryKeys"
import { allInvalidationKey, exactKey, prefixKey } from "./queryKeys"

export type Invalidation =
  | { readonly _tag: "All" }
  | { readonly _tag: "Exact"; readonly key: QueryKey }
  | { readonly _tag: "Prefix"; readonly prefix: QueryKey }
  | { readonly _tag: "Tag"; readonly tag: string }
  | { readonly _tag: "TagId"; readonly tag: string; readonly id: unknown }

export type QueryTag =
  | { readonly tag: string }
  | { readonly tag: string; readonly id: unknown }

const tagPrefix = "eq:tag:"

const stringOrHash = (u: unknown): string | number => (typeof u === "string" ? u : Hash.hash(u))

export const tagKey = (tag: string): string => `${tagPrefix}${tag}`

export const tagIdKey = (tag: string, id: unknown): string => `${tagPrefix}${tag}:${stringOrHash(id)}`

export const Invalidation = {
  all: (): Invalidation => ({ _tag: "All" }),
  exact: (key: QueryKey): Invalidation => ({ _tag: "Exact", key }),
  prefix: (prefix: QueryKey): Invalidation => ({ _tag: "Prefix", prefix }),
  tag: (tag: string): Invalidation => ({ _tag: "Tag", tag }),
  tagId: (tag: string, id: unknown): Invalidation => ({ _tag: "TagId", tag, id })
} as const

export const compileInvalidation = (inv: Invalidation): ReadonlyArray<string> => {
  switch (inv._tag) {
    case "All":
      return [allInvalidationKey]
    case "Exact":
      return [exactKey(inv.key)]
    case "Prefix":
      return [prefixKey(inv.prefix)]
    case "Tag":
      return [tagKey(inv.tag)]
    case "TagId":
      return [tagKey(inv.tag), tagIdKey(inv.tag, inv.id)]
  }
}

export const compileInvalidations = (inv: Invalidation | ReadonlyArray<Invalidation>): ReadonlyArray<string> => {
  if (Array.isArray(inv)) {
    const out: Array<string> = []
    for (const i of inv) out.push(...compileInvalidation(i))
    return out
  }
  return compileInvalidation(inv as Invalidation)
}

export const queryInvalidationKeys = (queryKey: QueryKey, tags?: ReadonlyArray<QueryTag>): ReadonlyArray<string> => {
  const keys: Array<string> = [allInvalidationKey, exactKey(queryKey)]
  for (let i = 1; i <= queryKey.length; i++) {
    keys.push(prefixKey(queryKey.slice(0, i)))
  }
  if (tags !== undefined) {
    for (const t of tags) {
      if ("id" in t) {
        keys.push(tagKey(t.tag), tagIdKey(t.tag, t.id))
      } else {
        keys.push(tagKey(t.tag))
      }
    }
  }
  return keys
}
