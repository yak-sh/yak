// The two HTTP endpoints: a stored object at an address anyone can get, and the
// PUT that puts one there. This is the module a server imports from
// `@yaks/blob/routes`. One path, `/blob/<sha256>`, both ways.
//
// The address is the name, which is what makes an upload a PUT: the caller
// states what the bytes are and the server only has to agree. So the same file sent
// twice — or by two people, or by one client retrying — is one stored object
// and one row, and bytes that do not hash to the address they were sent to are
// refused. Nothing else about them is inspected; whoever knows the hash has the
// bytes, and to know it you had them already.
//
// Who may upload is the graph's question, never a second one these endpoints
// ask. A PUT first runs its `artifact` row against the graph as a check, so
// whatever refuses that write refuses the upload, and a server with an upload
// policy writes it as a rule like any other. The two things left over are the
// ones only the server can know, and they are its options: where the bytes live
// (`store`) and how large one may be (`limit`).
//
// The GET is a prefix route because the address is the rest of the path: a
// content-addressed read takes no query string, no range and no identity. The
// row the PUT created supplies the one thing the bytes cannot state about
// themselves — what they are — and the response is fenced either way
// (./serve.ts).

import { type Authenticate, json, refuse, type Route, signed } from '@yaks/api'
import type { Graph } from '@yaks/graph'
import type { Driver } from '@yaks/sqlite'
import { addressOf, type Artifact, keep } from './artifact.ts'
import { fileBlobs } from './file.ts'
import { type Bucket, objectBlobs } from './object.ts'
import { served } from './serve.ts'
import { sqliteBlobs } from './sqlite.ts'
import type { Blobs } from './store.ts'

/** The path prefix both endpoints are mounted under. */
export let PREFIX = '/blob/'

/** The largest upload accepted when the configuration sets no `limit`. */
export let LIMIT = 25 * 1024 * 1024

/** The options a configuration passes to this plugin. */
export type Options = {
  /** where the objects these endpoints serve and accept live; name none and
   * they live in the server's own table, beside the text `./rules` keeps
   * there */
  store?: Backend
  /** the largest upload, in bytes (default {@link LIMIT}) */
  limit?: number
}

/** A byte store, as a configuration names one — the same three ./store.ts
 * describes. */
export type Backend =
  | {
    /** the server's own SQLite table — the default, and text: it is the table
     * SQL reads a body property through (./sqlite.ts), so a server accepting
     * binary uploads names one of the others */
    via: 'sqlite'
  }
  | {
    /** a directory, one file per address */
    via: 'file'
    /** where that directory is */
    dir: string
  }
  | {
    /** an S3-shaped bucket, R2 included */
    via: 'object'
    /** the binding object itself, so this store is configured by a server
     * composing in code rather than from a JSON file */
    bucket: Bucket
    /** what to namespace the keys with */
    prefix?: string
  }

/** The named store, built — or the message explaining why there is none. A
 * server that believes it is keeping uploads somewhere and is not is worse than
 * one that does not start, so the reason is reported rather than swallowed; it
 * is reported rather than thrown, because missing configuration never stops a
 * server coming up. With nowhere to put bytes, the endpoints are not mounted at
 * all, so an upload is refused where it is attempted instead of being written
 * into nothing. */
export let backend = (
  said: Backend,
  host: { sql: Driver },
): { store?: Blobs; waiting?: string } => {
  if (said.via == 'sqlite') return { store: sqliteBlobs(host.sql) }
  if (said.via == 'file') {
    return said.dir
      ? { store: fileBlobs(said.dir) }
      : { waiting: 'a file store needs `dir`' }
  }
  if (said.via == 'object') {
    return said.bucket
      ? { store: objectBlobs(said.bucket, said.prefix) }
      : { waiting: 'an object store needs `bucket`' }
  }
  return {
    waiting: `no store called ${JSON.stringify((said as Backend).via)}`,
  }
}

// An address is 64 lowercase hex characters; anything else never named an
// object, whichever way the request was pointing.
let addressed = (request: Request): string | null => {
  let sha = new URL(request.url).pathname.slice(PREFIX.length)
  return /^[0-9a-f]{64}$/.test(sha) ? sha : null
}

// A refusal in the JSON shape every other endpoint here uses (@yaks/api).
let no = (error: string, message: string, code: number): Response =>
  json({ error, message }, code)

let missing = () => no('NotFound', 'no object at that address', 404)

// The request body, counted as it arrives: `null` where it ran past the limit.
// A caller that declares no length must not be able to make the server hold an
// unbounded body, so the limit is enforced on the bytes themselves and never on
// what a `content-length` header claimed — and the remainder is read and
// discarded rather than cut off, so the refusal reaches the caller instead of a
// reset connection.
let bounded = async (
  request: Request,
  limit: number,
): Promise<Uint8Array | null> => {
  let reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  let parts: Uint8Array[] = [], size = 0, over = false
  while (true) {
    let { done, value } = await reader.read()
    if (done || !value) break
    size += value.length
    if (over) continue
    if (size > limit) (over = true), (parts = [])
    else parts.push(value)
  }
  if (over) return null
  let bytes = new Uint8Array(size), at = 0
  for (let part of parts) bytes.set(part, at), at += part.length
  return bytes
}

// What the caller declares these bytes are, as a media type and nothing else.
// The parameters are dropped and the shape is validated because this string is
// written into a response header every time the object is read back.
let mediaOf = (request: Request): string => {
  let said = (request.headers.get('content-type') ?? '').split(';')[0].trim()
    .toLowerCase()
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(said)
    ? said
    : 'application/octet-stream'
}

/** The two endpoints: `GET /blob/<sha256>` returns the bytes, and
 * `PUT /blob/<sha256>` stores them. */
export let routes = (
  host: { sql: Driver; graph: Graph; who?: Authenticate },
  options: Options = {},
): Route[] => {
  let { store, waiting } = backend(options.store ?? { via: 'sqlite' }, host)
  if (!store) {
    console.warn(`@yaks/blob: no door — ${waiting}`)
    return []
  }
  let limit = options.limit ?? LIMIT

  // What the row records this object as. The bytes stand on their own and are
  // served without it, so a store holding an object no row names still serves
  // it — as the octet-stream it is to anyone but its owner.
  let mimeOf = async (sha: string) => {
    let [found] = await host.graph.read(`.eid=${sha}`)
    return (found?.artifact as Artifact | undefined)?.media_type
  }

  let big = () => no('Refused', `an object is at most ${limit} bytes here`, 413)

  return [{
    method: 'GET',
    path: `${PREFIX}*`,
    handle: async (request) => {
      let sha = addressed(request)
      if (!sha) return missing()
      let bytes = await store.get(sha)
      return bytes ? served(bytes, { mime: await mimeOf(sha) }) : missing()
    },
  }, {
    method: 'PUT',
    path: `${PREFIX}*`,
    handle: async (request) => {
      try {
        let sha = addressed(request)
        if (!sha) {
          return no('Refused', 'an address is 64 lowercase hex digits', 400)
        }
        let bytes = await bounded(request, limit)
        if (!bytes) return big()
        let got = await addressOf(bytes)
        if (got != sha) {
          return no('Refused', `these bytes address ${got}`, 400)
        }
        let artifact: Artifact = {
          address: sha,
          media_type: mediaOf(request),
          size: bytes.length,
        }
        // Check, store, write — signed as whoever `host.who` reports is
        // calling, so an upload is attributed the way a write through `/apply`
        // beside it is. The first apply runs with `check`, which validates the
        // write without committing it, so the policy that governs a write
        // decides the upload before anything is kept; and the bytes are in
        // place before the row that names them, so nothing ever points at an
        // object the store does not hold. A PUT that died in between left an
        // object no row names, which is what a content-addressed store has
        // instead of a mess, and repeating the PUT is the repair.
        let actor = await host.who?.(request) ?? null
        // Fresh rows each time: `apply` reads and writes the bundles it is
        // given, so the check's must not be the write's.
        let batch = () => signed([{ entity: { eid: sha }, artifact }], actor)
        await host.graph.apply(batch(), { check: true })
        await keep(store, sha, bytes)
        await host.graph.apply(batch())
        return json(artifact)
      } catch (err) {
        return refuse(err, request)
      }
    },
  }]
}
