// The public byte door. A bare SHA names the bytes as their rows say them
// now and redirects to an immutable representation; the representation fixes
// its MIME and name.
//
//   POST <at>                      the bytes, their type as `content-type` and
//                                  their name percent-encoded as `x-yak-name`
//   PUT  <at><sha>                 the same, sent to the address they hash to
//   POST <at><sha> {bytes, name, mime}
//                                  an upload in parts: where it stands,
//                                  `{part, need}`, and once nothing is
//                                  missing it is finished
//   PUT  <at><sha>/<n>             part n, `x-yak-state` the SHA-256 state the
//                                  bytes before it leave (./parts.ts)
//   GET  <at><sha>[/<eid>]         the bytes
//
// Every upload answers `{eid, attachment, url, mime, bytes}`, and `w` and `h`
// for a picture: the address to point a row at, the use naming it
// (./upload.ts), and where to read it.
//
// The address is the name, which is what makes an upload a PUT: the same
// file sent twice, by two people or by one client retrying, is one stored
// object and one row, and bytes that do not hash to the address they were
// sent to are refused. Every call of an upload in parts is safe to send
// again too, so a page that lost its connection, or its tab, asks where it
// stands and sends what is missing.
//
// Who may upload is the graph's question, never a second one these endpoints
// ask. An upload first runs its rows against the graph as a check, so
// whatever refuses that write refuses the upload, and a server with an upload
// policy writes it as a rule like any other. What is left over is what only
// the server knows, and those are its options: where the bytes live
// (`store`), how large one may be (`limit`), what it takes (`accepts`), the
// room it has (`room`), its bucket's uploads in parts (`parts`) and the words
// its rows speak (`naming`).
//
// The read is fenced by ./serve.ts.

import { line } from '@yaks/query'
import {
  type Authenticate,
  fault,
  json,
  refuse,
  type Route,
  signed,
} from '@yaks/api'
import { Pending } from '@yaks/api/log'
import type { Bundle, Taken } from '@yaks/graph'
import { Stale, status } from '@yaks/graph/errors'
import { addressOf } from './artifact.ts'
import { mediaType } from './content_type.ts'
import { contentType } from './identify.ts'
import { mimeOf } from './mime.ts'
import type { Objects } from './object.ts'
import { Gone, type Multipart, parts as inParts, Wrong } from './parts.ts'
import {
  addressed,
  type Representation,
  representation,
} from './representation.ts'
import { type Served, served, servedOpen, servedVia } from './serve.ts'
import type { Blobs } from './store.ts'
import {
  admit,
  artifacts,
  described,
  type File,
  filed,
  type Read,
  roomFor,
  SCOPE,
  servable,
  Untaken,
  type Upload,
  useOf,
} from './upload.ts'

/** The path the doors answer under where a configuration names none. */
export let PREFIX = '/blob/'

/** The largest upload accepted when the configuration sets no `limit`. */
export let LIMIT = 25 * 1024 * 1024

/** The size of each part an upload in parts goes up in but the last,
 * measured from a box and from a Worker (T-124790). At least 5 MiB, the least
 * R2 takes. */
export let PART = 8 * 1024 * 1024

/** A graph as this door reads and writes it. */
export type Rows = {
  read: Read
  apply: (
    bundles: Bundle[],
    opts: { check?: boolean; trusted?: boolean },
  ) => Bundle[] | Promise<Bundle[]>
}

/** Where uploads in parts go (./parts.ts): the bucket by name and its
 * multipart uploads, the prefix its objects are kept under (the store's), and
 * the prefix of the ledger of uploads under way. */
export type InParts = {
  objects: Objects
  bucket: Multipart
  prefix: string
  ledger: string
  /** the size of every part but the last (default {@link PART}) */
  part?: number
}

/** The options a configuration passes to this plugin. */
export type Options = Omit<Upload, 'store'> & {
  /** the path the doors answer under (default {@link PREFIX}) */
  at?: string
  /** uploads in parts, where the store's bucket takes them */
  parts?: InParts
  /** Whether the representation `eid` of the bytes at `sha` is served, where
   * a host keeps that answer nearer than its graph (default {@link servable}
   * of the graph). */
  served?: (sha: string, eid: string) => Promise<Representation | null>
  /** The bytes at `sha` answering `seek`, a GET or HEAD and its range, where
   * a host reads them through a cache (default: from the store). */
  bytes?: (seek: Request, sha: string) => Promise<Response>
  /** what the host adds to the failures this door reports */
  tags?: Record<string, string>
}

// A refusal in the JSON shape every other endpoint here uses (@yaks/api),
// with the door's word for it.
let no = (
  error: string,
  message: string,
  status: number,
  code?: string,
): Response => json({ error, message, ...code ? { code } : {} }, status)

let missing = () =>
  no('NotFound', 'no object at that address', 404, 'no_such_file')

let UNKNOWN = 'application/octet-stream'

// The request body, counted as it arrives: `null` where it ran past `most`.
// A caller that declares no length must not be able to make the server hold
// an unbounded body, so the bound is on the bytes themselves and never on
// what a `content-length` header claimed — and the remainder is read and
// discarded rather than cut off, so the refusal reaches the caller instead
// of a reset connection.
let bounded = async (
  request: Request,
  most: number,
): Promise<Uint8Array | null> => {
  let reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  let parts: Uint8Array[] = [], size = 0, over = false
  while (true) {
    let { done, value } = await reader.read()
    if (done || !value) break
    size += value.length
    if (over) continue
    if (size > most) (over = true), (parts = [])
    else parts.push(value)
  }
  if (over) return null
  let bytes = new Uint8Array(size), at = 0
  for (let part of parts) bytes.set(part, at), at += part.length
  return bytes
}

// What an upload calls its bytes, percent-encoded since a header is ASCII and
// a file's name is not (@yaks/platform/client.js encodes it).
let nameOf = (sent: unknown): string => {
  let name = typeof sent == 'string' ? sent : ''
  try {
    return decodeURIComponent(name).slice(0, 200)
  } catch {
    return name.slice(0, 200)
  }
}

// What an upload says its bytes are, as a media type and nothing else, or
// what its name says. The parameters are dropped and the shape is validated
// because this string is written into a response header every time the
// object is read back.
let typeOf = (declared: unknown, name: string): string => {
  let mime = mediaType(typeof declared == 'string' ? declared : '')
  return mime == UNKNOWN ? mediaType(mimeOf(name)) : mime
}

/** The doors, answering under `options.at` (default {@link PREFIX}), over
 * the host's artifact store, else its blob store. Building a store a
 * configuration names is the host's (./backend.ts), so a host without files,
 * a Worker, never loads the filesystem (./file.ts). */
export let routes = (
  host: { blobs?: Blobs; graph: Rows; who?: Authenticate; artifacts?: Blobs },
  options: Options = {},
): Route[] => {
  let store = host.artifacts ?? host.blobs
  if (!store) {
    console.warn('@yaks/blob: no door — the host keeps no bytes')
    return []
  }
  let at = options.at ?? PREFIX
  let upload: Upload = { ...options, store, limit: options.limit ?? LIMIT }
  let naming = options.naming ?? artifacts
  let scope = options.scope ?? SCOPE
  let read: Read = (query) => host.graph.read(query as Taken)
  let where = (request: Request) => `${request.method} ${PREFIX}*`

  // The address and the rest of the path below `at`.
  let below = (request: Request) =>
    new URL(request.url).pathname.slice(at.length).split('/')

  // Rows written as whoever `host.who` reports is calling, so an upload is
  // attributed the way a write through `/apply` beside it is. Fresh rows each
  // time: `apply` reads and writes the bundles it is given, so the check's
  // must not be the write's. A write the store's log keeps (@yaks/api/log
  // `Pending`) lands when the store recovers, so the upload has not failed.
  let writer = async (request: Request) => {
    let actor = await host.who?.(request) ?? null
    let as = (rows: Bundle[]) => signed(structuredClone(rows), actor)
    return {
      check: (rows: Bundle[]) =>
        host.graph.apply(as(rows), { check: true, trusted: true }),
      write: async (rows: Bundle[]) => {
        try {
          await host.graph.apply(as(rows), { trusted: true })
        } catch (e) {
          if (!(e instanceof Pending)) throw e
        }
      },
    }
  }

  // What every upload answers.
  let answer = (file: File) => {
    let url = `${at}${file.path}`
    let response = json({
      eid: file.sha,
      attachment: file.use,
      url,
      mime: file.mime,
      bytes: file.bytes,
      ...file.size,
    })
    response.headers.set('location', url)
    return response
  }

  // Bytes sent whole: the address the caller states, or none.
  let whole = async (request: Request, sha?: string) => {
    let most = Math.min(upload.limit!, upload.accepts?.maxLength ?? Infinity)
    let bytes = await bounded(request, most)
    // One byte more than `most` is refused as these were.
    if (!bytes) admit(upload, most + 1)
    if (!bytes!.length && !sha) {
      return no('Refused', 'an upload is some bytes', 400, 'no_bytes')
    }
    if (sha) {
      let got = await addressOf(bytes!)
      if (got != sha) {
        return no('Refused', `these bytes address ${got}`, 400, 'refused')
      }
    }
    let name = nameOf(request.headers.get('x-yak-name'))
    let as = await writer(request)
    let file = await filed(
      read,
      upload,
      bytes!,
      typeOf(request.headers.get('content-type'), name),
      name,
      as.check,
    )
    await as.write(file.bundles)
    return answer(file)
  }

  // An upload in parts, where its bucket takes them.
  let placed = (sha: string) => {
    let p = options.parts
    return p && {
      key: p.prefix + sha,
      up: inParts(p.objects, p.bucket, {
        key: p.prefix + sha,
        sha,
        ledger: p.ledger,
        part: p.part ?? PART,
      }),
    }
  }
  let unparted = () =>
    no('Unsupported', 'this door takes no uploads in parts', 501, 'no_parts')

  let begun = async (request: Request, sha: string) => {
    let said = await request.json().catch(() => ({})) as Record<
      string,
      unknown
    >
    let bytes = Number(said.bytes)
    if (!(Number.isInteger(bytes) && bytes > 0)) {
      return no('Refused', 'an upload says how many bytes', 400, 'no_bytes')
    }
    admit(upload, bytes)
    await roomFor(upload, sha, bytes)
    let going = placed(sha)
    if (!going) return unparted()
    let { part, need, whole } = await going.up.post(bytes)
    if (!whole) return json({ part, need })
    let name = nameOf(said.name)
    let file = await described(
      read,
      upload,
      sha,
      whole.head,
      typeOf(said.mime, name),
      name,
      whole.bytes,
    )
    // A completed upload remains recoverable if admission refuses its row.
    let as = await writer(request)
    admit(upload, whole.bytes, file.mime)
    await as.check(file.bundles)
    await as.write(file.bundles)
    return answer(file)
  }

  let part = async (request: Request, sha: string, n: string) => {
    let going = placed(sha)
    if (!going) return unparted()
    if (!/^[1-9][0-9]*$/.test(n)) return missing()
    await going.up.put(
      Number(n),
      request.body ?? new Response('').body!,
      Number(request.headers.get('content-length') ?? NaN),
      request.headers.get('x-yak-state') ?? undefined,
    )
    return json({ n: Number(n) })
  }

  // Every write's refusals, in the door's words.
  let writing =
    (handle: (request: Request) => Promise<Response>) =>
    async (request: Request) => {
      try {
        return await handle(request)
      } catch (e) {
        if (e instanceof Untaken) {
          return no('Untaken', e.message, e.status, e.code)
        }
        if (e instanceof Gone) {
          return no('Gone', e.message, 409, 'upload_gone')
        }
        if (e instanceof Wrong) return no('Refused', e.message, 400, 'refused')
        return refuse(e, request, options.tags)
      }
    }

  // The representation the rows at `sha` say now, fixed once and kept.
  let current = async (sha: string) => {
    let use = await useOf(sha)
    let said = naming.said(await read(line`.entity.eid=${[use, sha]}&*`), {
      sha,
      use,
    })
    if (!said) return null
    let rep = representation(scope, sha, said.mime, said.name)
    if ((await read(line`.entity.eid=${rep.eid}`)).length) return rep
    let bytes = await store.get(sha)
    if (!bytes) return null
    let fixed = await contentType(bytes, said.mime)
    rep = representation(scope, sha, fixed, said.name)
    let applied = await host.graph.apply([
      { entity: { eid: rep.eid }, representation: rep.row },
      ...fixed != said.mime ? said.fix(fixed) : [],
    ], { trusted: true })
    // A redirect to a representation the store did not keep is a broken link.
    if (!applied.some((b) => b.entity.eid == rep.eid && b.representation)) {
      throw new Error(`the representation ${rep.eid} was not written`)
    }
    return rep
  }

  // The bytes of a served representation, as a fenced answer.
  let bytesOf = async (request: Request, sha: string, meta: Served) => {
    if (options.bytes) {
      let got = await servedVia(
        (seek) => options.bytes!(seek, sha),
        meta,
        request,
      )
      if (got.status == 404) {
        await got.body?.cancel()
        return null
      }
      if (![200, 206, 304, 416].includes(got.status)) {
        await got.body?.cancel()
        throw new Error(`the bytes at ${sha} answered ${got.status}`)
      }
      return got
    }
    let partial = request.method == 'HEAD' ||
      request.headers.has('range') || request.headers.has('if-none-match')
    let object = partial ? await store.open?.(sha) : null
    if (partial && store.open && !object) return null
    let bytes = object ? null : await store.get(sha)
    if (!object && !bytes) return null
    return object
      ? servedOpen(object, meta, request)
      : served(bytes!, meta, request)
  }

  // A read the store could not answer: a refusal it relays as it came, its
  // wait among it, and anything else reported and unavailable.
  let unavailable = (e: unknown, request: Request) => {
    if (status(e) < 500) return refuse(e, request, options.tags)
    fault(e, where(request), options.tags)
    return no(
      'Unavailable',
      'these bytes cannot be read just now',
      503,
      'blob_unavailable',
    )
  }

  // The reader's browser keeps the redirect for a week: every representation
  // of one sha is the same bytes, so a kept redirect at worst names a file by
  // an older name, and a removed file's representation is gone as its bare
  // address is.
  let REDIRECT = 'private, max-age=604800'

  let get = async (request: Request) => {
    let address = addressed(below(request).join('/'))
    if (!address) return missing()
    let { sha, eid } = address
    try {
      if (!eid) {
        let rep
        try {
          rep = await current(sha)
        } catch (e) {
          if (!(e instanceof Stale)) throw e
          rep = await current(sha)
        }
        if (!rep) return missing()
        let to = new URL(request.url)
        to.pathname += `/${rep.eid}`
        return new Response(null, {
          status: 302,
          headers: { location: to.href, 'cache-control': REDIRECT },
        })
      }
      let rep = await (options.served
        ? options.served(sha, eid)
        : servable(read, { scope, naming }, sha, eid))
      if (!rep) {
        return missing()
      }
      let answered = await bytesOf(request, sha, {
        mime: rep.media_type,
        name: rep.name,
        etag: `"${eid}"`,
        cache: 'browser',
      })
      if (answered) {
        return answered
      }
      // A row names bytes the store does not hold.
      fault(new Error(`missing blob ${sha}`), where(request), options.tags)
      return missing()
    } catch (e) {
      return unavailable(e, request)
    }
  }

  let put = writing((request) => {
    let [sha, n, ...rest] = below(request)
    if (!/^[0-9a-f]{64}$/.test(sha) || rest.length) {
      return Promise.resolve(
        no('Refused', 'an address is 64 lowercase hex digits', 400, 'refused'),
      )
    }
    return n == null ? whole(request, sha) : part(request, sha, n)
  })

  let post = writing((request) => {
    let [sha, ...rest] = below(request)
    return /^[0-9a-f]{64}$/.test(sha) && !rest.length
      ? begun(request, sha)
      : Promise.resolve(missing())
  })

  return [
    { method: 'GET', path: `${at}*`, handle: get },
    { method: 'HEAD', path: `${at}*`, handle: get },
    { method: 'POST', path: at.slice(0, -1), handle: writing(whole) },
    { method: 'POST', path: `${at}*`, handle: post },
    { method: 'PUT', path: `${at}*`, handle: put },
  ]
}
