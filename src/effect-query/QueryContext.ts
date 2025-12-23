import * as Context from "effect/Context"
import type { QueryKey } from "./queryKeys"

export class QueryContext extends Context.Tag("effect-query/QueryContext")<
  QueryContext,
  { readonly queryKey: QueryKey }
>() {}

