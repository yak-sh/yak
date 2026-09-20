// A stored object as an address anyone can GET, and the door that puts one
// there: the `routes` facet a host takes (`@yaks/blob/routes`). One path,
// `/blob/<sha256>`, both ways.
//
// The address is the NAME, which is what makes an upload a PUT: the caller
// says what the bytes are and the server has only to agree. So the same file
// sent twice — or by two people, or by one retrying — is one stored object and
// one row, and bytes that do not hash to the address they were sent to are
// refused. Nothing else about them is inspected; whoever knows the hash has
// the bytes, and to know it you had them already.
//
// Who may upload is the GRAPH's question, never a second one this door asks.
// A PUT rehearses its `artifact` row against the graph first, so whatever
// refuses that write refuses the upload, and a host with an upload policy
// writes it as a rule like any other. The two things left over are the ones
// only a host can know, and they are its options: where the bytes live
// (`store`) and how large one may be (`limit`).
//
// The read is a prefix route because the address is the rest of it: a
// content-addressed read has no query, no range and no identity. The row the
// PUT minted supplies the one thing the bytes cannot say about themselves —
// what they are — and the answer is fenced either way (./serve.ts).

import { json, refuse, type Route } from '@yaks/api'
import type { Graph } from '@yaks/graph'
import type { Driver } from '@yaks/sqlite'
import { addressOf, type Artifact, keep } from './artifact.ts'
import { fileBlobs } from './file.ts'
import { type Bucket, objectBlobs } from './object.ts'
import { served } from './serve.ts'
import { sqliteBlobs } from './sqlite.ts'
import type { Blobs } from './store.ts'

/** Where a stored object answers from. */
export let PREFIX = '/blob/'

/** The largest upload this door takes where a config names no `limit`. */
export let LIMIT = 25 * 1024 * 1024

/** What a config says to this plugin. */
export type Options = {
  /** where the objects this door serves and takes LIVE; name none and they
   * live in the host's own table, beside the text `./rules` keeps there */
  store?: Kept
  /** the largest upload, in bytes (default {@link LIMIT}) */
  limit?: number
}

/** A store, as a config names one. */
export type Kept =
  | {
    /** the host's own SQLite table — the default, and TEXT: it is the table
     * SQL reads a body column through (./sqlite.ts), so a host taking binary
     * uploads names one of the others */
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
    /** the binding itself, so this store is named by a host composing in
     * code rather than by a JSON config */
    bucket: Bucket
    /** what to namespace the keys with */
    prefix?: string
  }

/** A named store, built. An unknown `via` is a refusal: a host that thinks it
 * is keeping uploads somewhere and is not is worse than one that will not
 * boot. */
export let kept = (said: Kept, host: { sql: Driver }): Blobs => {
  if (said.via == 'sqlite') return sqliteBlobs(host.sql)
  if (said.via == 'file') {
    if (!said.dir) throw new Error('@yaks/blob: a file store needs `dir`')
    return fileBlobs(said.dir)
  }
  if (said.via == 'object') {
    if (!said.bucket) {
      throw new Error('@yaks/blob: an object store needs `bucket`')
    }
    return objectBlobs(said.bucket, said.prefix)
  }
  throw new Error(
    `@yaks/blob: no store called ${JSON.stringify((said as Kept).via)}`,
  )
}

// An address is 64 lowercase hex characters; anything else never named an
// object, whichever way the request was pointing.
let addressed = (request: Request): string | null => {
  let sha = new URL(request.url).pathname.slice(PREFIX.length)
  return /^[0-9a-f]{64}$/.test(sha) ? sha : null
}

// A refusal in the shape every other door here answers with (@yaks/api).
let no = (error: string, message: string, code: number): Response =>
  json({ error, message }, code)

let missing = () => no('NotFound', 'no object at that address', 404)

// What the caller says these bytes are, as a media type and nothing else. The
// parameters are dropped and the shape is checked because this string is
// written into a response header every time the object is read back.
let mediaOf = (request: Request): string => {
  let said = (request.headers.get('content-type') ?? '').split(';')[0].trim()
    .toLowerCase()
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(said)
    ? said
    : 'application/octet-stream'
}

/** `GET /blob/<sha256>` — the bytes; `PUT /blob/<sha256>` — the bytes in. */
export let routes = (
  host: { sql: Driver; graph: Graph },
  options: Options = {},
): Route[] => {
  let store = kept(options.store ?? { via: 'sqlite' }, host)
  let limit = options.limit ?? LIMIT

  // What the row says this object is. The bytes are the truth about
  // themselves and answer without it, so a store holding an object no row
  // names still serves it — as the octet-stream it is to anyone but its owner.
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
        // The length the caller declared, before reading it, and then the
        // length that arrived — a body may say nothing about its size.
        if (Number(request.headers.get('content-length')) > limit) return big()
        let bytes = new Uint8Array(await request.arrayBuffer())
        if (bytes.length > limit) return big()
        let got = await addressOf(bytes)
        if (got != sha) {
          return no('Refused', `these bytes address ${got}`, 400)
        }
        let artifact: Artifact = {
          address: sha,
          media_type: mediaOf(request),
          size: bytes.length,
        }
        // Ask, store, write. The ask is a rehearsal (`check`), so the policy
        // that governs a write decides the upload BEFORE anything is kept,
        // and the bytes are still in place before the row that names them —
        // nothing ever points at an object the store does not hold. A PUT
        // that died in the middle left an unnamed object, which is what a
        // content-addressed store has instead of a mess, and repeating the
        // PUT is the repair.
        await host.graph.apply([{ entity: { eid: sha }, artifact }], {
          check: true,
        })
        await keep(store, sha, bytes)
        await host.graph.apply([{ entity: { eid: sha }, artifact }])
        return json(artifact)
      } catch (err) {
        return refuse(err, request)
      }
    },
  }]
}
