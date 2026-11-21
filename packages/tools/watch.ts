// A reading tool whose answer is a store query's rows declares that query as
// `watch` (@yaks/vocab `ToolDefinition`), and a subscription to the tool
// watches the query live (@yaks/wake `watch`) instead of calling the tool
// again on a clock. The declaration is data, one per tool: the query's parts,
// each with `%{name}` holes the call's arguments fill, joined with `&`.
//
// A part whose hole names an argument left out is dropped. A part given as a
// list is its alternatives, the first whose holes all fill, so a default is a
// last alternative with no hole. A hole filled by a list of strings is one copy
// of its part per string, as graph_query's `filters` each narrow the query.

import { conjoin } from '@yaks/query'

/** A reading tool's query, as its declaration writes it. */
export type Watch = readonly (string | readonly string[])[]

let HOLE = /%\{(\w+)\}/g

// Each copy of `part` the arguments fill, or none when a hole is unfilled.
let fills = (part: string, args: Record<string, unknown>): string[] => {
  let names = [...part.matchAll(HOLE)].map((m) => m[1])
  let listed = names.find((n) => Array.isArray(args[n]))
  if (listed) {
    return (args[listed] as unknown[]).flatMap((v) =>
      fills(part, { ...args, [listed]: v })
    )
  }
  let said = (v: unknown) =>
    typeof v == 'string' || typeof v == 'number' ? String(v).trim() : ''
  if (names.some((n) => !said(args[n]))) return []
  return [part.replace(HOLE, (_, n: string) => said(args[n]))]
}

/**
 * The query a tool that declares `watch` answers for `args`, or a sentence
 * saying which argument it does not watch: one no part names would change the
 * answer in a way the query cannot follow.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { watched } from './watch.ts'
 *
 * let tasks = ['.task', ['%{query}', '.task.status=open'], '.limit=%{limit}']
 * assertEquals(watched(tasks, {}), { query: '.task&.task.status=open' })
 * assertEquals(watched(tasks, { query: '.task.status=done', limit: 5 }), {
 *   query: '.task&.task.status=done&.limit=5',
 * })
 * assertEquals(watched(['%{q}', '%{filters}'], { q: '.a', filters: ['.b', '.c'] }), {
 *   query: '.a&.b&.c',
 * })
 * assertEquals(watched(['%{q}'], { q: '.a', branch: 2 }), {
 *   refused: 'branch',
 * })
 * ```
 */
export let watched = (
  watch: Watch,
  args: Record<string, unknown>,
): { query: string } | { refused: string } => {
  let named = new Set(
    watch.flat().flatMap((p) => [...p.matchAll(HOLE)].map((m) => m[1])),
  )
  let refused = Object.keys(args).find((k) => args[k] != null && !named.has(k))
  if (refused) return { refused }
  return {
    query: conjoin(
      ...watch.flatMap((part) =>
        typeof part == 'string'
          ? fills(part, args)
          : part.map((p) => fills(p, args)).find((f) => f.length) ?? []
      ),
    ),
  }
}
