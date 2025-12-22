import * as Hash from "effect/Hash"

export type QueryKey = ReadonlyArray<unknown>

export type InvalidationKey = string

const exactPrefix = "eq:k:"
const prefixPrefix = "eq:p:"
const allKey = "eq:all"

export const hashQueryKey = (key: QueryKey): string => `${Hash.array(key)}`

export const exactKey = (key: QueryKey): InvalidationKey => `${exactPrefix}${hashQueryKey(key)}`

export const prefixKey = (prefix: QueryKey): InvalidationKey => `${prefixPrefix}${hashQueryKey(prefix)}`

export const allInvalidationKey: InvalidationKey = allKey

export const queryInvalidationKeys = (key: QueryKey): ReadonlyArray<InvalidationKey> => {
  const keys: Array<InvalidationKey> = [allInvalidationKey, exactKey(key)]
  for (let i = 1; i <= key.length; i++) {
    keys.push(prefixKey(key.slice(0, i)))
  }
  return keys
}
