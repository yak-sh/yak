// Attachments — the fleet's wiring over @yaks/blob. Content is a blob entity
// whose eid is its SHA-256; attachment entities point to it and carry per-use
// name/MIME metadata; image dimensions belong to the shared content. Bytes
// stay beside the db at ~/.tasks/blobs/<sha> (the package's file backend, one
// file per address), never in a client cache or graph snapshot. Server-only.
import { artifactStore, fileBlobs, served, sizeOf } from '@yaks/blob'
import { type Change } from './types.ts'
import { db } from './live_db.ts'

let blobs = fileBlobs(`${Deno.env.get('HOME')}/.tasks/blobs`)
let artifacts = artifactStore(blobs)

// Attach a file to an entity: land one shared blob identity plus one attachment
// reference. The batch order is structural: blob before image before the
// attachment FK. apply() journals and broadcasts the same facts every other
// graph write uses.
export let landBlob = async (
  eid: string,
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<Change[]> => {
  let { address: sha } = await artifacts(bytes, mime)
  let dim = sizeOf(bytes)
  return [
    { eid: sha, name: 'blob', comp: { bytes: bytes.length } },
    ...(dim ? [{ eid: sha, name: 'image', comp: dim }] : []),
    { eid, name: 'attachment', comp: { blob: sha, mime, name } },
  ]
}

// The bytes plus whatever attachment metadata names them, kept apart from
// Response shaping so a caller that isn't HTTP (an MCP resource read, a test)
// can ask for a blob without building a Request. Assumes sha is already a
// validated 64-hex digest; null means no such blob on disk.
export let readBlob = async (sha: string) => {
  let bytes = await blobs.get(sha)
  if (!bytes) return null
  let row = db.prepare(
    `select a.mime, a.name from attachment a
     where a.blob = (select id from entity where eid = ?) limit 1`,
  ).get(sha) as { mime: string | null; name: string | null } | undefined
  return { bytes, mime: row?.mime, name: row?.name }
}

// Serve a stored file. sha is validated to a bare 64-hex digest — no path
// escapes; the fenced, immutable answer is the package's.
export let serveBlob = async (sha: string) => {
  if (!/^[0-9a-f]{64}$/i.test(sha)) return new Response('no', { status: 400 })
  let found = await readBlob(sha)
  return found
    ? served(found.bytes, found)
    : new Response('no blob', { status: 404 })
}
