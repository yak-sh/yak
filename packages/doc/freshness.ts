// Document freshness at the read/write boundary. The graph owns the token
// and atomic precondition check; every document uses the same bundle guard.

import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { BODY, DOC } from './comp.ts'

/** Carry the token for the body this answer shows. A projected title alone
 * says nothing about the body and must not claim it was absent. */
export let witnessed = (b: Bundle): Bundle => {
  let doc = b[DOC] as Comp | undefined
  if (!doc || !Object.hasOwn(doc, BODY)) return b
  return {
    ...b,
    $was: {
      ...b.$was,
      [DOC]: { ...b.$was?.[DOC], [BODY]: token(doc[BODY]) },
    },
  }
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
