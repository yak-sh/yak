// A stored object as an address anyone can GET: the `routes` facet a host
// takes (`@yaks/blob/routes`). One path, `/blob/<sha256>`, answered out of the
// same SQLite store ./rules.ts writes to — the bytes cannot change under their
// address, so the answer caches forever and is fenced (./serve.ts).
//
// The path is a prefix route because the address is the rest of it. Nothing
// else about the request matters: a content-addressed read has no query, no
// range and no identity — whoever knows the hash has the bytes.

import type { Route } from '@yaks/api'
import type { Driver } from '@yaks/sqlite'
import { served } from './serve.ts'
import { sqliteBlobs } from './sqlite.ts'

/** Where a stored object answers from. */
export let PREFIX = '/blob/'

/** `GET /blob/<sha256>` — the bytes, or 404. */
export let routes = (host: { sql: Driver }): Route[] => {
  let store = sqliteBlobs(host.sql)
  return [{
    method: 'GET',
    path: `${PREFIX}*`,
    handle: async (request) => {
      let sha = new URL(request.url).pathname.slice(PREFIX.length)
      // An address is 64 lowercase hex characters; anything else never named
      // an object, so it is a miss rather than a lookup.
      if (!/^[0-9a-f]{64}$/.test(sha)) {
        return new Response('not found', { status: 404 })
      }
      let bytes = await store.get(sha)
      return bytes ? served(bytes) : new Response('not found', { status: 404 })
    },
  }]
}
