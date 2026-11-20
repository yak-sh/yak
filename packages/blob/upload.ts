// An upload's write half, without a request anywhere in it: bytes kept under
// their address and the rows that name them, held to what the store takes.
// The door (./routes.ts) is one way bytes arrive; a letter's attachments and
// a fetched document are others, and each keeps them through here.
//
// The bytes' own SHA-256 is the object's key and the content row's eid, so
// the same file sent twice is one object and one row. What the bytes are
// called and what they are sit on a second row, their use, addressed off the
// first (`useOf`): derived, so an upload finds its own row without reading
// for it, and the same file sent again is that row renamed. They stay apart
// because they are two things, and because a component may not point at its
// own entity.
//
// Which words the two rows speak is a store's to say (`Naming`). This
// package's own are `artifact` and `attachment` (`artifacts`).
//
// It is its own entry (`@yaks/blob/upload`), since reading a type off the
// bytes loads the file-type detector (./identify.ts).

import { type Built, line, sub } from '@yaks/query'
import type { Bundle, Comp, Reads } from '@yaks/graph'
import { digest, token } from '@yaks/graph/sha256'
import { size as said } from '@yaks/fp'
import { type Accepts, fits, taken, takes } from './accepts.ts'
import { addressOf, keep } from './artifact.ts'
import { contentType } from './identify.ts'
import { type Size, sizeOf } from './image.ts'
import {
  type Representation,
  representation,
  represents,
} from './representation.ts'
import type { Blobs } from './store.ts'

let UNKNOWN = 'application/octet-stream'

/** The scope of a representation where a store names none. */
export let SCOPE = 'blob'

/** The eid of the use of the bytes at `sha`: the row saying what they are
 * called and what they are. */
export let useOf = (sha: string): Promise<string> => digest(`attachment:${sha}`)

/** Kept bytes, as the rows that name them are made from: their address, the
 * eid of their use, their media type and name, how many there are, and what
 * a picture measures. */
export type Kept = {
  sha: string
  use: string
  mime: string
  name: string
  bytes: number
  size?: Size
}

/** What a store's rows say the bytes at `sha` are: their media type and
 * name, and the patch that corrects the type once it is read off them. */
export type Said = {
  mime: string
  name: string
  fix: (mime: string) => Bundle[]
}

/** How a store's words name kept bytes. */
export type Naming = {
  /** The content row and the use. The use is a patch, so an arrival that
   * names nothing keeps the name the first one gave. */
  rows: (kept: Kept) => Bundle[]
  /** What rows read at the use and the content say of the bytes, or null
   * where none names them. */
  said: (rows: Bundle[], at: { sha: string; use: string }) => Said | null
  /** The query for the rows still naming the bytes at any of `shas`. While
   * one names an address, its bytes are served. */
  names: (shas: readonly string[]) => Built
  /** The addresses one of the rows `names` answers with names. */
  named: (row: Bundle) => string[]
}

let comp = (rows: Bundle[], eid: string, name: string) =>
  rows.find((r) => r.entity.eid == eid)?.[name] as Comp | undefined

let text = (v: unknown) => typeof v == 'string' ? v : ''

// The addresses a component's `props` hold.
let addresses = (c: unknown, ...props: string[]): string[] =>
  props.flatMap((p) => {
    let v = (c as Comp | null | undefined)?.[p]
    return typeof v == 'string' ? [v] : []
  })

/** This package's words: an `artifact` at the address, and an `attachment`
 * naming it. */
export let artifacts: Naming = {
  rows: ({ sha, use, mime, name, bytes }) => [
    {
      entity: { eid: sha },
      artifact: { address: sha, media_type: mime, size: bytes },
    },
    {
      entity: { eid: use },
      attachment: { artifact: sha, media_type: mime, ...name ? { name } : {} },
    },
  ],
  said: (rows, { sha, use }) => {
    let file = comp(rows, use, 'attachment')
    let artifact = comp(rows, sha, 'artifact')
    let was = file ?? artifact
    if (!was) return null
    let [eid, name] = file ? [use, 'attachment'] : [sha, 'artifact']
    return {
      mime: text(was.media_type) || text(artifact?.media_type),
      name: text(file?.name),
      fix: (mime) => [{
        entity: { eid },
        [name]: { media_type: mime },
        $was: { [name]: { media_type: token(was.media_type) } },
      }],
    }
  },
  names: (shas) =>
    line`.entity.eid=${shas} .artifact|.attachment.artifact=${shas}`,
  named: (row) => [
    ...row.artifact ? [row.entity.eid] : [],
    ...addresses(row.attachment, 'artifact'),
  ],
}

/** Where bytes are kept and what is taken there. */
export type Upload = {
  /** where the bytes go, under their address */
  store: Blobs
  /** the representations' scope: an app's eid, where one host serves many
   * (default {@link SCOPE}) */
  scope?: string
  /** what is taken: a size, and types read off the bytes */
  accepts?: Accepts
  /** the most bytes one object may be */
  limit?: number
  /** Why the store has no room for `bytes` more at `sha`, its ceiling's
   * refusal, or nothing where they fit. */
  room?: (sha: string, bytes: number) => string | Promise<string>
  /** the words the rows speak (default {@link artifacts}) */
  naming?: Naming
}

/** Bytes not taken: too many, of a type not taken, or past the store's room.
 * `status` is the HTTP status a door answers, and `code` its word for it. */
export class Untaken extends Error {
  status: number
  code: string
  constructor(status: number, code: string, says: string) {
    super(says)
    this.name = 'Untaken'
    this.status = status
    this.code = code
  }
}

/** Refused, when `bytes` bytes, or bytes read as `type`, are not taken.
 *
 * ```ts
 * import { admit, Untaken } from '@yaks/blob/upload'
 * import { memoryBlobs } from '@yaks/blob'
 * import { assertThrows } from '@std/assert'
 *
 * let at = { store: memoryBlobs(), accepts: { maxLength: 4096, contentMediaType: 'image/*' } }
 * admit(at, 4096, 'image/png')
 * assertThrows(() => admit(at, 4097), Untaken, 'this app takes files of at most 4 KB')
 * assertThrows(() => admit(at, 10, 'text/plain'), Untaken, 'this app takes image/*, and this file is text/plain')
 * assertThrows(() => admit({ ...at, limit: 1024 }, 2048), Untaken, 'a file is at most 1 KB here')
 * ```
 */
export let admit = (at: Upload, bytes: number, type?: string): void => {
  if (at.limit != null && bytes > at.limit) {
    throw new Untaken(
      413,
      'too_large',
      `a file is at most ${said(at.limit)} here`,
    )
  }
  if (!fits(at.accepts, bytes)) {
    throw new Untaken(
      413,
      'too_large',
      `this app takes files of at most ${said(at.accepts!.maxLength!)}`,
    )
  }
  if (type != null && !takes(at.accepts, type)) {
    throw new Untaken(
      415,
      'unsupported_media_type',
      `this app takes ${taken(at.accepts)}, and this file is ${type}`,
    )
  }
}

/** Refused where the store has no room for `bytes` more at `sha`. Bytes it
 * holds already count as the store counts them. */
export let roomFor = async (
  at: Upload,
  sha: string,
  bytes: number,
): Promise<void> => {
  let full = await at.room?.(sha, bytes)
  if (full) throw new Untaken(413, 'space_full', full)
}

/** Kept bytes, and the rows that name them. */
export type File = Kept & {
  /** the representation's address beneath a door: `<sha>/<eid>` */
  path: string
  bundles: Bundle[]
}

/** How the rows a store holds are read: a query line, its rows. */
export type Read = Reads<Bundle[] | Promise<Bundle[]>, []>

/**
 * The rows that name the `bytes` bytes at `sha`, read off `head`: their first
 * bytes, or all of them. A name or type the arrival leaves out is the one the
 * store's rows already say (`read`), since the same file is the same file
 * whatever a page had to call it the second time. The representation is
 * among the rows, fixing the headers the bytes are served with.
 */
export let described = async (
  read: Read,
  at: Upload,
  sha: string,
  head: Uint8Array,
  mime: string,
  name: string,
  bytes: number = head.byteLength,
): Promise<File> => {
  let naming = at.naming ?? artifacts
  let use = await useOf(sha)
  if (!name || mime == UNKNOWN) {
    let prior = naming.said(await read(line`.entity.eid=${use}`), { sha, use })
    name ||= prior?.name ?? ''
    if (mime == UNKNOWN && prior?.mime) mime = prior.mime
  }
  let type = await contentType(head, mime, bytes == head.byteLength)
  let rep = representation(at.scope ?? SCOPE, sha, type, name)
  let size = sizeOf(head)
  let kept: Kept = {
    sha,
    use,
    mime: rep.row.media_type,
    name,
    bytes,
    ...size ? { size } : {},
  }
  return {
    ...kept,
    path: rep.path,
    bundles: [...naming.rows(kept), {
      entity: { eid: rep.eid },
      representation: rep.row,
    }],
  }
}

/**
 * Bytes kept under their address, held to what `at` takes, and the rows that
 * name them, for the caller to write as whoever it decided is writing. Bytes
 * not taken throw {@link Untaken} before any are kept. `check` is asked of the
 * rows before the bytes are kept, so whatever would refuse the write refuses
 * the upload.
 *
 * The bytes land before their rows: a row naming nothing is what a reader
 * sees, while bytes nobody has named yet are invisible until the same file
 * arrives again and names them.
 */
export let filed = async (
  read: Read,
  at: Upload,
  bytes: Uint8Array,
  mime: string,
  name: string,
  check?: (rows: Bundle[]) => unknown,
): Promise<File> => {
  admit(at, bytes.byteLength)
  let sha = await addressOf(bytes)
  await roomFor(at, sha, bytes.byteLength)
  let file = await described(read, at, sha, bytes, mime, name)
  admit(at, bytes.byteLength, file.mime)
  await check?.(file.bundles)
  await keep(at.store, sha, bytes)
  return file
}

/** One served representation asked for: `eid`, of the bytes at `sha`. */
export type Asked = { sha: string; eid: string }

/**
 * The representations `asked` for, each while it is served, read off the store
 * in one query whatever their number, by place: none for one of another scope,
 * one that does not address its bytes, or bytes no row names any more. A
 * representation outlives the rows naming its bytes, and a copy of them may be
 * left in a cache or a bucket, so a deleted upload stops here.
 */
export let servables = async (
  read: Read,
  at: Pick<Upload, 'scope' | 'naming'>,
  asked: readonly Asked[],
): Promise<(Representation | null)[]> => {
  if (!asked.length) return []
  let naming = at.naming ?? artifacts
  let eids = [...new Set(asked.map((a) => a.eid))]
  let shas = [...new Set(asked.map((a) => a.sha))]
  let rows = await read(
    line`.entity.eid=${eids} .representation|${sub(naming.names(shas))}`,
  )
  let reps = new Map(
    rows.flatMap((r) =>
      r.representation
        ? [[r.entity.eid, r.representation as Representation]]
        : []
    ),
  )
  let named = new Set(
    rows.flatMap((r) => r.representation ? [] : naming.named(r)),
  )
  return asked.map(({ sha, eid }) => {
    let rep = reps.get(eid)
    return rep && rep.scope == (at.scope ?? SCOPE) && rep.address == sha &&
        represents(eid, rep) && named.has(sha)
      ? rep
      : null
  })
}

/** The representation `eid` of the bytes at `sha` while it is served
 * ({@link servables}). */
export let servable = async (
  read: Read,
  at: Pick<Upload, 'scope' | 'naming'>,
  sha: string,
  eid: string,
): Promise<Representation | null> =>
  (await servables(read, at, [{ sha, eid }]))[0]
