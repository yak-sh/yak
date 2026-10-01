// The public byte door. A bare SHA names the current artifact and redirects
// to an immutable representation; the representation fixes its MIME and name.
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
// The read is fenced by ./serve.ts.

import { type Authenticate, json, refuse, type Route, signed } from '@yaks/api'
import { type Graph, Stale, token } from '@yaks/graph'
import type { Driver } from '@yaks/sql'
import { addressOf, type Artifact, keep } from './artifact.ts'
import { type Backend, backend } from './backend.ts'
import { type Served, served, servedOpen } from './serve.ts'
import { contentType, mediaType } from './content_type.ts'
import {
  addressed,
  type Representation,
  representation,
  represents,
} from './representation.ts'
import type { Blobs } from './store.ts'

export { type Backend, backend } from './backend.ts'

/** The path prefix both endpoints are mounted under. */
export let PREFIX = '/blob/'

/** The largest upload accepted when the configuration sets no `limit`. */
export let LIMIT = 25 * 1024 * 1024

/** The options a configuration passes to this plugin. */
export type Options = {
  /** where a standalone door keeps objects; a composed host supplies its
   * configured artifact store for both writers and readers */
  store?: Backend
  /** the largest upload, in bytes (default {@link LIMIT}) */
  limit?: number
}

// An address is 64 lowercase hex characters; anything else never named an
// object, whichever way the request was pointing.
let address = (request: Request) =>
  addressed(new URL(request.url).pathname.slice(PREFIX.length))

let SCOPE = 'blob'

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
let mediaOf = (request: Request): string =>
  mediaType(request.headers.get('content-type') ?? '')

/** The two endpoints: `GET /blob/<sha256>` returns the bytes, and
 * `PUT /blob/<sha256>` stores them. */
export let routes = (
  host: { sql: Driver; graph: Graph; who?: Authenticate; artifacts?: Blobs },
  options: Options = {},
): Route[] => {
  let { store, waiting } = host.artifacts
    ? { store: host.artifacts }
    : backend(options.store ?? { via: 'sqlite' }, host)
  if (!store) {
    console.warn(`@yaks/blob: no door — ${waiting}`)
    return []
  }
  let limit = options.limit ?? LIMIT

  let big = () => no('Refused', `an object is at most ${limit} bytes here`, 413)

  let read: Route['handle'] = async (request) => {
    let at = address(request)
    if (!at) return missing()
    let { sha, eid } = at
    if (!eid) {
      let current = async () => {
        let [row] = await host.graph.read(`.entity.eid=${sha}`)
        let artifact = row?.artifact as Artifact | undefined
        let mime = artifact?.media_type ?? 'application/octet-stream'
        let rep = representation(SCOPE, sha, mime)
        let [saved] = await host.graph.read(`.entity.eid=${rep.eid}`)
        if (saved?.representation) return rep
        let bytes = await store.get(sha)
        if (!bytes) return null
        let fixed = await contentType(bytes, mime)
        rep = representation(SCOPE, sha, fixed)
        await host.graph.apply([
          {
            entity: { eid: rep.eid },
            representation: rep.row,
          },
          ...artifact && fixed != mime
            ? [{
              entity: { eid: sha },
              artifact: { media_type: fixed },
              $was: { artifact: { media_type: token(mime) } },
            }]
            : [],
        ], { trusted: true })
        return rep
      }
      let rep
      try {
        rep = await current()
      } catch (e) {
        if (!(e instanceof Stale)) throw e
        rep = await current()
      }
      if (!rep) return missing()
      let to = new URL(request.url)
      to.pathname += `/${rep.eid}`
      return new Response(null, {
        status: 302,
        headers: { location: to.href, 'cache-control': 'public, no-cache' },
      })
    }
    let [found] = await host.graph.read(`.entity.eid=${eid}`)
    let rep = found?.representation as Representation | undefined
    if (
      !rep || rep.scope != SCOPE || rep.address != sha ||
      !represents(eid, rep)
    ) return missing()
    let partial = request.method == 'HEAD' ||
      request.headers.has('range') || request.headers.has('if-none-match')
    let object = partial ? await store.open?.(sha) : null
    if (partial && store.open && !object) return missing()
    let bytes = object ? null : await store.get(sha)
    if (!object && !bytes) return missing()
    let meta: Served = {
      mime: rep.media_type,
      name: rep.name,
      etag: `"${eid}"`,
      cache: 'immutable',
    }
    return object
      ? servedOpen(object, meta, request)
      : served(bytes!, meta, request)
  }

  return [{ method: 'GET', path: `${PREFIX}*`, handle: read }, {
    method: 'HEAD',
    path: `${PREFIX}*`,
    handle: read,
  }, {
    method: 'PUT',
    path: `${PREFIX}*`,
    handle: async (request) => {
      try {
        let at = address(request)
        if (!at || at.eid) {
          return no('Refused', 'an address is 64 lowercase hex digits', 400)
        }
        let bytes = await bounded(request, limit)
        if (!bytes) return big()
        let got = await addressOf(bytes)
        if (got != at.sha) {
          return no('Refused', `these bytes address ${got}`, 400)
        }
        let artifact: Artifact = {
          address: at.sha,
          media_type: await contentType(bytes, mediaOf(request)),
          size: bytes.length,
        }
        let rep = representation(SCOPE, at.sha, artifact.media_type)
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
        let batch = () =>
          signed([{
            entity: { eid: at.sha },
            artifact,
          }, {
            entity: { eid: rep.eid },
            representation: rep.row,
          }], actor)
        await host.graph.apply(batch(), { check: true, trusted: true })
        await keep(store, at.sha, bytes)
        await host.graph.apply(batch(), { trusted: true })
        let response = json(artifact)
        response.headers.set('location', `${PREFIX}${rep.path}`)
        return response
      } catch (err) {
        return refuse(err, request)
      }
    },
  }]
}
