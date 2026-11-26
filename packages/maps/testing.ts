// Map parts in memory, for tests of anything that serves them: a PMTiles
// archive made from a few tiles, and a bucket that holds it.
import { zxyToTileId } from 'pmtiles'
import type { Bucket } from './tiles.ts'

/** A bucket in memory: `put` writes a key, `reads` counts the gets. */
export type Memory = Bucket & {
  reads: number
  put: (key: string, bytes: Uint8Array) => void
}

/** A PMTiles v3 archive holding the given tiles (`'z/x/y': body`),
 * uncompressed: header, root directory, metadata, then the tiles' bytes
 * (github.com/protomaps/PMTiles, spec/v3). */
export let archive = (tiles: Record<string, string>): Uint8Array => {
  let enc = new TextEncoder()
  let entries = Object.entries(tiles).map(([zxy, body]) => {
    let [z, x, y] = zxy.split('/').map(Number)
    return { id: zxyToTileId(z, x, y), bytes: enc.encode(body) }
  }).sort((a, b) => a.id - b.id)
  let varints: number[] = []
  let v = (n: number) => {
    while (n >= 0x80) varints.push((n & 0x7f) | 0x80), n >>>= 7
    varints.push(n)
  }
  v(entries.length)
  let last = 0
  for (let e of entries) v(e.id - last), last = e.id
  for (let _ of entries) v(1)
  for (let e of entries) v(e.bytes.length)
  let at = 0
  entries.forEach((e, i) => {
    v(i == 0 ? at + 1 : 0)
    at += e.bytes.length
  })
  let dir = new Uint8Array(varints)
  let meta = enc.encode(JSON.stringify({ vector_layers: [{ id: 'earth' }] }))
  let data = new Uint8Array(at)
  entries.reduce((o, e) => (data.set(e.bytes, o), o + e.bytes.length), 0)
  let head = new Uint8Array(127)
  let view = new DataView(head.buffer)
  head.set(enc.encode('PMTiles'))
  head[7] = 3
  let u64 = (offset: number, n: number) => view.setUint32(offset, n, true)
  let [dirAt, metaAt] = [127, 127 + dir.length]
  let dataAt = metaAt + meta.length
  u64(8, dirAt), u64(16, dir.length), u64(24, metaAt), u64(32, meta.length)
  u64(40, dataAt), u64(56, dataAt), u64(64, data.length)
  head[96] = 1, head[97] = 1, head[98] = 1, head[99] = 1
  head[100] = 0, head[101] = 15
  let out = new Uint8Array(dataAt + data.length)
  out.set(head), out.set(dir, dirAt), out.set(meta, metaAt)
  out.set(data, dataAt)
  return out
}

/** A bucket in memory that counts its reads; each put is a new etag, as
 * R2's are, across every bucket here. */
let n = 0
export let bucket = (files: Record<string, Uint8Array> = {}): Memory => {
  let tags: Record<string, string> = {}
  let b = {
    reads: 0,
    put: (key: string, bytes: Uint8Array) => {
      files[key] = bytes
      tags[key] = `"${++n}"`
    },
    get: (key: string, o?: { range: { offset: number; length: number } }) => {
      b.reads++
      let all = files[key]
      if (!all) return Promise.resolve(null)
      let { offset = 0, length = all.length } = o?.range ?? {}
      let part = all.slice(offset, offset + length)
      return Promise.resolve({
        etag: tags[key] ??= `"${++n}"`,
        body: new Blob([part]).stream(),
        arrayBuffer: () => Promise.resolve(part.buffer as ArrayBuffer),
      })
    },
  }
  return b
}

/** A key no other archive in this process was put under: a door keeps an
 * archive's directories by key and etag. */
export let unique = (name: string): string => `${name}-${++n}.pmtiles`
