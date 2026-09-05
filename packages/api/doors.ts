// The two HTTP doors. Both are thin on purpose: read the request, hand the
// graph a query or a batch, answer with JSON. Everything that decides anything
// — what a caller may write, whether a precondition still holds, who gets told
// — lives in @yaks/graph or in the registry, not here.

import { type Graph, Refused } from '@yaks/graph'
import type { Entity } from '@yaks/graph'
import { signed } from './actor.ts'
import { json } from './refuse.ts'

/**
 * `POST /apply` — a batch of bundles in, the batch as applied out. The body is
 * a JSON array (a `Change`); the response is the array `apply()` returned,
 * casualties and stamps included.
 */
export let write = async (
  graph: Graph,
  request: Request,
  who: Entity | null,
): Promise<Response> => {
  let body = await request.json()
  if (!Array.isArray(body)) {
    throw new Refused('/apply takes a JSON array of bundles')
  }
  return json(await graph.apply(signed(body, who)))
}

// The query line a request names: `?q=` on a GET, and on a POST either a bare
// JSON string or `{ q }`.
let lineOf = (body: unknown): string | null => {
  if (typeof body == 'string') return body
  if (body && typeof body == 'object' && 'q' in body) {
    return typeof body.q == 'string' ? body.q : null
  }
  return null
}

/**
 * `GET /query?q=…` or `POST /query` — a query line in, the bundles it selects
 * out.
 */
export let ask = async (graph: Graph, request: Request): Promise<Response> => {
  let q = request.method == 'GET'
    ? new URL(request.url).searchParams.get('q')
    : lineOf(await request.json())
  if (q == null) throw new Refused('/query needs a query: ?q=… or a body {q}')
  return json(await graph.read(q))
}
