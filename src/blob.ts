// File content and attachments — the server-side external CAS. Content is a
// blob entity whose eid is its SHA-256; attachment entities point to it and
// carry per-use name/MIME metadata. Image dimensions belong to the shared
// content. Bytes stay beside the db at ~/.tasks/blobs/<sha>, never in a client
// cache or graph snapshot. Server-only.
import { createHash } from 'node:crypto'
import { type Change } from './types.ts'
import { db } from './live_db.ts'

let blobs = `${Deno.env.get('HOME')}/.tasks/blobs`

// SHA-256 of the bytes, hex — the content address AND the dedup key. node's
// createHash (as sha.ts uses) takes a byte view directly, dodging WebCrypto's
// ArrayBuffer typing.
let sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

let onDisk = async (path: string) => {
  try {
    await Deno.stat(path)
    return true
  } catch {
    return false
  }
}

// Image dimensions from a file's own header, for the formats a screenshot
// arrives as — PNG, GIF, JPEG. Pure header math, no decoder; returns null for
// anything else (the card just renders without a reserved aspect box).
export let imageSize = (b: Uint8Array): { w: number; h: number } | null => {
  // PNG: 8-byte signature, then IHDR width/height as big-endian u32 at 16/20.
  if (
    b.length >= 24 &&
    b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4e && b[3] == 0x47
  ) {
    let u32 = (o: number) =>
      ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
    return { w: u32(16), h: u32(20) }
  }
  // GIF: 'GIF', then logical-screen width/height as little-endian u16 at 6/8.
  if (b.length >= 10 && b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) {
    return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) }
  }
  // JPEG: FFD8, then walk the marker segments to the first SOF (0xC0..0xCF,
  // minus the huffman/arithmetic markers C4/C8/CC) whose payload holds height
  // then width as big-endian u16.
  if (b.length >= 4 && b[0] == 0xff && b[1] == 0xd8) {
    let i = 2
    while (i + 9 <= b.length && b[i] == 0xff) {
      let m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m != 0xc4 && m != 0xc8 && m != 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3])
    }
  }
  return null
}

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
  let sha = sha256(bytes)
  await Deno.mkdir(blobs, { recursive: true })
  let path = `${blobs}/${sha}`
  if (!(await onDisk(path))) await Deno.writeFile(path, bytes)
  let dim = imageSize(bytes)
  return [
    { eid: sha, name: 'blob', comp: { bytes: bytes.length } },
    ...(dim ? [{ eid: sha, name: 'image', comp: dim }] : []),
    { eid, name: 'attachment', comp: { blob: sha, mime, name } },
  ]
}

// Serve a stored file. sha is validated to a bare 64-hex digest — no path
// escapes. The mime + name come off any attachment that points at these bytes.
// A sandbox
// CSP with no scripts plus nosniff keeps an HTML/SVG attachment inert when
// opened directly in a tab; content-addressed bytes are immutable, so they
// cache forever.
export let serveBlob = async (sha: string) => {
  if (!/^[0-9a-f]{64}$/i.test(sha)) return new Response('no', { status: 400 })
  let row = db.prepare(
    `select a.mime, a.name from attachment a
     where a.blob = (select id from entity where eid = ?) limit 1`,
  ).get(sha) as { mime: string | null; name: string | null } | undefined
  try {
    let bytes = await Deno.readFile(`${blobs}/${sha}`)
    return new Response(bytes, {
      headers: {
        'content-type': row?.mime || 'application/octet-stream',
        'content-security-policy': "sandbox; script-src 'none'",
        'x-content-type-options': 'nosniff',
        'cache-control': 'public, max-age=31536000, immutable',
        ...row?.name
          ? {
            'content-disposition': `inline; filename="${
              row.name.replace(/["\\\r\n]/g, '')
            }"`,
          }
          : {},
      },
    })
  } catch {
    return new Response('no blob', { status: 404 })
  }
}
