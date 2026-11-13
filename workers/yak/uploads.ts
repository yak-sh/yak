// An upload's write half, without a request anywhere in it: bytes into the
// app's bucket and the rows that name them there, as whoever the caller
// decided is writing. Bytes arrive by many doors (apps.ts `POST ./api/blob`,
// inbox.ts a letter's attachments, library-tools.ts a fetched document), and
// each keeps them through here.

import type { Bundle, Comp } from '@yaks/graph'
import {
  type Accepts,
  fits,
  representation,
  type Size,
  sizeOf,
  taken,
  takes,
} from '@yaks/blob'
import { contentType } from '@yaks/blob/identify'
import { Denied, stands } from '@yaks/member'
import { uploadFloor } from './app-authority.ts'
import { blobPrefix } from './blob-key.ts'
import { declarationOf } from './declaration.ts'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import { r2Objects } from './lib/objects.ts'
import { size } from './meter.ts'
import { KERNEL, type Meta } from './meta.ts'
import type { Who } from './session.ts'
import { fullFiles } from './usage.ts'
import { sha256 } from './versions.ts'
import { Pending } from '@yaks/api/log'

// The bytes' own name (versions.ts `sha256`, the content address a version's
// manifest is made of) is the object's key and the entity's eid here, so the
// same photo sent twice is one object and one row.
//
// The app's one use of those bytes, addressed off them: derived, so an upload
// finds its own attachment row without reading for it, and the same file sent
// again is that row renamed.
export let useOf = (sha: string) =>
  sha256(new TextEncoder().encode(`attachment:${sha}`))

// Where an app's uploaded bytes live: the prefix its row was born with
// (blob-key.ts `blobPrefix`), which no rename moves and erasing the app
// empties (erase.ts `emptied`). Deleting the upload's content row deletes
// them sooner (facets/app-effects.ts `delete_upload`).
export let blobKey = (space: Space, app: App, sha: string) =>
  blobPrefix(space, app) + sha

/**
 * A blob the app does not take (`"blob"` in its vocab.json, @yaks/blob
 * `Accepts`): bigger than it says, or of a type it does not list, read off the
 * bytes. Nothing declared takes everything; the limits are its author's.
 */
export class Untaken extends Error {
  status: number
  code: string
  constructor(status: number, code: string, says: string) {
    super(says)
    this.status = status
    this.code = code
  }
}

/** What the app takes as a blob, from the release serving it. */
export let acceptsOf = async (env: Env, space: Space, app: App) =>
  (await declarationOf(env, space, app)).vocab.blob as Accepts | undefined

// Refused, when `bytes` bytes, or bytes read as `type`, are not taken.
export let admit = (a: Accepts | undefined, bytes: number, type?: string) => {
  if (!fits(a, bytes)) {
    throw new Untaken(
      413,
      'too_large',
      `this app takes files of at most ${size(a!.maxLength!)}`,
    )
  }
  if (type != null && !takes(a, type)) {
    throw new Untaken(
      415,
      'unsupported_media_type',
      `this app takes ${taken(a)}, and this file is ${type}`,
    )
  }
}

/**
 * Bytes into the app's bucket, and the rows that name them there — the
 * write half of an upload, without a request anywhere in it, because bytes
 * arrive by other doors too (inbox.ts: a letter's attachments). Bytes the app
 * does not take (`accepts`) throw {@link Untaken} before any are kept.
 *
 * The object lands in the bucket first and the rows are only returned, because
 * a row pointing at nothing is the failure a reader sees, while bytes nobody
 * has named yet are invisible until the next arrival of the same file names
 * them. The caller applies the bundles, as whoever it decided is writing.
 */
export let filed = async (
  env: Env,
  space: Space,
  app: App,
  graph: Meta,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  name: string,
  accepts?: Accepts,
): Promise<File> => {
  admit(accepts, bytes.byteLength)
  let sha = await sha256(bytes)
  let file = await described(graph, app, sha, bytes, mime, name)
  admit(accepts, bytes.byteLength, file.mime)
  // Put without asking first: the key is the bytes' own name, so the same
  // file again writes what is already there, and a new one, the usual
  // arrival, saves the bucket's round trip of a look (T-124298).
  await r2Objects(env.BLOBS).put(blobKey(space, app, sha), bytes)
  return file
}

/** Kept bytes, and the rows that name them. */
export type File = {
  sha: string
  use: string
  size: Size | undefined
  mime: string
  url: string
  bundles: Bundle[]
}

/**
 * The rows that name the `bytes` bytes kept at `sha`, read off `head`: their
 * first bytes, or all of them.
 *
 * The content row, the way the fleet shapes a file (src/blob.ts),
 * addressed by its sha and carrying what is true of the bytes — how many they
 * are, and what they measure (@yaks/blob `sizeOf`, off the file's own header) —
 * and the use of it, carrying what it is called and what it is. They stay
 * apart because they are two things, and because a component may not point at
 * its own entity. The use is addressed off the content, so the same bytes sent
 * twice are one attachment renamed rather than a second row saying the same
 * thing. A listing shows the use and not the content, which is right: a doc's
 * body is a blob row as well, and nobody saved that.
 */
export let described = async (
  graph: Meta,
  app: App,
  sha: string,
  head: Uint8Array,
  mime: string,
  name: string,
  bytes = head.byteLength,
): Promise<File> => {
  let use = await useOf(sha)
  if (!name || mime == 'application/octet-stream') {
    let [prior] = await graph.query(`.entity.eid=${use}`) as {
      attachment?: { name?: string; mime?: string }
    }[]
    name ||= prior?.attachment?.name ?? ''
    if (mime == 'application/octet-stream') {
      mime = prior?.attachment?.mime ?? mime
    }
  }
  let whole = bytes == head.byteLength
  let rep = representation(
    app.eid,
    sha,
    await contentType(head, mime, whole),
    name,
  )
  let size = sizeOf(head)
  return {
    sha,
    use,
    size,
    mime: rep.row.media_type,
    url: `/${app.slug}/api/blob/${rep.path}`,
    bundles: [
      {
        entity: { eid: sha },
        blob: { bytes },
        ...(size ? { image: size } : {}),
      },
      {
        entity: { eid: rep.eid },
        representation: rep.row,
      },
      {
        entity: { eid: use },
        // A patch, so an arrival that names nothing leaves the name the
        // first one gave these bytes: the same file is the same file,
        // whatever the page had to call it the second time.
        attachment: {
          blob: sha,
          mime: rep.row.media_type,
          ...(name ? { name } : {}),
        },
      },
    ],
  }
}

/** Whether `who` is below the app's upload floor (app-authority.ts
 * `uploadFloor`): the refusal they are given before any bytes are kept, as the
 * store's guard holds the rows that name them, or nothing. */
export let belowFloor = async (
  env: Env,
  space: Space,
  app: App,
  who: Pick<Who, 'person' | 'role'>,
) => {
  let need = uploadFloor((await declarationOf(env, space, app)).vocab)
  return need && !stands(who.person, who.role, need)
    ? new Denied(who.person, app.eid, need, 'write', 'attachment')
    : undefined
}

/**
 * One whole upload, as whoever `graph` writes as: the bytes kept and the rows
 * that name them applied, so the app's rules (extraction among them) run on
 * it. What `POST ./api/blob` does once it has read the bytes, and what the
 * connector's library tools do with a document they fetched or were handed
 * (library-tools.ts). Bytes the app does not take, or a space with no room,
 * throw {@link Untaken}; a store's refusal of the rows throws as it answered.
 * A write the store's log keeps (`Pending`) lands when the app recovers, so it
 * is no failure here. `source` is the web address the file came from.
 */
export let uploaded = async (
  env: Env,
  space: Space,
  app: App,
  graph: Meta,
  bytes: Uint8Array<ArrayBuffer>,
  o: {
    mime: string
    name: string
    source?: string
    accepts?: Accepts
    protect?: (rows: Bundle[], sha: string) => Bundle[]
  },
): Promise<File> => {
  let accepts = o.accepts ?? await acceptsOf(env, space, app)
  let stopped = await fullFiles(env, space, [{
    key: blobKey(space, app, await sha256(bytes)),
    bytes: bytes.byteLength,
  }])
  if (stopped) throw new Untaken(413, 'space_full', stopped)
  let file = await filed(
    env,
    space,
    app,
    graph,
    bytes,
    o.mime,
    o.name,
    accepts,
  )
  if (o.source) {
    file.bundles = file.bundles.map((b) =>
      b.attachment
        ? { ...b, attachment: { ...b.attachment as Comp, source: o.source } }
        : b
    )
  }
  if (o.protect) file.bundles = o.protect(file.bundles, file.sha)
  try {
    await graph.apply(file.bundles, KERNEL)
  } catch (e) {
    // Kept by the store's write log (@yaks/api/log): the bytes are stored and their
    // row lands when the app recovers, so the upload is not told it failed.
    if (!(e instanceof Pending)) throw e
  }
  return file
}
