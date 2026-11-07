// Document freshness at the read/write boundary. The graph owns the token
// and atomic precondition check; every document uses the same bundle guard.

import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { BODY, DOC } from './comp.ts'

/** Carry the token for the body this answer shows. A projected title alone
 * says nothing about the body and must not claim it was absent.
 *
 * The token is hashed the first time it is read, by a caller or by whatever
 * serializes the answer. A body can be megabytes, and most reads never guard
 * a write with it: a search hashed 27 MB of bodies to name twenty hits. */
export let witnessed = (b: Bundle): Bundle => {
  let doc = b[DOC] as Comp | undefined
  if (!doc || !Object.hasOwn(doc, BODY)) return b
  let body = doc[BODY], made: { token: string | null } | undefined
  let was = Object.defineProperty({ ...b.$was?.[DOC] }, BODY, {
    get: () => (made ??= { token: token(body) }).token,
    enumerable: true,
    configurable: true,
  })
  return { ...b, $was: { ...b.$was, [DOC]: was } }
}

/** Guard a body replacement when its caller supplies a read token. Omission
 * keeps a blind write; null explicitly guards an absent body. */
export let guarded = (b: Bundle, was: string | null | undefined): Bundle => {
  let doc = b[DOC] as Comp | undefined
  if (was === undefined || !doc || !Object.hasOwn(doc, BODY)) return b
  return {
    ...b,
    $was: { ...b.$was, [DOC]: { ...b.$was?.[DOC], [BODY]: was } },
  }
}
